// PATCH(nodnarb93): voice-input (Patch 3) — client wrapper for the
// /api/audio/transcribe endpoint. Posts a recorded audio blob as multipart,
// returns the transcript string.
import { api } from "./client";

export const audioApi = {
  transcribe: async (blob: Blob, filename = "voice.webm"): Promise<string> => {
    // Re-buffer the blob into a fresh File so fetch's body is self-contained
    // (mirrors the pattern in assets.ts:8-11 — MediaRecorder blobs are owned by
    // the browser and can be invalidated when their stream's tracks stop).
    const buffer = await blob.arrayBuffer();
    const safeFile = new File([buffer], filename, { type: blob.type || "audio/webm" });

    const form = new FormData();
    form.append("audio", safeFile);

    const result = await api.postForm<{ transcript: string }>("/audio/transcribe", form);
    return result.transcript;
  },
};
