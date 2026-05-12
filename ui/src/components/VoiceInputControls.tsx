// PATCH(nodnarb93): voice-input-everywhere (Patch 8) — reusable button cluster
// that pairs with the `useVoiceInput` hook. Renders the mic toggle, the
// deferred transcribing spinner, and the undo button (visible only when an
// undoable transcription is pending). Drop in next to any composer that has
// voice input hooked up.
//
// Usage:
//   const voice = useVoiceInput(setBody);
//   <MarkdownEditor onChange={voice.onComposerChange} ... />
//   <VoiceInputControls voice={voice} />
import { Loader2, Mic, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseVoiceInputResult } from "../hooks/useVoiceInput";

interface VoiceInputControlsProps {
  voice: UseVoiceInputResult;
  size?: "icon-xs" | "icon-sm" | "icon";
}

export function VoiceInputControls({ voice, size = "icon-sm" }: VoiceInputControlsProps) {
  return (
    <>
      <Button
        variant="ghost"
        size={size}
        onClick={voice.toggleRecording}
        disabled={voice.transcribing}
        title={voice.isRecording ? "Stop recording" : "Voice input"}
      >
        {voice.isRecording ? (
          <Square className="h-4 w-4 fill-current text-red-500" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>
      {voice.canUndo ? (
        <Button
          variant="ghost"
          size={size}
          onClick={voice.undo}
          title="Undo last transcription"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
      ) : null}
      {voice.showTranscribingSpinner ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : null}
    </>
  );
}
