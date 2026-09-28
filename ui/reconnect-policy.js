/**
 * Reconnect policy — what the bar does when the speech-to-text connection
 * drops. DOM-free, so it is tested in plain Node (like audio-lifecycle.js).
 *
 *  - ReconnectPolicy: bounded exponential backoff (1 s, 2 s, 4 s … capped),
 *    giving up after maxAttempts. The count resets only after a connection
 *    stayed up stableMs — resetting on every reconnect let a flapping
 *    connection retry forever at 1 s.
 *  - decideOnDrop: a lost connection (err.transient !== false) is retried; a
 *    definite refusal (bad key, no mic) never is.
 *  - afterFeedback: after SUCCESS / CLIPBOARD / ERROR the bar returns to
 *    LISTENING only if the engine is really live.
 *
 * Ported from AI-teams-controller (useVoiceRecorder scheduleReconnect).
 * Loaded in bar.html before bar-renderer.js (browser global) and requireable
 * from Node tests.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ReconnectPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class ReconnectPolicy {
    constructor({
      baseMs = 1000,
      maxMs = 16000,
      maxAttempts = 5,
      stableMs = 30000,
      now = () => Date.now(),
    } = {}) {
      this.baseMs = baseMs;
      this.maxMs = maxMs;
      this.maxAttempts = maxAttempts;
      this.stableMs = stableMs;
      this._now = now;
      this.attempt = 0;
      this._connectedAt = null;
    }

    /** The engine is live again. */
    connected() {
      this._connectedAt = this._now();
    }

    /** Delay before the next attempt, or null when the attempts are used up. */
    nextDelay() {
      if (this._connectedAt !== null && this._now() - this._connectedAt >= this.stableMs) {
        this.attempt = 0;
      }
      this._connectedAt = null;
      this.attempt += 1;
      if (this.attempt > this.maxAttempts) return null;
      return Math.min(this.baseMs * 2 ** (this.attempt - 1), this.maxMs);
    }

    /** A fresh session started by the user. */
    reset() {
      this.attempt = 0;
      this._connectedAt = null;
    }
  }

  /**
   * @returns {{action:"retry", delay:number, attempt:number, maxAttempts:number}
   *          | {action:"fail", reason:"refused"|"gave-up"}}
   */
  function decideOnDrop(err, policy) {
    if (err && err.transient === false) return { action: "fail", reason: "refused" };
    const delay = policy.nextDelay();
    if (delay === null) return { action: "fail", reason: "gave-up" };
    return { action: "retry", delay, attempt: policy.attempt, maxAttempts: policy.maxAttempts };
  }

  /** @returns {"LISTENING"|"RECONNECTING"|"HIDDEN"} */
  function afterFeedback({ sttLive, reconnectPending }) {
    if (sttLive) return "LISTENING";
    if (reconnectPending) return "RECONNECTING";
    return "HIDDEN";
  }

  return { ReconnectPolicy, decideOnDrop, afterFeedback };
});
