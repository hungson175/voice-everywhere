/**
 * Clean Mode — LLM rewrite of the raw transcript before insertion.
 *
 * Covers ui/clean-mode.js (pure prompt builder + OpenAI-compatible
 * rewrite client) and the settings/pipeline wiring guards.
 *
 * Run: npm test
 * NOTE: all network is mocked (injectable fetch); no secrets in tests.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CLEAN_MODE_DEFAULTS,
  buildCleanMessages,
  resolveCleanConfig,
  rewriteTranscript,
} = require("../ui/clean-mode");

const FAKE_KEY = "test-key-fake";

function mockFetchJson(payload, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

// --- Defaults ---

test("defaults target direct DeepSeek API V4 flash with 8s timeout", () => {
  assert.equal(
    CLEAN_MODE_DEFAULTS.baseURL,
    "https://api.deepseek.com"
  );
  assert.equal(CLEAN_MODE_DEFAULTS.model, "deepseek-v4-flash");
  assert.equal(CLEAN_MODE_DEFAULTS.timeoutMs, 8000);
});

// --- Prompt builder ---

test("buildCleanMessages returns system + user messages with the transcript", () => {
  const messages = buildCleanMessages({
    transcript: "uhm I think we should uh deploy on Friday",
    outputLang: "english",
    contextTerms: [],
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /deploy on Friday/);
  assert.match(messages[0].content, /filler/i);
  assert.match(messages[0].content, /preserve all ideas|keep all ideas|all ideas/i);
});

test("vietnamese target preserves mixed-language English tech terms", () => {
  const [system] = buildCleanMessages({
    transcript: "em deploy cái API này lên production rồi",
    outputLang: "vietnamese",
    contextTerms: [],
  });
  assert.match(system.content, /vietnamese/i);
  assert.match(system.content, /english technical terms|technical terms.*as-is|preserve.*english/i);
  assert.match(system.content, /NOT force-translate|do not force|don't force/i);
});

test("english target asks for fluent english output", () => {
  const [system] = buildCleanMessages({
    transcript: "uh hello world",
    outputLang: "english",
    contextTerms: [],
  });
  assert.match(system.content, /english/i);
});

test("auto target keeps the speaker language without translating", () => {
  const [system] = buildCleanMessages({
    transcript: "xin chào hello world",
    outputLang: "auto",
    contextTerms: [],
  });
  assert.match(system.content, /translat/i);
});

test("context terms are injected into the user message when provided", () => {
  const [, user] = buildCleanMessages({
    transcript: "fix the bug",
    outputLang: "english",
    contextTerms: ["tmux", "Claude Code"],
  });
  assert.match(user.content, /tmux/);
  assert.match(user.content, /Claude Code/);
});

test("empty context terms do not break the user message", () => {
  const [, user] = buildCleanMessages({
    transcript: "fix the bug",
    outputLang: "english",
    contextTerms: [],
  });
  assert.match(user.content, /fix the bug/);
});

// --- Config resolution ---

test("resolveCleanConfig merges overrides, blank strings fall back to defaults", () => {
  const merged = resolveCleanConfig({
    baseURL: "https://api.deepseek.com",
    model: "",
    timeoutMs: 3000,
  });
  assert.equal(merged.baseURL, "https://api.deepseek.com");
  assert.equal(merged.model, CLEAN_MODE_DEFAULTS.model);
  assert.equal(merged.timeoutMs, 3000);
  assert.deepEqual(resolveCleanConfig(), { ...CLEAN_MODE_DEFAULTS });
});

// --- Rewrite client ---

test("rewriteTranscript POSTs OpenAI-compatible body and returns trimmed text", async () => {
  let seen = {};
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "  Deploy on Friday.  " } }],
      }),
    };
  };
  const out = await rewriteTranscript({
    transcript: "uhm deploy uh on Friday",
    apiKey: FAKE_KEY,
    outputLang: "english",
    contextTerms: [],
    fetchImpl,
  });
  assert.equal(out, "Deploy on Friday.");
  assert.equal(seen.url, `${CLEAN_MODE_DEFAULTS.baseURL}/chat/completions`);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(seen.body.model, CLEAN_MODE_DEFAULTS.model);
  assert.equal(seen.body.messages.length, 2);
});

test("rewriteTranscript rejects without calling fetch when key is missing", async () => {
  let called = false;
  await assert.rejects(
    rewriteTranscript({
      transcript: "hello",
      apiKey: "",
      fetchImpl: async () => {
        called = true;
      },
    }),
    /api key/i
  );
  assert.equal(called, false);
});

test("rewriteTranscript rejects on network error", async () => {
  await assert.rejects(
    rewriteTranscript({
      transcript: "hello",
      apiKey: FAKE_KEY,
      fetchImpl: async () => {
        throw new Error("boom");
      },
    })
  );
});

test("rewriteTranscript rejects on non-OK status", async () => {
  await assert.rejects(
    rewriteTranscript({
      transcript: "hello",
      apiKey: FAKE_KEY,
      fetchImpl: mockFetchJson({ error: { message: "nope" } }, { status: 401 }),
    }),
    /401/
  );
});

test("rewriteTranscript rejects on empty model content", async () => {
  await assert.rejects(
    rewriteTranscript({
      transcript: "hello",
      apiKey: FAKE_KEY,
      fetchImpl: mockFetchJson({ choices: [{ message: { content: "   " } }] }),
    }),
    /empty/i
  );
});

test("rewriteTranscript aborts on timeout", async () => {
  let seenSignal = null;
  const fetchImpl = (url, init) =>
    new Promise((_resolve, reject) => {
      seenSignal = init.signal;
      init.signal?.addEventListener("abort", () =>
        reject(new Error("aborted by test harness"))
      );
    });
  await assert.rejects(
    rewriteTranscript({
      transcript: "hello",
      apiKey: FAKE_KEY,
      timeoutMs: 30,
      fetchImpl,
    }),
    /timed out|timeout|abort/i
  );
  assert.equal(seenSignal?.aborted, true);
});

// --- Wiring guards ---

test("bar.html loads clean-mode.js and CSP allows https API calls", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "ui", "bar.html"),
    "utf8"
  );
  assert.match(html, /clean-mode\.js/);
  // connect-src * (or explicit https:) already permits the rewrite API call
  assert.match(html, /connect-src[^"]*(\*|https:)/i);
});

test("settings UI exposes the Clean Mode toggle persisted by renderer.js", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "ui", "index.html"),
    "utf8"
  );
  const renderer = fs.readFileSync(
    path.join(__dirname, "..", "ui", "renderer.js"),
    "utf8"
  );
  assert.match(html, /clean-mode-toggle/);
  assert.match(renderer, /cleanMode/);
});

test("bar pipeline consults Clean Mode before inserting", () => {
  const bar = fs.readFileSync(
    path.join(__dirname, "..", "ui", "bar-renderer.js"),
    "utf8"
  );
  assert.match(bar, /cleanMode|CleanMode|rewriteTranscript/);
  assert.match(bar, /Rewriting/);
});

test("credentials store supports the DeepSeek key without breaking Soniox flow", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "electron", "credentials.js"),
    "utf8"
  );
  assert.match(src, /deepseekKey/);
});
