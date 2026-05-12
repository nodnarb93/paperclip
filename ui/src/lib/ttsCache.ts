// PATCH(nodnarb93): tts-cache-pregen (Patch 9) — in-memory LRU cache for
// synthesized TTS audio. Goals:
//   1. Repeat clicks on the same comment+voice replay instantly (no second
//      synthesis on the GPU, no extra network roundtrip).
//   2. In-flight request dedup: if user clicks again while a synthesis is
//      already running for the same key, the second call reuses the in-flight
//      Promise rather than starting a parallel request.
//   3. Pre-generation hint: callers (e.g. IssueChatThread) can warm the cache
//      for the comment most likely to be played next (typically the most
//      recent), so the first click feels instant.
//   4. Currently-playing audio is protected from LRU eviction via pin().
//
// Cache key composition: `${voice}::${textHash}`. Same text + different voice
// = different entry. Text is hashed (FNV-1a-ish) so keys stay bounded for
// very long comments.
//
// Not persisted across page reloads — in-memory only. IndexedDB persistence
// is a possible follow-up if the cache feels too fragile in practice.
import { audioApi } from "../api/audio";

const DEFAULT_MAX_SIZE = 15;
const MIN_MAX_SIZE = 1;
const MAX_MAX_SIZE = 100;
const STORAGE_KEY_MAX_SIZE = "paperclip.tts.cacheMaxSize";

// Voice preference helpers used by the pre-gen path. The modal's
// TtsPlayerModal.tsx also has its own readStoredVoice() with the same logic
// + a presentation-layer validity check against VOICE_OPTIONS. Pre-gen
// doesn't need the validity check — Kokoro accepts any voice name (falls
// back to af_sarah for unknowns) — so a simpler reader keeps the layering
// clean: the lib module doesn't import presentation concerns.
const STORAGE_KEY_VOICE = "paperclip.tts.voice";
const DEFAULT_VOICE = "bm_fable";
const LEGACY_OPENAI_VOICE_MIGRATION: Record<string, string> = {
  alloy: "af_nicole",
  echo: "am_echo",
  fable: "bm_fable",
  onyx: "am_onyx",
  nova: "af_nova",
  shimmer: "af_sky",
};

/**
 * Reads the user's preferred TTS voice from localStorage, with the same
 * legacy-name migration as TtsPlayerModal. Pre-gen callers use this to
 * key the cache the same way the modal will when the user clicks play.
 */
export function readPreferredVoice(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE;
  const stored = window.localStorage.getItem(STORAGE_KEY_VOICE);
  if (!stored) return DEFAULT_VOICE;
  return LEGACY_OPENAI_VOICE_MIGRATION[stored] ?? stored;
}

// Cheap, non-cryptographic 32-bit hash (FNV-1a). Suitable for cache-key
// dedup; collisions in a 15-entry cache of comment text are vanishingly rare.
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function buildKey(text: string, voice: string): string {
  return `${voice}::${hashText(text)}::${text.length}`;
}

interface CacheEntry {
  // Either the resolved blob (cache hit), or a Promise that will resolve to
  // one (in-flight). On error, the entry is deleted entirely so the next
  // caller retries from scratch.
  value: Blob | Promise<Blob>;
  // LRU bookkeeping: timestamp of last access (read or set).
  lastAccess: number;
  // Pin count: while > 0, the entry is protected from eviction. Used for
  // "currently playing" audio so an LRU evict doesn't revoke the blob URL
  // out from under the <audio> element.
  pinCount: number;
}

// PATCH(nodnarb93): tts-polish-2 (Patch 10) — cache extends EventTarget so
// UI elements (like the per-comment speaker icon's "cached" indicator) can
// subscribe to cache changes and re-render when entries are added or
// removed. Emits a single "change" event on any cache mutation — broad
// instead of per-key for simplicity; subscribers filter by their own key.
class TtsCache extends EventTarget {
  private entries = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor() {
    super();
    this.maxSize = this.readStoredMaxSize();
  }

  private emitChange(): void {
    this.dispatchEvent(new Event("change"));
  }

  private readStoredMaxSize(): number {
    if (typeof window === "undefined") return DEFAULT_MAX_SIZE;
    const stored = window.localStorage.getItem(STORAGE_KEY_MAX_SIZE);
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_MAX_SIZE && parsed <= MAX_MAX_SIZE) {
      return Math.floor(parsed);
    }
    return DEFAULT_MAX_SIZE;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  setMaxSize(n: number): void {
    const clamped = Math.max(MIN_MAX_SIZE, Math.min(MAX_MAX_SIZE, Math.floor(n)));
    this.maxSize = clamped;
    try {
      window.localStorage.setItem(STORAGE_KEY_MAX_SIZE, String(clamped));
    } catch {
      /* ignore — private mode etc */
    }
    this.evictIfOver();
  }

  /** Direct lookup. Updates LRU bookkeeping on hit. */
  get(text: string, voice: string): Blob | Promise<Blob> | undefined {
    const key = buildKey(text, voice);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastAccess = Date.now();
    return entry.value;
  }

  /**
   * Sync check: is there a RESOLVED Blob in the cache for this (text, voice)?
   * Used by UI elements (speaker icon) to display a "cached" visual state.
   * Returns false for in-flight Promise entries — we only flag "ready to
   * play instantly" as cached. PATCH(nodnarb93): tts-polish-2 (Patch 10).
   */
  hasReady(text: string, voice: string): boolean {
    const entry = this.entries.get(buildKey(text, voice));
    return entry !== undefined && entry.value instanceof Blob;
  }

  /**
   * Cache-aware fetch. If the entry exists (blob or in-flight promise),
   * returns it. Otherwise starts a real synthesize and stores the promise.
   * On the promise resolution, replaces the entry with the resolved blob.
   * On rejection, removes the entry so future calls retry from scratch.
   */
  fetch(text: string, voice: string): Promise<Blob> {
    const key = buildKey(text, voice);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastAccess = Date.now();
      return Promise.resolve(existing.value);
    }
    const promise = audioApi.synthesize(text, { voice }).then(
      (blob) => {
        // Replace the in-flight entry with the resolved blob, preserving any
        // pin count that may have been added while we were waiting.
        const current = this.entries.get(key);
        if (current) {
          current.value = blob;
          current.lastAccess = Date.now();
        }
        // PATCH(nodnarb93): tts-polish-2 (Patch 10) — notify subscribers so
        // speaker icons whose entries just landed can flip to "cached" state.
        this.emitChange();
        return blob;
      },
      (err) => {
        // Drop the failed entry so the next caller doesn't reuse a broken
        // promise. Rethrow so the caller's catch fires.
        this.entries.delete(key);
        this.emitChange();
        throw err;
      },
    );
    this.entries.set(key, {
      value: promise,
      lastAccess: Date.now(),
      pinCount: 0,
    });
    this.evictIfOver();
    return promise;
  }

  /**
   * Mark an entry as protected from eviction. Returns an unpin function.
   * Safe to call before the entry exists; the pin attaches when the entry
   * lands. Multiple pins on the same entry stack (refcounted).
   */
  pin(text: string, voice: string): () => void {
    const key = buildKey(text, voice);
    const apply = () => {
      const entry = this.entries.get(key);
      if (entry) entry.pinCount += 1;
    };
    apply();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = this.entries.get(key);
      if (entry) entry.pinCount = Math.max(0, entry.pinCount - 1);
    };
  }

  /** Remove all entries. Used in tests or manual user actions. */
  clear(): void {
    this.entries.clear();
  }

  /** Drop the least-recently-used unpinned entries until size <= maxSize. */
  private evictIfOver(): void {
    if (this.entries.size <= this.maxSize) return;
    const sorted = Array.from(this.entries.entries())
      .filter(([, e]) => e.pinCount === 0)
      .sort(([, a], [, b]) => a.lastAccess - b.lastAccess);
    let evicted = false;
    while (this.entries.size > this.maxSize && sorted.length > 0) {
      const next = sorted.shift();
      if (!next) break;
      this.entries.delete(next[0]);
      evicted = true;
    }
    if (evicted) this.emitChange();
  }
}

export const ttsCache = new TtsCache();
