// PATCH(nodnarb93): voice-input (Patch 3) — POST /api/audio/transcribe.
// Forwards a multipart audio upload to the whisper-asr-webservice sidecar and
// returns just the transcript string. The whisper service runs in the same
// Docker network at PAPERCLIP_WHISPER_URL (defaults to http://whisper:9000).
import { Router, type Request, type Response as ExpressResponse } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import { assertAuthenticated } from "./authz.js";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

interface UploadedAudio {
  mimetype: string;
  buffer: Buffer;
  originalname: string;
}

type RequestWithFile = Request & { file?: UploadedAudio };

export function audioRoutes(_db: Db, opts: { whisperServiceUrl: string }) {
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

  return router;
}
