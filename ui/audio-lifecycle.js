/**
 * Audio lifecycle helpers — testable, DOM-free idle-CPU guards.
 *
 * bar-renderer.js touches `document` at load time so it cannot be required
 * in plain Node tests. This module holds the lifecycle logic instead:
 *
 *  - WaveformLoop: exactly one requestAnimationFrame chain. A second
 *    start() without stop() is refused (previously every SUCCESS/ERROR
 *    auto-timer stacked another 60fps canvas loop; toggle-off cancelled
 *    only the latest id, leaking the rest forever).
 *  - TimerRegistry: named timeouts/intervals with clear()/clearAll() so
  *    reminderTimer / autoHideTimer cannot leak across
 *    start/stop cycles.
 *  - SharedAudio: one lazily-created AudioContext reused by every beep()
 *    (previously a brand-new context + audio thread per beep), with
 *    suspendIdle()/closeIdle() so idle CPU is ~0.
 *  - Generation: invalidates in-flight async work (toggle-off during
 *    CONNECTING must not resurrect LISTENING when stt.start() resolves).
 *
 * Loaded in bar.html BEFORE bar-renderer.js (browser global) and requireable
 * from Node tests. No DOM access at load time.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  // Browser global for <script> tag usage (nodeIntegration is off).
  root.AudioLifecycle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Single-chain rAF loop. start(draw) schedules exactly one chain;
   * further start() calls while active are refused. stop() always cancels.
   */
  class WaveformLoop {
    /**
     * @param {object} [sched] - { requestFrame, cancelFrame } (injectable for tests)
     */
    constructor(sched = {}) {
      this._request =
        sched.requestFrame ||
        (typeof requestAnimationFrame !== "undefined"
          ? requestAnimationFrame.bind(globalThis)
          : null);
      this._cancel =
        sched.cancelFrame ||
        (typeof cancelAnimationFrame !== "undefined"
          ? cancelAnimationFrame.bind(globalThis)
          : null);
      this._id = null;
    }

    get active() {
      return this._id !== null;
    }

    /**
     * Start the loop; draw() renders ONE frame per tick.
     * @returns {boolean} true if a new chain started, false if already active.
     */
    start(draw) {
      if (this._id !== null) return false; // refuse a second chain
      if (typeof this._request !== "function") return false;
      const tick = () => {
        if (this._id === null) return; // stopped between frames
        this._id = this._request(tick);
        draw();
      };
      this._id = this._request(tick);
      return true;
    }

    /** Cancel the chain; idempotent and safe before start(). */
    stop() {
      if (this._id !== null) {
        try {
          if (typeof this._cancel === "function") this._cancel(this._id);
        } catch {
          // ignore — a stale id must never break teardown
        }
        this._id = null;
      }
    }
  }

  /**
   * Named timers so start/stop cycles can cancel everything by name.
   * Re-setting a name replaces the old timer (no stacking).
   */
  class TimerRegistry {
    constructor() {
      this._timeouts = new Map();
      this._intervals = new Map();
    }

    setTimeout(name, fn, ms) {
      this.clear(name);
      const id = setTimeout(() => {
        this._timeouts.delete(name);
        fn();
      }, ms);
      this._timeouts.set(name, id);
      return id;
    }

    setInterval(name, fn, ms) {
      this.clear(name);
      const id = setInterval(fn, ms);
      this._intervals.set(name, id);
      return id;
    }

    has(name) {
      return this._timeouts.has(name) || this._intervals.has(name);
    }

    clear(name) {
      if (this._timeouts.has(name)) {
        clearTimeout(this._timeouts.get(name));
        this._timeouts.delete(name);
      }
      if (this._intervals.has(name)) {
        clearInterval(this._intervals.get(name));
        this._intervals.delete(name);
      }
    }

    clearAll() {
      for (const id of this._timeouts.values()) clearTimeout(id);
      this._timeouts.clear();
      for (const id of this._intervals.values()) clearInterval(id);
      this._intervals.clear();
    }
  }

  /**
   * One lazily-created AudioContext shared by all beeps.
   * suspendIdle() quiets the audio thread when the mic is off;
   * closeIdle() fully releases it (next beep recreates lazily).
   */
  class SharedAudio {
    /**
     * @param {object} [deps] - { createContext } (injectable for tests)
     */
    constructor(deps = {}) {
      this._create =
        deps.createContext ||
        (() => new AudioContext()); // eslint-disable-line no-undef
      this._ctx = null;
    }

    get context() {
      return this._ctx;
    }

    _ensure() {
      if (!this._ctx || this._ctx.state === "closed") {
        this._ctx = this._create();
      } else if (this._ctx.state === "suspended" && typeof this._ctx.resume === "function") {
        try {
          const r = this._ctx.resume();
          if (r && typeof r.catch === "function") r.catch(() => {});
        } catch {
          // resume failure is non-fatal; the beep below still plays or drops
        }
      }
      return this._ctx;
    }

    /** Play a short beep through the shared context (never leaks one). */
    beep(freq, volume, duration) {
      const ctx = this._ensure();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.value = volume;
      if (gain.gain.exponentialRampToValueAtTime) {
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      }
      osc.start();
      osc.stop(ctx.currentTime + duration);
      // Shared context stays open for reuse — call suspendIdle()/closeIdle()
      // when the mic goes idle. The one-shot osc/gain nodes are GC'd.
    }

    /** Suspend the audio thread so idle CPU is ~0 (keeps ctx for reuse). */
    async suspendIdle() {
      if (this._ctx && this._ctx.state === "running" && typeof this._ctx.suspend === "function") {
        try {
          await this._ctx.suspend();
        } catch {
          // non-fatal
        }
      }
    }

    /** Fully close and drop the context; the next beep recreates it. */
    async closeIdle() {
      if (this._ctx) {
        const ctx = this._ctx;
        this._ctx = null;
        if (typeof ctx.close === "function") {
          try {
            await ctx.close();
          } catch {
            // non-fatal
          }
        }
      }
    }
  }

  /**
   * Generation counter: claim() an id before async work, invalidate() on
   * stop, isCurrent(id) to drop stale completions.
   */
  class Generation {
    constructor() {
      this.current = 0;
    }

    claim() {
      this.current += 1;
      return this.current;
    }

    invalidate() {
      this.current += 1;
      return this.current;
    }

    isCurrent(id) {
      return id === this.current;
    }
  }

  return { WaveformLoop, TimerRegistry, SharedAudio, Generation };
});
