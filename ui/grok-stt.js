/**
 * Grok STT client — Grok Voice Transcribe 2.0, through the main-process relay.
 *
 * The renderer never holds the xAI key: xAI's socket needs an Authorization
 * header (a browser WebSocket cannot set one), so electron/grok-relay.js holds
 * the key and this engine talks to it over IPC. GrokIpcSocket makes that IPC
 * session look like a WebSocket, so MicStreamSTT (stt.js) runs the mic,
 * connect guard, teardown and drop reporting unchanged.
 *
 * Turning Grok's messages into text is GrokTranscript's job (grok-transcript.js).
 *
 * Loaded in bar.html after stt.js and grok-transcript.js (browser globals
 * MicStreamSTT, sttError, GrokTranscript); requireable from Node tests.
 */

/** Relay close codes that retrying will not fix (see electron/grok-relay.js). */
const GROK_DEFINITE_CLOSE_CODES = new Set([4001, 4003]);

class GrokIpcSocket {
  /**
   * @param {object} bridge - window.voiceEverywhere.grok
   * @param {string} sessionId
   * @param {{keyterms: string[]}} options
   */
  constructor(bridge, sessionId, options) {
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._bridge = bridge;
    this._id = sessionId;
    this._unsubscribe = bridge.onEvent((id, event) => {
      if (id === this._id) this._event(event);
    });
    bridge.open(sessionId, options).then(
      (result) => {
        if (this.readyState === 3) return; // closed while opening
        if (result && result.ok) {
          this.readyState = 1;
          this.onopen?.();
        } else {
          this._closed(result?.code ?? 1006, result?.reason ?? "Grok connection failed");
        }
      },
      (err) => this._closed(1006, String(err?.message || err))
    );
  }

  _event(event) {
    if (event.type === "message") this.onmessage?.({ data: event.data });
    else if (event.type === "close") this._closed(event.code, event.reason);
  }

  _closed(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this._unsubscribe();
    this.onclose?.({ code, reason });
  }

  send(chunk) {
    if (this.readyState === 1) this._bridge.audio(this._id, chunk);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this._unsubscribe();
    this._bridge.close(this._id);
  }
}

class GrokSTT extends MicStreamSTT {
  /** @param {object} bridge - window.voiceEverywhere.grok */
  constructor(bridge) {
    super("Grok");
    this.bridge = bridge;
    this.transcript = new GrokTranscript();
    this._sessionSeq = 0;
  }

  _beginSession() {
    if (!this.bridge) throw sttError("Grok relay is not available", false);
    this.transcript = new GrokTranscript();
  }

  _openSocket(_apiKey, context) {
    const id = `grok-${Date.now()}-${++this._sessionSeq}`;
    return new GrokIpcSocket(this.bridge, id, { keyterms: (context && context.terms) || [] });
  }

  _closedBeforeReady(e) {
    const definite = GROK_DEFINITE_CLOSE_CODES.has(e && e.code);
    return sttError((e && e.reason) || `Grok connection closed (${e && e.code})`, !definite);
  }

  _handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "error") {
      this.onError?.(sttError(msg.message || "Grok speech-to-text error", true));
      return;
    }
    const update = this.transcript.apply(msg);
    if (!update) return;
    if (update === "final") {
      console.log("[stt] transcript", { stt_model: "grok-voice-transcribe-2.0", text: this.transcript.finalText });
    }
    this.onTranscript?.(this.transcript.displayText, this.transcript.finalText, update === "final", {});
  }

  /**
   * A command was sent (or the bar is starting over): drop the final text, keep
   * speech still in flight — the same as SonioxSTT's reset.
   */
  resetTranscript() {
    this.transcript.consume();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GrokSTT, GrokIpcSocket };
}
