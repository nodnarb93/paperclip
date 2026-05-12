// PATCH(nodnarb93): tts-readaloud (Patch 5) — player for read-aloud audio.
// PATCH(nodnarb93): tts-polish (Patch 6) — settings panel, voice picker,
//   speed pills, localStorage persistence, hidden title.
// PATCH(nodnarb93): tts-fixes (Patch 7) — non-modal floating widget (does NOT
//   block page interaction), mobile-responsive layout (top-anchored compact
//   row with background-gradient progress on mobile, bottom-right full
//   player on desktop), auto-close 1.5s after audio ends. Component is now
//   mounted/unmounted by the parent on open/close (replaces radix Dialog),
//   which means localStorage values are re-read on every open — fixes the
//   Patch 6 persistence bug where settings only stuck within a single modal
//   instance, not across modals on the same page.
//
// Despite the file name still being "TtsPlayerModal", this is no longer a
// modal. Kept the name to minimize diff churn on Patch 7 — rename later if
// the misnomer bothers future-readers.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipBack,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// PATCH(nodnarb93): tts-cache-pregen (Patch 9) — synthesis goes through the
// LRU cache so repeat clicks on the same comment+voice are instant.
import { ttsCache } from "../lib/ttsCache";

interface TtsPlayerProps {
  text: string;
  title?: string;
  onClose: () => void;
}

const STORAGE_KEY_VOICE = "paperclip.tts.voice";
const STORAGE_KEY_SPEED = "paperclip.tts.speed";
// PATCH(nodnarb93): tts-kokoro-voices (Patch 8.2) — switched from OpenAI-compat
// voice names (alloy/echo/fable/onyx/nova/shimmer) to Kokoro's native voice
// packs. The compat names worked via Kokoro's mapping layer but routed
// "fable" → "af_sarah" etc., giving worse results than the named voices
// suggested. Native names give consistent, predictable output. Curated to ~15
// English voices grouped by accent + gender. Kokoro ships ~67 total
// (including non-English, ASMR, and v0 variants — those omitted here).
// PATCH(nodnarb93): default-voice-echo (Patch 14) — was "bm_fable" since
// Patch 8.2. Echo (am_echo, American male mid-range) is the user's preferred
// default for new browsers / cleared localStorage / incognito sessions.
const DEFAULT_VOICE = "am_echo";
const DEFAULT_SPEED = 1;
interface VoiceOption {
  value: string;
  label: string;
  description: string;
  group: "British male" | "British female" | "American male" | "American female";
}
const VOICE_OPTIONS: VoiceOption[] = [
  // British Male — closest to the "Fable" the user has been preferring.
  { value: "bm_fable", label: "Fable", description: "British male", group: "British male" },
  { value: "bm_george", label: "George", description: "BBC-narrator feel", group: "British male" },
  { value: "bm_lewis", label: "Lewis", description: "Casual British male", group: "British male" },
  { value: "bm_daniel", label: "Daniel", description: "Deeper British male", group: "British male" },
  // British Female
  { value: "bf_emma", label: "Emma", description: "Warm British female", group: "British female" },
  { value: "bf_alice", label: "Alice", description: "British female", group: "British female" },
  { value: "bf_lily", label: "Lily", description: "Younger British female", group: "British female" },
  // American Male
  { value: "am_michael", label: "Michael", description: "News-anchor feel", group: "American male" },
  { value: "am_onyx", label: "Onyx", description: "Deep American male", group: "American male" },
  { value: "am_adam", label: "Adam", description: "American male", group: "American male" },
  { value: "am_echo", label: "Echo", description: "Mid-range American male", group: "American male" },
  // American Female
  { value: "af_sarah", label: "Sarah", description: "Neutral American female", group: "American female" },
  { value: "af_nova", label: "Nova", description: "Podcast-host energy", group: "American female" },
  { value: "af_bella", label: "Bella", description: "Warm American female", group: "American female" },
  { value: "af_nicole", label: "Nicole", description: "Soft American female", group: "American female" },
  { value: "af_sky", label: "Sky", description: "Bright American female", group: "American female" },
];
// PATCH(nodnarb93): tts-kokoro-voices (Patch 8.2) — one-time migration for
// users whose localStorage holds an old OpenAI-compat voice name from Patches
// 6/7/8. Reads the legacy name, maps to the closest Kokoro native voice, and
// writes it back so the next read returns the new value directly.
const LEGACY_OPENAI_VOICE_MIGRATION: Record<string, string> = {
  alloy: "af_nicole",   // Soft female, closest analogue to OpenAI's Alloy
  echo: "am_echo",
  fable: "bm_fable",
  onyx: "am_onyx",
  nova: "af_nova",
  shimmer: "af_sky",    // No direct equivalent; Sky is the closest in tone
};
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];
// PATCH(nodnarb93): tts-fixes (Patch 7) — auto-close delay after audio ends
// naturally. 1.5s lets the user see the "ended" state before it disappears.
const AUTO_CLOSE_DELAY_MS = 1500;

function readStoredVoice(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE;
  const stored = window.localStorage.getItem(STORAGE_KEY_VOICE);
  if (!stored) return DEFAULT_VOICE;
  // Current Kokoro-native voice already stored: use it.
  if (VOICE_OPTIONS.some((v) => v.value === stored)) return stored;
  // Patch 8.2 migration: legacy OpenAI-compat name → Kokoro-native.
  const migrated = LEGACY_OPENAI_VOICE_MIGRATION[stored];
  if (migrated) {
    try {
      window.localStorage.setItem(STORAGE_KEY_VOICE, migrated);
    } catch {
      // ignore — storage failure leaves the legacy value, will migrate next time
    }
    return migrated;
  }
  return DEFAULT_VOICE;
}

function readStoredSpeed(): number {
  if (typeof window === "undefined") return DEFAULT_SPEED;
  const stored = window.localStorage.getItem(STORAGE_KEY_SPEED);
  const parsed = stored ? Number(stored) : NaN;
  if (Number.isFinite(parsed) && SPEED_OPTIONS.includes(parsed)) return parsed;
  return DEFAULT_SPEED;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// PATCH(nodnarb93): tts-fixes (Patch 7) — kept the legacy "Modal" name for
// backward compatibility with existing imports, but it's now an alias for the
// floating-widget TtsPlayer component. The wrapping component handles the
// open/closed lifecycle; this inner one only renders when actually visible.
interface LegacyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  title?: string;
}

export function TtsPlayerModal({ open, onOpenChange, text, title }: LegacyModalProps) {
  if (!open) return null;
  // PATCH(nodnarb93): tts-fixes (Patch 7) — mounting fresh on each open is
  // the magic that fixes the persistence bug: useState initializers read
  // localStorage anew, so settings changed in a previous instance are picked
  // up by every subsequent one.
  return <TtsPlayer text={text} title={title} onClose={() => onOpenChange(false)} />;
}

function TtsPlayer({ text, title, onClose }: TtsPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PATCH(nodnarb93): tts-cache-pregen (Patch 9) — unpin function returned by
  // ttsCache.pin(), called on unmount to release the cache entry for eviction.
  const cacheUnpinRef = useRef<(() => void) | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voice, setVoice] = useState<string>(() => readStoredVoice());
  const [speed, setSpeed] = useState<number>(() => readStoredSpeed());
  const [cacheMaxSize, setCacheMaxSize] = useState<number>(() => ttsCache.getMaxSize());

  const cancelPendingAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  const persistVoice = useCallback((next: string) => {
    setVoice(next);
    try {
      window.localStorage.setItem(STORAGE_KEY_VOICE, next);
    } catch {
      // ignore — private mode etc.
    }
  }, []);

  const persistSpeed = useCallback((next: number) => {
    setSpeed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY_SPEED, String(next));
    } catch {
      // ignore
    }
  }, []);

  // Synthesize on mount; re-fetch (cache or network) when voice or text changes.
  useEffect(() => {
    if (!text.trim()) {
      setError("No text to read.");
      return;
    }

    let stale = false;
    setLoading(true);
    setError(null);
    setAudioUrl(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    cancelPendingAutoClose();

    // Release any prior pin before re-acquiring for the new (text, voice).
    cacheUnpinRef.current?.();
    cacheUnpinRef.current = ttsCache.pin(text, voice);

    ttsCache
      .fetch(text, voice)
      .then((blob) => {
        if (stale) return;
        // Revoke any old URL before creating a new one (defensive — repeat
        // mounts within the same modal session shouldn't happen, but cheap).
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setAudioUrl(url);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError(err instanceof Error ? err.message : "Synthesis failed");
        setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [text, voice, cancelPendingAutoClose]);

  // Auto-play when audio source is set. preservesPitch keeps speeds natural.
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.playbackRate = speed;
      audioRef.current.preservesPitch = true;
      audioRef.current.play().catch(() => {
        /* autoplay blocked; user can press play manually */
      });
    }
  }, [audioUrl, speed]);

  // Keep playbackRate in sync when speed changes mid-play.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Final cleanup on unmount: pause, release cache pin, revoke blob URL.
  useEffect(() => {
    return () => {
      cancelPendingAutoClose();
      audioRef.current?.pause();
      cacheUnpinRef.current?.();
      cacheUnpinRef.current = null;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [cancelPendingAutoClose]);

  function togglePlayPause() {
    cancelPendingAutoClose();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {
        /* ignore */
      });
    } else {
      audio.pause();
    }
  }

  function restart() {
    cancelPendingAutoClose();
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {
      /* ignore */
    });
  }

  function seekBy(seconds: number) {
    cancelPendingAutoClose();
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration, audio.currentTime + seconds),
    );
  }

  function seekToFraction(fraction: number) {
    cancelPendingAutoClose();
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, fraction * audio.duration));
  }

  function handleEnded() {
    setIsPlaying(false);
    // PATCH(nodnarb93): tts-fixes (Patch 7) — auto-close shortly after audio
    // ends naturally. onEnded only fires on completion (not on user pause),
    // so we don't accidentally close when the user is just taking a break.
    cancelPendingAutoClose();
    autoCloseTimerRef.current = setTimeout(() => {
      onClose();
    }, AUTO_CLOSE_DELAY_MS);
  }

  const progressFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const a11yLabel = title ?? "Read aloud";

  return (
    <>
      {/* PATCH(nodnarb93): tts-fixes (Patch 7) — floating widget container.
          Mobile (<md): top-anchored, full-width edge-to-edge with small inset.
          Desktop (≥md): bottom-right, fixed-width.
          z-50 puts it above issue/comment content but below toasts.
          aria-label gives screen readers context without modal trap. */}
      <div
        role="region"
        aria-label={a11yLabel}
        className={cn(
          "fixed z-50 rounded-lg border border-border/70 bg-background/95 shadow-lg backdrop-blur",
          "left-2 right-2 top-2 md:left-auto md:right-4 md:top-auto md:bottom-4 md:w-96",
        )}
      >
        {loading ? (
          <div className="flex items-center gap-3 px-3 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <p className="flex-1 text-sm text-muted-foreground">Synthesizing audio…</p>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-3 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-sm">{error}</p>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : audioUrl ? (
          <>
            <audio
              ref={audioRef}
              src={audioUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onEnded={handleEnded}
              preload="metadata"
            />
            <div className="relative">
              {/* PATCH(nodnarb93): tts-fixes (Patch 7) — mobile background
                  progress gradient. Fills from left to right as audio plays.
                  Pointer-events-none so it doesn't interfere with clicks. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-lg bg-primary/10 transition-[width] duration-150 md:hidden"
                style={{ width: `${progressFraction * 100}%` }}
              />

              {/* DESKTOP: full layout with explicit progress bar */}
              <div className="hidden flex-col gap-3 p-3 md:flex">
                <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <button
                  type="button"
                  className="group relative h-2 w-full overflow-hidden rounded-full bg-muted"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const fraction = (e.clientX - rect.left) / rect.width;
                    seekToFraction(fraction);
                  }}
                  aria-label="Seek"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-100 group-hover:bg-primary/90"
                    style={{ width: `${progressFraction * 100}%` }}
                  />
                </button>
                <div className="flex items-center justify-center gap-2">
                  <Button variant="ghost" size="icon-sm" onClick={restart} title="Restart">
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => seekBy(-10)} title="Back 10 seconds">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button variant="default" size="icon" onClick={togglePlayPause} title={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => seekBy(10)} title="Forward 10 seconds">
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    onClick={() => setSettingsOpen((v) => !v)}
                    title="Voice & speed settings"
                    aria-expanded={settingsOpen}
                  >
                    <Settings className={cn("h-4 w-4 transition-transform", settingsOpen && "rotate-45")} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* MOBILE: single-row compact layout, no explicit progress bar
                  (the container's bg-gradient shows progress instead) */}
              <div className="relative flex items-center gap-1 px-2 py-2 md:hidden">
                <Button variant="ghost" size="icon-sm" onClick={restart} title="Restart">
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => seekBy(-10)} title="Back 10s">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="default" size="icon-sm" onClick={togglePlayPause} title={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => seekBy(10)} title="Forward 10s">
                  <RotateCw className="h-4 w-4" />
                </Button>
                <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">
                  {formatTime(currentTime)}/{formatTime(duration)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={() => setSettingsOpen((v) => !v)}
                  title="Settings"
                  aria-expanded={settingsOpen}
                >
                  <Settings className={cn("h-4 w-4 transition-transform", settingsOpen && "rotate-45")} />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* SETTINGS PANEL — same on mobile and desktop */}
              {settingsOpen ? (
                <div className="relative mt-1 flex flex-col gap-3 rounded-md border-t border-border/60 bg-muted/30 p-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Speed</label>
                    <div className="flex flex-wrap gap-1">
                      {SPEED_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs tabular-nums transition-colors",
                            option === speed
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-foreground hover:bg-muted",
                          )}
                          onClick={() => persistSpeed(option)}
                        >
                          {option}x
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* PATCH(nodnarb93): tts-cache-pregen (Patch 9) — cache size
                      control. Higher = more audio kept in memory for instant
                      replay; lower = lower memory footprint. */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Audio cache size
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {[5, 10, 15, 25, 50].map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs tabular-nums transition-colors",
                            option === cacheMaxSize
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-foreground hover:bg-muted",
                          )}
                          onClick={() => {
                            ttsCache.setMaxSize(option);
                            setCacheMaxSize(option);
                          }}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Recently played audio is kept in memory for instant replay; cleared on page reload.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="tts-voice-select" className="text-xs font-medium text-muted-foreground">
                      Voice
                    </label>
                    <select
                      id="tts-voice-select"
                      value={voice}
                      onChange={(e) => persistVoice(e.target.value)}
                      className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {/* PATCH(nodnarb93): tts-kokoro-voices (Patch 8.2) — grouped by
                          accent + gender so 15+ options stay browseable. */}
                      {(["British male", "British female", "American male", "American female"] as const).map((group) => (
                        <optgroup key={group} label={group}>
                          {VOICE_OPTIONS.filter((o) => o.group === group).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} — {option.description}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      Changing voice re-synthesizes the current audio.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
