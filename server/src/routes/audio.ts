// PATCH(nodnarb93): voice-input (Patch 3) — POST /api/audio/transcribe.
// Forwards a multipart audio upload to the whisper-asr-webservice sidecar and
// returns just the transcript string. The whisper service runs in the same
// Docker network at PAPERCLIP_WHISPER_URL (defaults to http://whisper:9000).
//
// PATCH(nodnarb93): tts-readaloud (Patch 5) — POST /api/audio/synthesize.
// Forwards a JSON text body to the openedai-speech sidecar (OpenAI-compatible
// TTS API) and streams the generated audio bytes back to the client. The TTS
// service runs at PAPERCLIP_TTS_URL (defaults to http://tts:8000).
import { Router, type Request, type Response as ExpressResponse } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import { assertAuthenticated } from "./authz.js";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_TTS_TEXT_CHARS = 50000;

interface UploadedAudio {
  mimetype: string;
  buffer: Buffer;
  originalname: string;
}

type RequestWithFile = Request & { file?: UploadedAudio };

export function audioRoutes(
  _db: Db,
  opts: { whisperServiceUrl: string; ttsServiceUrl: string },
) {
  const router = Router();
  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  });

  async function runSingleFileUpload(req: Request, res: ExpressResponse) {
    await new Promise<void>((resolve, reject) => {
      audioUpload.single("audio")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  router.post("/audio/transcribe", async (req, res) => {
    assertAuthenticated(req);

    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Audio file exceeds ${MAX_AUDIO_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as RequestWithFile).file;
    if (!file) {
      res.status(400).json({ error: "Missing audio file field 'audio'" });
      return;
    }

    const form = new FormData();
    // Wrap the multer Buffer in a fresh Uint8Array so the underlying .buffer
    // is concretely ArrayBuffer (not ArrayBufferLike) — required by current
    // @types/node + DOM lib's BlobPart shape.
    const audioBytes = new Uint8Array(file.buffer);
    form.append(
      "audio_file",
      new Blob([audioBytes], { type: file.mimetype || "audio/webm" }),
      file.originalname || "audio.webm",
    );

    const whisperUrl = `${opts.whisperServiceUrl}/asr?encode=true&task=transcribe&output=json`;
    let whisperResponse;
    try {
      whisperResponse = await fetch(whisperUrl, {
        method: "POST",
        body: form,
      });
    } catch (err) {
      res.status(502).json({
        error: "Whisper service unreachable",
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!whisperResponse.ok) {
      const text = await whisperResponse.text().catch(() => "");
      res.status(502).json({
        error: `Whisper service returned ${whisperResponse.status}`,
        details: text.slice(0, 500),
      });
      return;
    }

    const result = (await whisperResponse.json()) as { text?: string; language?: string };
    res.json({ transcript: (result.text ?? "").trim() });
  });

  // PATCH(nodnarb93): tts-readaloud (Patch 5) — synthesize endpoint.
  // Streams audio bytes from the openedai-speech sidecar directly to the
  // client. Aborts the upstream request if the client disconnects (e.g. modal
  // closed) to avoid wasting GPU cycles on audio nobody's listening to.
  router.post("/audio/synthesize", async (req, res) => {
    assertAuthenticated(req);

    const body = req.body as { text?: unknown; voice?: unknown } | undefined;
    const text = typeof body?.text === "string" ? body.text : "";
    const voice = typeof body?.voice === "string" && body.voice.trim().length > 0 ? body.voice : "alloy";
    if (!text.trim()) {
      res.status(400).json({ error: "Missing or empty 'text' field" });
      return;
    }
    if (text.length > MAX_TTS_TEXT_CHARS) {
      res.status(422).json({ error: `Text exceeds ${MAX_TTS_TEXT_CHARS} characters` });
      return;
    }

    // Propagate client disconnects to the upstream TTS request so we don't
    // keep generating audio for a modal that was closed.
    const upstreamAbort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) upstreamAbort.abort();
    });

    let upstream;
    try {
      upstream = await fetch(`${opts.ttsServiceUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice,
          response_format: "mp3",
        }),
        signal: upstreamAbort.signal,
      });
    } catch (err) {
      if (upstreamAbort.signal.aborted) return; // client disconnected
      res.status(502).json({
        error: "TTS service unreachable",
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      res.status(502).json({
        error: `TTS service returned ${upstream.status}`,
        details: errText.slice(0, 500),
      });
      return;
    }

    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "audio/mpeg",
    );
    res.setHeader("Cache-Control", "no-store");

    if (!upstream.body) {
      res.status(502).json({ error: "TTS service returned no body" });
      return;
    }

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Express's res.write returns false when the internal buffer is full —
        // we don't bother applying backpressure since TTS output is small (a
        // few hundred KB for a typical comment) and the client side is fast.
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      // Abort during piping: client closed connection or upstream errored.
      // Headers are already sent so we can't return a JSON error — just end.
      try {
        reader.cancel();
      } catch {
        // ignore — best-effort cleanup
      }
      if (!res.writableEnded) res.end();
    }
  });

  return router;
}
