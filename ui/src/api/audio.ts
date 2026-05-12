// PATCH(nodnarb93): voice-input (Patch 3) — client wrapper for the
// /api/audio/transcribe endpoint. Posts a recorded audio blob as multipart,
// returns the transcript string.
//
// PATCH(nodnarb93): tts-readaloud (Patch 5) — client wrapper for the
// /api/audio/synthesize endpoint. Posts text JSON, returns the audio bytes as
// a Blob (browser can then create a blob: URL and play it via <audio>).
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

  synthesize: async (
    text: string,
    options?: { voice?: string; signal?: AbortSignal },
  ): Promise<Blob> => {
    // Direct fetch (not via api.post) because we need a Blob response, not
    // JSON. credentials: "include" matches request() in client.ts.
    const response = await fetch("/api/audio/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        text,
        ...(options?.voice ? { voice: options.voice } : {}),
      }),
      signal: options?.signal,
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      throw new Error(
        (errBody as { error?: string } | null)?.error ??
          `Synthesis failed: ${response.status}`,
      );
    }
    return response.blob();
  },
};
