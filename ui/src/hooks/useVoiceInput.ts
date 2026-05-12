// PATCH(nodnarb93): voice-input-everywhere (Patch 8) — extracted voice-input
// logic from IssueChatThread.tsx into a reusable hook so the mic feature can
// be dropped into any markdown composer with a single line of integration.
//
// Behavior (carried over verbatim from Patches 3 and 4):
//   - Press mic → request `audio` getUserMedia permission, start MediaRecorder
//   - Press again → stop, send the captured blob to /api/audio/transcribe
//   - Transcript is APPENDED to the existing body with a single space separator
//   - A "transcribing" spinner only appears 3s+ after stop (avoid flash for
//     fast transcriptions; the recording-state icon is the primary signal)
//   - Most-recent transcription is undoable via a one-click revert; the
//     undo state auto-clears the moment the user manually edits the body
//   - Errors surface via toast notifications
//
// Consumer integration:
//   const voice = useVoiceInput(setBody);
//   <MarkdownEditor value={body} onChange={voice.onComposerChange} ... />
//   <VoiceInputControls voice={voice} />  // see ./VoiceInputControls.tsx
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { audioApi } from "../api/audio";
import { useOptionalToastActions } from "../context/ToastContext";

interface PendingUndo {
  before: string;
  after: string;
}

export interface UseVoiceInputResult {
  isRecording: boolean;
  transcribing: boolean;
  showTranscribingSpinner: boolean;
  canUndo: boolean;
  toggleRecording: () => void;
  undo: () => void;
  /**
   * Use this as the composer's onChange handler. It calls `setBody(next)` AND
   * clears any pending undo state when the user manually edits content that
   * doesn't match the post-transcription snapshot — meaning undo only
   * remains available while the user hasn't touched the inserted text yet.
   *
   * Most callers want this. Use `clearUndoOnEdit` instead if your composer
   * manages its body state via a different path (e.g. NewIssueDialog uses a
   * ref-based optimization to avoid re-rendering on every keystroke and
   * doesn't want a parent setState in the change handler).
   */
  onComposerChange: (next: string) => void;
  /**
   * Lightweight variant of `onComposerChange` that only handles the undo
   * lifecycle (clears the pending-undo when the user edits content that
   * diverges from the post-transcription snapshot). Does NOT call setBody.
   */
  clearUndoOnEdit: (next: string) => void;
}

const TRANSCRIBING_SPINNER_DELAY_MS = 3000;

export function useVoiceInput(setBody: Dispatch<SetStateAction<string>>): UseVoiceInputResult {
  const toastActions = useOptionalToastActions();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcribingSpinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [showTranscribingSpinner, setShowTranscribingSpinner] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);

  const transcribeAndInsert = useCallback(
    async (blob: Blob) => {
      setTranscribing(true);
      setShowTranscribingSpinner(false);
      transcribingSpinnerTimerRef.current = setTimeout(() => {
        setShowTranscribingSpinner(true);
      }, TRANSCRIBING_SPINNER_DELAY_MS);
      try {
        const transcript = await audioApi.transcribe(blob, `voice-${Date.now()}.webm`);
        if (transcript.trim()) {
          let beforeSnapshot = "";
          setBody((current) => {
            beforeSnapshot = current;
            const left = current.trim();
            const right = transcript.trim();
            return left ? `${left} ${right}` : right;
          });
          const left = beforeSnapshot.trim();
          const right = transcript.trim();
          const afterSnapshot = left ? `${left} ${right}` : right;
          setPendingUndo({ before: beforeSnapshot, after: afterSnapshot });
        } else {
          toastActions?.pushToast({
            title: "No speech detected",
            body: "Try again — speak clearly and close to the mic.",
            tone: "warn",
            dedupeKey: "voice-input-empty",
          });
        }
      } catch (err) {
        toastActions?.pushToast({
          title: "Voice transcription failed",
          body: err instanceof Error ? err.message : "Unknown error",
          tone: "error",
          dedupeKey: "voice-input-error",
        });
      } finally {
        if (transcribingSpinnerTimerRef.current) {
          clearTimeout(transcribingSpinnerTimerRef.current);
          transcribingSpinnerTimerRef.current = null;
        }
        setTranscribing(false);
        setShowTranscribingSpinner(false);
      }
    },
    [setBody, toastActions],
  );

  const startRecording = useCallback(async () => {
    if (isRecording || transcribing) return;
    setPendingUndo(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const tracks = mediaStreamRef.current?.getTracks() ?? [];
        tracks.forEach((t) => t.stop());
        mediaStreamRef.current = null;
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        void transcribeAndInsert(blob);
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      toastActions?.pushToast({
        title: "Microphone unavailable",
        body: err instanceof Error ? err.message : "Could not access microphone",
        tone: "error",
        dedupeKey: "voice-input-mic-permission",
      });
    }
  }, [isRecording, transcribing, toastActions, transcribeAndInsert]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const undo = useCallback(() => {
    setPendingUndo((current) => {
      if (current) setBody(current.before);
      return null;
    });
  }, [setBody]);

  const clearUndoOnEdit = useCallback((next: string) => {
    setPendingUndo((current) => (current && next !== current.after ? null : current));
  }, []);

  const onComposerChange = useCallback(
    (next: string) => {
      clearUndoOnEdit(next);
      setBody(next);
    },
    [clearUndoOnEdit, setBody],
  );

  // Cleanup on unmount: pause recorder, release mic tracks, cancel deferred spinner.
  useEffect(() => {
    return () => {
      if (transcribingSpinnerTimerRef.current) {
        clearTimeout(transcribingSpinnerTimerRef.current);
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    isRecording,
    transcribing,
    showTranscribingSpinner,
    canUndo: pendingUndo !== null && !isRecording && !transcribing,
    toggleRecording,
    undo,
    onComposerChange,
    clearUndoOnEdit,
  };
}
