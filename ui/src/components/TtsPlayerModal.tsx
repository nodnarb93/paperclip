// PATCH(nodnarb93): tts-readaloud (Patch 5) — modal player for read-aloud
// audio. On open: POSTs text to /api/audio/synthesize, receives an MP3 blob,
// creates a blob URL, and plays via <audio>. Controls: play/pause, restart,
// ±10s skip, scrubbable progress bar, elapsed / total time.
//
// PATCH(nodnarb93): tts-polish (Patch 6) — modal header hidden visually
// (kept sr-only for a11y), added a settings panel toggleable via a gear icon
// with voice picker + speed pills. Settings persist to localStorage so the
// next time the user opens any TTS modal, their choices stick.
//
// Lifecycle:
//   open -> synthesize() -> audio.play()
//   close -> abort in-flight synthesis -> pause() -> revoke blob URL
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipBack,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { audioApi } from "../api/audio";

interface TtsPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  title?: string;
}

// PATCH(nodnarb93): tts-polish (Patch 6) — settings persistence.
// Voice names match openedai-speech's OpenAI-compatible mapping; speed values
// are common podcast-app presets. localStorage keys are stable so settings
// stick across reloads.
const STORAGE_KEY_VOICE = "paperclip.tts.voice";
const STORAGE_KEY_SPEED = "paperclip.tts.speed";
const DEFAULT_VOICE = "alloy";
const DEFAULT_SPEED = 1;
const VOICE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "alloy", label: "Alloy", description: "Neutral, balanced" },
  { value: "echo", label: "Echo", description: "Mid-range male" },
  { value: "fable", label: "Fable", description: "British male" },
  { value: "onyx", label: "Onyx", description: "Deep male, news-anchor" },
  { value: "nova", label: "Nova", description: "Warm female, podcast host" },
  { value: "shimmer", label: "Shimmer", description: "Softer female" },
];
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function readStoredVoice(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE;
  const stored = window.localStorage.getItem(STORAGE_KEY_VOICE);
  if (stored && VOICE_OPTIONS.some((v) => v.value === stored)) return stored;
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

export function TtsPlayerModal({ open, onOpenChange, text, title }: TtsPlayerModalProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voice, setVoice] = useState<string>(() => readStoredVoice());
  const [speed, setSpeed] = useState<number>(() => readStoredSpeed());

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

  // Synthesize when modal opens (or when voice changes — re-render audio with
  // the new voice). Text changes also re-trigger, though current callers
  // mount a fresh modal per click so this is defensive.
  useEffect(() => {
    if (!open) return;
    if (!text.trim()) {
      setError("No text to read.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setAudioUrl(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    audioApi
      .synthesize(text, { voice, signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setAudioUrl(url);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Synthesis failed");
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [open, text, voice]);

  // Auto-play once audio source is set. Apply current playbackRate.
  // preservesPitch is the standard property — browsers default it to true,
  // but we set it explicitly to avoid chipmunk audio at 2x.
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.playbackRate = speed;
      audioRef.current.preservesPitch = true;
      audioRef.current.play().catch(() => {
        // Autoplay blocked; user can press play manually.
      });
    }
  }, [audioUrl, speed]);

  // Keep playbackRate in sync when speed changes (without re-fetching audio).
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // On close: pause playback, abort in-flight synthesis, revoke blob URL,
  // reset settings panel to collapsed.
  useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    abortRef.current?.abort();
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setAudioUrl(null);
    setLoading(false);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSettingsOpen(false);
  }, [open]);

  // Final cleanup if the component unmounts mid-play.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  function togglePlayPause() {
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
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {
      /* ignore */
    });
  }

  function seekBy(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration, audio.currentTime + seconds),
    );
  }

  function seekToFraction(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, fraction * audio.duration));
  }

  const progressFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  // PATCH(nodnarb93): tts-polish (Patch 6) — keep DialogTitle in the tree for
  // accessibility (radix warns otherwise) but visually hide it.
  const a11yTitle = useMemo(
    () => title ?? "Read aloud",
    [title],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="sr-only">{a11yTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          Audio player for the selected text.
        </DialogDescription>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Synthesizing audio…</p>
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm">{error}</p>
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
              onEnded={() => setIsPlaying(false)}
              preload="metadata"
            />
            <div className="flex flex-col gap-3">
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
              <div className="relative flex items-center justify-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={restart}
                  title="Restart"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => seekBy(-10)}
                  title="Back 10 seconds"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="default"
                  size="icon"
                  onClick={togglePlayPause}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => seekBy(10)}
                  title="Forward 10 seconds"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
                {/* PATCH(nodnarb93): tts-polish (Patch 6) — settings gear,
                    pushed to far right via ml-auto so it doesn't shift the
                    center-aligned playback controls. */}
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
              </div>

              {settingsOpen ? (
                <div className="mt-1 flex flex-col gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Speed
                    </label>
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
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="tts-voice-select"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Voice
                    </label>
                    <select
                      id="tts-voice-select"
                      value={voice}
                      onChange={(e) => persistVoice(e.target.value)}
                      className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {VOICE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </option>
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
      </DialogContent>
    </Dialog>
  );
}
