// PATCH(nodnarb93): tts-readaloud (Patch 5) — reusable "read aloud" button.
// Opens a TtsPlayerModal with the supplied text. Hidden entirely when text is
// empty or whitespace-only, so callers don't need to gate the render.
import { useState } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TtsPlayerModal } from "./TtsPlayerModal";

interface TtsButtonProps {
  text: string;
  title?: string;
  size?: "icon-xs" | "icon-sm" | "icon";
  className?: string;
}

export function TtsButton({
  text,
  title,
  size = "icon-sm",
  className,
}: TtsButtonProps) {
  const [open, setOpen] = useState(false);

  if (!text.trim()) return null;

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        onClick={() => setOpen(true)}
        title="Read aloud"
        className={className}
      >
        <Volume2 className="h-4 w-4" />
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
