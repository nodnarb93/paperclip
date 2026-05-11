// PATCH(nodnarb93): tts-readaloud (Patch 5) — modal player for read-aloud
// audio. On open: POSTs text to /api/audio/synthesize, receives an MP3 blob,
// creates a blob URL, and plays via <audio>. Controls: play/pause, restart,
// ±10s skip, progress bar (scrubbable), elapsed / total time.
//
// Lifecycle:
//   open -> synthesize() -> audio.play()
//   close -> abort in-flight synthesis -> pause() -> revoke blob URL
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { audioApi } from "../api/audio";

interface TtsPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  title?: string;
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

  // Kick off synthesis when the modal opens. We re-run on text change so the
  // same modal can be reused for different content (defensive — current usage
  // mounts/unmounts per click, but cheap to support).
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
      .synthesize(text, controller.signal)
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
  }, [open, text]);

  // Auto-play once the audio source is set. Some browsers (mobile especially)
  // refuse autoplay without user interaction — but the user JUST clicked the
  // TTS button, which counts as interaction. .play() returns a Promise that
  // can reject in autoplay-blocked contexts; we swallow that and let the user
  // click play manually.
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play().catch(() => {
        // Autoplay blocked; user can press play manually.
      });
    }
  }, [audioUrl]);

  // On close: pause playback, abort in-flight synthesis, revoke blob URL.
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
  }, [open]);

  // Final cleanup if the component unmounts mid-play (defensive).
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
        /* user-gesture issue, ignore */
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? "Read aloud"}</DialogTitle>
          <DialogDescription className="sr-only">
            Audio player for the selected text.
          </DialogDescription>
        </DialogHeader>

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
              <div className="flex items-center justify-center gap-2">
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
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
