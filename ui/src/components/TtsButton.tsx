// PATCH(nodnarb93): tts-readaloud (Patch 5) — reusable "read aloud" button.
// Opens a TtsPlayerModal with the supplied text. Hidden entirely when text is
// empty or whitespace-only, so callers don't need to gate the render.
//
// PATCH(nodnarb93): tts-polish-2 (Patch 10) — single-active-modal registry
// (clicking another speaker closes the previously open one) + green-tinted
// speaker icon when audio is cached for the current (text, voice).
import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readPreferredVoice, ttsCache } from "../lib/ttsCache";
import { TtsPlayerModal } from "./TtsPlayerModal";

interface TtsButtonProps {
  text: string;
  title?: string;
  size?: "icon-xs" | "icon-sm" | "icon";
  className?: string;
}

// PATCH(nodnarb93): tts-polish-2 (Patch 10) — module-level registry of every
// "I'm open" setOpen function. When one TtsButton opens, it iterates the
// registry and closes all others — only one TTS modal can be open at a time,
// which prevents the stacked-audio bug where two modals would play
// simultaneously. Each button registers/unregisters via the useEffect below.
const openSetters = new Set<(open: boolean) => void>();

export function TtsButton({
  text,
  title,
  size = "icon-sm",
  className,
}: TtsButtonProps) {
  const [open, setOpen] = useState(false);
  const [isCached, setIsCached] = useState(false);

  // PATCH(nodnarb93): tts-polish-2 (Patch 10) — subscribe to cache change
  // events so the speaker icon flips to "ready" when audio for this comment
  // lands in cache (via either pre-gen or a prior play).
  useEffect(() => {
    const update = () => {
      setIsCached(ttsCache.hasReady(text, readPreferredVoice()));
    };
    update();
    ttsCache.addEventListener("change", update);
    return () => {
      ttsCache.removeEventListener("change", update);
    };
  }, [text]);

  // PATCH(nodnarb93): tts-polish-2 (Patch 10) — when this modal opens, close
  // every other open TTS modal first. Registration happens via useEffect so
  // cleanup runs on unmount/close, leaving the registry tidy.
  useEffect(() => {
    if (!open) return;
    openSetters.forEach((s) => {
      if (s !== setOpen) s(false);
    });
    openSetters.add(setOpen);
    return () => {
      openSetters.delete(setOpen);
    };
  }, [open]);

  if (!text.trim()) return null;

  // PATCH(nodnarb93): voice-icon-bump (Patch 14) — explicit icon size that
  // scales with the button size variant. Previously hardcoded "h-4 w-4" which
  // gave a 16px speaker regardless of button size; in comment headers
  // (size="icon" now, was "icon-xs") that looked too small. Picks ~75%-larger
  // for "icon" (was the comment header complaint), proportionally smaller
  // for the existing icon-sm (issue title) and icon-xs surfaces.
  const iconSizeClass =
    size === "icon" ? "h-7 w-7" : size === "icon-sm" ? "h-4 w-4" : "h-3 w-3";

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        onClick={() => setOpen(true)}
        title={isCached ? "Read aloud (audio ready)" : "Read aloud"}
        className={className}
      >
        <Volume2
          className={cn(
            iconSizeClass,
            "transition-colors",
            isCached && "text-emerald-500 dark:text-emerald-400",
          )}
        />
      </Button>
      <TtsPlayerModal
        open={open}
        onOpenChange={setOpen}
        text={text}
        title={title}
      />
    </>
  );
}
