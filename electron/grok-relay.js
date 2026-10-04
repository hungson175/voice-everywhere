/**
 * Grok relay — the bar's connection to Grok Voice Transcribe 2.0 (xAI).
 *
 * xAI authenticates the socket with an Authorization header, which a browser
 * WebSocket cannot set, and says never to ship the key to a client. So the key
 * stays here in main: the renderer opens a session over IPC, streams 16 kHz
 * PCM, and gets Grok's JSON messages back. Same design as AI-teams-controller's
 * backend relay (backend/app/services/stt_providers/grok_stt.py).
 *
 * Close codes toward the renderer: CLOSE_NO_KEY / CLOSE_KEY_REJECTED are
 * definite (retrying will not help); anything else is a lost connection.
 */

"use strict";

const GROK_URL = "wss://api.x.ai/v1/stt";
const GROK_MODEL = "grok-voice-transcribe-2.0";
/** Silence (ms) before xAI closes an utterance (its default is 400). */
const ENDPOINTING_MS = 300;
const READY_TIMEOUT_MS = 10000;

/** xAI's limits on keyterm biasing. */
const MAX_KEYTERMS = 100;
const MAX_KEYTERM_CHARS = 50;

/**
 * The only two languages this app speaks. xAI's `language` parameter cannot
 * lock recognition (the model always auto-detects), it only steers number /
 * currency formatting — but pinning it to vi/en is the closest the API has
 * to "expect Vietnamese or English", and anything else is never sent.
 */
const GROK_LANGUAGES = new Set(["vi", "en"]);

function cleanLanguage(raw) {
  const lang = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return GROK_LANGUAGES.has(lang) ? lang : "";
}

const CLOSE_NO_KEY = 4001;
const CLOSE_KEY_REJECTED = 4003;

/**
 * Statuses of GET /v1/models that mean "this key is bad". xAI answers an
 * incorrect key with 400 ("Incorrect API key provided"), not 401.
 */
const KEY_REJECTED_STATUSES = new Set([400, 401, 403]);

function cleanKeyterms(raw) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "string") continue;
    const term = item.trim();
    if (!term || term.length > MAX_KEYTERM_CHARS || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length === MAX_KEYTERMS) break;
  }
  return out;
}

function grokUrl(keyterms, { language } = {}) {
  const params = new URLSearchParams([
    ["model", GROK_MODEL],
    ["encoding", "pcm"],
    ["sample_rate", "16000"],
    ["interim_results", "true"],
    ["endpointing", String(ENDPOINTING_MS)],
  ]);
  const lang = cleanLanguage(language);
  if (lang) params.append("language", lang);
  for (const term of cleanKeyterms(keyterms)) params.append("keyterm", term);
  return `${GROK_URL}?${params}`;
}

/** HTTP status of a cheap authenticated call — tells a bad key from a bad network. */
async function checkXaiKey(key) {
  try {
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

class GrokRelay {
  /**
   * @param {object} deps
   * @param {Function} [deps.WebSocketImpl] - WebSocket class accepting { headers }
   * @param {() => string} deps.getKey - the xAI key, read at every open
   * @param {(key: string) => Promise<number>} [deps.checkKey]
   */
  constructor({ WebSocketImpl = globalThis.WebSocket, getKey, checkKey = checkXaiKey }) {
    this._WebSocket = WebSocketImpl;
    this._getKey = getKey;
    this._checkKey = checkKey;
    this._sessions = new Map(); // sessionId → upstream socket
  }

  get size() {
    return this._sessions.size;
  }

  /**
   * Open a session; resolves once Grok is ready for audio.
   * @param {string} sessionId
   * @param {{keyterms?: string[]}} options
   * @param {(event: {type:"message", data:string} | {type:"close", code:number, reason:string}) => void} emit
   * @returns {Promise<{ok:true} | {ok:false, code:number, reason:string}>}
   */
  async open(sessionId, { keyterms, language } = {}, emit) {
    const key = (this._getKey() || "").trim();
    if (!key) {
      return { ok: false, code: CLOSE_NO_KEY, reason: "No Grok key — add XAI_API_KEY to .env" };
    }

    const ws = new this._WebSocket(grokUrl(keyterms, { language }), {
      headers: { Authorization: `Bearer ${key}` },
    });
    ws.binaryType = "arraybuffer";
    this._sessions.set(sessionId, ws);
    const mine = () => this._sessions.get(sessionId) === ws;

    const outcome = await new Promise((resolve) => {
      let opened = false;
      const timer = setTimeout(
        () => resolve({ ok: false, code: 1006, reason: "Grok did not become ready" }),
        READY_TIMEOUT_MS
      );
      const done = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      ws.onopen = () => {
        opened = true;
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type === "transcript.created") done({ ok: true });
        else if (msg.type === "error") {
          done({ ok: false, code: 1011, reason: msg.message || "Grok speech-to-text error" });
        }
      };
      // The handshake failed. A bad key and a bad network look the same here,
      // so ask xAI once. Node's WebSocket reports a refused handshake with an
      // error event and NO close, so both paths lead here (once).
      let failing = false;
      const handshakeFailed = async (code) => {
        if (failing) return;
        failing = true;
        const status = await this._checkKey(key);
        if (KEY_REJECTED_STATUSES.has(status)) {
          return done({ ok: false, code: CLOSE_KEY_REJECTED, reason: "Grok key rejected (XAI_API_KEY)" });
        }
        done({ ok: false, code: code || 1006, reason: "Grok connection failed" });
      };
      ws.onerror = () => {
        if (!opened) handshakeFailed(1006);
      };
      ws.onclose = (event) => {
        if (opened) return done({ ok: false, code: event.code || 1006, reason: "Grok closed before it was ready" });
        handshakeFailed(event.code);
      };
    });

    if (!outcome.ok || !mine()) {
      this._detach(ws);
      if (mine()) this._sessions.delete(sessionId);
      return outcome.ok ? { ok: false, code: 1000, reason: "closed while opening" } : outcome;
    }

    ws.onmessage = (event) => emit({ type: "message", data: String(event.data) });
    ws.onerror = () => {};
    ws.onclose = (event) => {
      if (!mine()) return;
      this._sessions.delete(sessionId);
      emit({ type: "close", code: event.code, reason: event.reason || "" });
    };
    return { ok: true };
  }

  /** One chunk of 16-bit PCM for Grok. Dropped unless the session is live. */
  audio(sessionId, chunk) {
    const ws = this._sessions.get(sessionId);
    if (ws && ws.readyState === 1) ws.send(chunk);
  }

  /** The renderer ended the session. Silent: no close event goes back. */
  close(sessionId) {
    const ws = this._sessions.get(sessionId);
    if (!ws) return;
    this._sessions.delete(sessionId);
    this._detach(ws);
  }

  closeAll() {
    for (const id of [...this._sessions.keys()]) this.close(id);
  }

  _detach(ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      // already gone
    }
  }
}

module.exports = {
  GrokRelay,
  grokUrl,
  cleanKeyterms,
  cleanLanguage,
  GROK_LANGUAGES,
  checkXaiKey,
  CLOSE_NO_KEY,
  CLOSE_KEY_REJECTED,
};
