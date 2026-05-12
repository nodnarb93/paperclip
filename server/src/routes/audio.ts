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

// PATCH(nodnarb93): tts-polish (Patch 6) + tts-fixes (Patch 7) — convert raw
// markdown / AI-generated content into a string that the TTS engine can speak
// naturally. Two-stage process:
//   1. stripMarkdown(): remove markdown syntax (headings, bold, code, links, ...)
//   2. normalizeForSpeech(): replace TTS-hostile patterns with speech-friendly
//      forms — em-dashes become commas, file paths get segment pauses, common
//      abbreviations expand, decorative unicode is dropped.
// Both are simple regex chains by design — a real markdown parser dep would
// be overkill and harder to tweak per real-world failure case.
function stripMarkdown(input: string): string {
  return input
    // Fenced code blocks (```lang\n...\n```): omit entirely with a hint.
    .replace(/```[\s\S]*?```/g, " (code block omitted) ")
    // Inline code: keep contents, drop backticks.
    .replace(/`([^`]+)`/g, "$1")
    // Images: ![alt](src) -> keep alt text only.
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Links: [text](href) -> keep visible text only.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Heading markers (#, ##, ### etc.) at the start of a line.
    // PATCH(nodnarb93): heading-pause (Patch 16) — strip the # but ALSO
    // append a period to the heading if it doesn't already end in terminal
    // punctuation. Without the period, TTS flows the heading directly into
    // the next line ("Acceptance criteria intake accepted..."), with the
    // period it gets a proper sentence-boundary pause ("Acceptance
    // criteria. Intake accepted..."). Skip if heading already ends in
    // `.`, `!`, `?`, `:`, or `;` so we don't double-stack punctuation.
    .replace(/^#{1,6}[ \t]+([^\n]+?)[ \t]*$/gm, (_match, heading: string) => {
      const trimmed = heading.trim();
      return /[.!?:;]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    })
    // Bold (**text** and __text__) -> keep inner text.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // Italic (*text* and _text_) — careful with underscores in identifiers
    // (e.g. snake_case): require non-word boundaries around _ pairs.
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|\W)_([^_\n]+)_(\W|$)/g, "$1$2$3")
    // Bullet list markers at line start.
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // Numbered list markers at line start.
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Blockquote markers.
    .replace(/^>\s*/gm, "")
    // Horizontal rules (---, ***, ___ on their own line).
    .replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    // Stray HTML tags (e.g. <br>, <details>).
    .replace(/<[^>]+>/g, "")
    // Collapse runs of blank lines.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// PATCH(nodnarb93): tts-fixes (Patch 7) — speech-friendly normalization.
// Applies AFTER markdown stripping. Each rule has a comment naming the
// real-world failure mode it addresses.
function normalizeForSpeech(input: string): string {
  return input
    // ── DASHES → PAUSES ──
    // Em-dash, en-dash, double-hyphen become commas. AI text loves em-dashes
    // for emphasis but XTTS skips them without spaces around. Comma forces a
    // prosodic pause reliably.
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/(\s)--(\s)/g, "$1, $2")
    // ── IDENTIFIER HYPHENS (issue keys, CVEs, etc.) ──
    // PATCH(nodnarb93): hyphen-tts (Patch 12). Patterns like BIZ-117,
    // JIRA-1234, CVE-2024-1234 get read as "B I Z MINUS one one seven" by
    // Kokoro because the hyphen is pronounced. Strip the hyphen so it reads
    // as "B I Z one one seven" — TTS spells the uppercase prefix letter-by-
    // letter and reads the numeric suffix naturally.
    //
    // Match: 2+ uppercase letters/digits, followed by one or more
    // `-alphanumeric-segment` groups. Non-greedy on the prefix to avoid
    // gobbling normal hyphenated compound words. Lowercase tokens like
    // `self-driving` or `iOS-app` do NOT match (prefix must be all-caps).
    .replace(
      /\b([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)\b/g,
      (match) => match.replace(/-/g, " "),
    )
    // ── FILE PATHS / URLs → SEGMENT PAUSES ──
    // Match a multi-segment path like "qa/captures/foo-bar/baz.png" and
    // replace internal slashes with ", " so each segment is spoken with a
    // natural pause. Excludes URLs starting with "http(s)://" (those have
    // their own colon-slash-slash structure we don't want to mangle).
    // Guard: at least two slashes and word chars on both sides.
    .replace(/(?<!:\/)(?<![\w/])(\w[\w.\-]*\/[\w.\-]+(?:\/[\w.\-]+)+)(?!\/)/g, (match) =>
      match.split("/").join(", "),
    )
    // ── BRANCH-NAME-LIKE TOKENS ──
    // Patterns like "feat/BIZ-117-foo" — same slash-to-comma treatment but
    // applies to two-segment forms too (already mostly caught above; this is
    // a belt-and-suspenders pass for "word/word-with-hyphens" forms).
    .replace(/\b([a-z]+)\/([\w\-]+)\b/g, "$1, $2")
    // ── APPROXIMATION TILDE ──
    // "~10 minutes" → "approximately 10 minutes". Only when followed by a
    // number or whitespace+number, not in URLs (e.g. /~user/) or as a
    // standalone character.
    .replace(/(^|\s)~(\d)/g, "$1approximately $2")
    // ── COMMON ABBREVIATIONS ──
    // Order matters: longer phrases first to avoid partial-match issues.
    .replace(/\ba\.k\.a\.?\b/gi, "also known as")
    .replace(/\bi\.e\.?,?\b/gi, "that is,")
    .replace(/\be\.g\.?,?\b/gi, "for example,")
    .replace(/\betc\.?\b/gi, "etcetera")
    .replace(/\bvs\.?\b/gi, "versus")
    .replace(/\bw\/(?=\w)/gi, "with ")
    .replace(/\bw\/o(?=\W|$)/gi, "without")
    // ── SYMBOLS ──
    // & → "and" (most common ambiguity: "& Co." — engine reads "and Co"
    // which is fine). % → "percent" only when adjacent to a digit. @ left
    // alone (engines handle email addresses reasonably).
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\s&\s/g, " and ")
    // ── ELLIPSES ──
    // Three or more dots collapse to the Unicode ellipsis char, which most
    // engines render as a slightly longer pause than a period.
    .replace(/\.{3,}/g, "…")
    // ── DECORATIVE / SYMBOL UNICODE ──
    // Strip checkmarks, crosses, arrows, bullets that the engine either
    // reads weirdly or treats as zero-width. Replace with a comma so they
    // still act as a brief pause where they appeared.
    .replace(/[✅✓✔☑]/g, ", ")
    .replace(/[❌✗✘☒]/g, ", ")
    .replace(/[→←↑↓⇒⇐⇑⇓➡⬅⬆⬇]/g, ", ")
    .replace(/[•·●○◦▪▫■□]/g, ", ")
    .replace(/[🎉🚀💡⚠️ℹ️📝📌🔥]/g, " ")
    // ── CLEANUP ──
    // Collapse runs of commas/spaces created by the above (e.g. ", , ,").
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripMarkdownForTts(input: string): string {
  return normalizeForSpeech(stripMarkdown(input));
}

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

    // PATCH(nodnarb93): whisper-punctuation (Patch 11) — fix run-on-sentence
    // output on longer dictations by enabling two settings:
    //   - vad_filter=true: chunks audio at natural pauses (Voice Activity
    //     Detection). Whisper gets fresh autoregressive context per chunk
    //     instead of one continuous stream, which prevents the model from
    //     "getting stuck in no-punctuation mode" on long inputs. Side
    //     benefit: silence trimming improves perceived accuracy.
    //   - initial_prompt: seeds Whisper with a well-punctuated example so
    //     the model defaults toward the "punctuated style" mode. Effect
    //     is strongest at the start; combined with VAD chunking each chunk
    //     gets its own well-punctuated nudge.
    //   - language=en: skip auto-detect (small WER + reliability win for
    //     a single-language user).
    const initialPrompt =
      "Okay, here is what I am thinking. First, let us walk through the issue carefully. " +
      "Why is this happening? I think we should investigate. Does that make sense? Let me know.";
    const whisperParams = new URLSearchParams({
      encode: "true",
      task: "transcribe",
      output: "json",
      vad_filter: "true",
      language: "en",
      initial_prompt: initialPrompt,
    });
    const whisperUrl = `${opts.whisperServiceUrl}/asr?${whisperParams.toString()}`;
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
    const rawText = typeof body?.text === "string" ? body.text : "";
    const voice = typeof body?.voice === "string" && body.voice.trim().length > 0 ? body.voice : "alloy";
    if (!rawText.trim()) {
      res.status(400).json({ error: "Missing or empty 'text' field" });
      return;
    }
    if (rawText.length > MAX_TTS_TEXT_CHARS) {
      res.status(422).json({ error: `Text exceeds ${MAX_TTS_TEXT_CHARS} characters` });
      return;
    }
    // PATCH(nodnarb93): tts-polish (Patch 6) — strip markdown punctuation
    // before forwarding so the TTS engine doesn't read literal #s and *s.
    const text = stripMarkdownForTts(rawText);
    if (!text.trim()) {
      res.status(400).json({ error: "Text contained no readable content after markdown stripping" });
      return;
    }

    // PATCH(nodnarb93): tts-fixes (Patch 8.1) — removed the abort-on-close
    // machinery from Patch 5. The `res.on("close")` listener + AbortSignal
    // was firing spuriously during normal request lifecycle in some Express
    // / Node 20 / undici combinations, causing the upstream fetch to throw
    // "fetch failed" before it could reach Kokoro. The GPU-cycle savings
    // (avoid TTS-after-modal-close) wasn't worth the bug surface. For a
    // single-user deployment, Kokoro just completes the generation if you
    // close the modal — costs a few seconds of GPU on rare close events.
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
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
      res.status(502).json({
        error: "TTS service unreachable",
        details: err instanceof Error ? err.message : String(err),
        cause: cause ? { code: cause.code, message: cause.message } : undefined,
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
