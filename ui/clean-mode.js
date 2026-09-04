/**
 * Clean Mode — rewrite the raw transcript via LLM before text insertion.
 *
 * Pure module: no DOM, no Electron, no localStorage access. Works both in
 * Node (tests) and in the renderer via a plain <script> tag (window.CleanMode).
 *
 * Endpoint default: Huawei ModelArts MaaS (ap-southeast-1, OpenAI-compatible)
 * serving model "deepseek-v4-flash". Verified 2026-09-04: both this endpoint
 * and the direct DeepSeek API list "deepseek-v4-flash" in /models, but MaaS is
 * the default because it is closest to Vietnam (lower latency, ~1s for a tiny
 * rewrite probe) and matches the HUAWEI_MAAS_* credential the user already has.
 * To use the direct DeepSeek API instead, override:
 *   baseURL = "https://api.deepseek.com", model = "deepseek-v4-flash".
 */

"use strict";

const CLEAN_MODE_DEFAULTS = Object.freeze({
  baseURL: "https://api-ap-southeast-1.modelarts-maas.com/openai/v1",
  model: "deepseek-v4-flash",
  timeoutMs: 8000,
});

const CLEAN_MODE_STORAGE_KEYS = Object.freeze({
  enabled: "cleanMode", // "true" | "false" (default OFF)
  baseURL: "cleanModeBaseURL", // optional override
  model: "cleanModeModel", // optional override
});

const FILLER_EXAMPLES = "uhm, uh, ah, er, hmm, ờ, ừm, à, ừ";

function targetLanguageLine(outputLang) {
  if (outputLang === "vietnamese") {
    return [
      "TARGET LANGUAGE: Vietnamese. Rewrite in fluent, natural Vietnamese.",
      "The speaker mixes Vietnamese and English: PRESERVE English technical terms",
      "(API, deploy, endpoint, tmux, GitHub, variable names, product names, etc.)",
      "exactly as-is. Do NOT force-translate every English word into Vietnamese —",
      "only translate ordinary words where a natural Vietnamese equivalent exists,",
      "and never translate proper nouns, code, commands, or technical jargon.",
    ].join(" ");
  }
  if (outputLang === "english") {
    return (
      "TARGET LANGUAGE: English. Rewrite in fluent, natural English, " +
      "keeping technical terms, product names, code, and commands exactly as-is."
    );
  }
  return (
    "TARGET LANGUAGE: keep the speaker's own language (the transcript may be " +
    "English, Vietnamese, or mixed Vietnamese+English). Do NOT translate from " +
    "one language to another — only clean up fluency within the same language, " +
    "preserving any English technical terms exactly as-is."
  );
}

/**
 * Build the chat messages for the rewrite request.
 * @param {object} args
 * @param {string} args.transcript - raw STT transcript
 * @param {string} [args.outputLang] - "auto" | "english" | "vietnamese"
 * @param {string[]} [args.contextTerms] - vocabulary hints (Soniox terms)
 * @returns {Array<{role:string, content:string}>}
 */
function buildCleanMessages({ transcript, outputLang = "auto", contextTerms = [] } = {}) {
  const system = [
    "You rewrite a voice-dictation transcript so it keeps ALL of the speaker's ideas",
    "but reads fluently — it must NOT be a word-for-word copy.",
    "Rules:",
    "1. Preserve all ideas, facts, numbers, names, and intent. Never add new ideas.",
    "2. Remove filler words and disfluencies (" + FILLER_EXAMPLES + "), false starts,",
    "   and repeated words, using surrounding context to fix grammar and fluency.",
    "3. Keep punctuation natural for the target language.",
    targetLanguageLine(outputLang),
    "Output ONLY the rewritten text — no quotes, no explanations, no preamble.",
  ].join(" ");

  const terms = (contextTerms || []).filter((t) => t && t.trim());
  const user =
    "Rewrite this transcript:\n" +
    transcript +
    (terms.length
      ? "\n(Context vocabulary the speaker uses: " + terms.join(", ") + ")"
      : "");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Merge user overrides over the defaults (blank strings fall back to defaults).
 * @param {object} [overrides] - { baseURL, model, timeoutMs }
 */
function resolveCleanConfig(overrides = {}) {
  const baseURL =
    typeof overrides.baseURL === "string" && overrides.baseURL.trim()
      ? overrides.baseURL.replace(/\/+$/, "")
      : CLEAN_MODE_DEFAULTS.baseURL;
  const model =
    typeof overrides.model === "string" && overrides.model.trim()
      ? overrides.model.trim()
      : CLEAN_MODE_DEFAULTS.model;
  const timeoutMs =
    Number.isFinite(overrides.timeoutMs) && overrides.timeoutMs > 0
      ? overrides.timeoutMs
      : CLEAN_MODE_DEFAULTS.timeoutMs;
  return { baseURL, model, timeoutMs };
}

/**
 * Rewrite the transcript via an OpenAI-compatible chat-completions endpoint.
 * Rejects on any failure — the caller must fall back to the raw transcript.
 *
 * @param {object} args
 * @param {string} args.transcript
 * @param {string} args.apiKey
 * @param {string} [args.baseURL]
 * @param {string} [args.model]
 * @param {string} [args.outputLang]
 * @param {string[]} [args.contextTerms]
 * @param {number} [args.timeoutMs]
 * @param {function} [args.fetchImpl] - injectable fetch (tests); defaults to global fetch
 * @returns {Promise<string>} cleaned text (trimmed, non-empty)
 */
async function rewriteTranscript({
  transcript,
  apiKey,
  baseURL,
  model,
  outputLang = "auto",
  contextTerms = [],
  timeoutMs,
  fetchImpl,
} = {}) {
  if (!transcript || !transcript.trim()) {
    throw new Error("Clean Mode: empty transcript, nothing to rewrite");
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Clean Mode: missing API key");
  }
  const fetchFn =
    fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchFn) {
    throw new Error("Clean Mode: no fetch implementation available");
  }

  const cfg = resolveCleanConfig({ baseURL, model, timeoutMs });
  const messages = buildCleanMessages({ transcript, outputLang, contextTerms });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchFn(`${cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.2,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Clean Mode: rewrite request failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new Error("Clean Mode: model returned empty content");
    }
    return content.trim();
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`Clean Mode: rewrite timed out after ${cfg.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const CleanMode = {
  CLEAN_MODE_DEFAULTS,
  CLEAN_MODE_STORAGE_KEYS,
  buildCleanMessages,
  resolveCleanConfig,
  rewriteTranscript,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CleanMode;
}
if (typeof window !== "undefined") {
  window.CleanMode = CleanMode;
}
