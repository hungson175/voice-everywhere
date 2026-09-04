/**
 * CPU-leak lifecycle tests (TDD — must FAIL before the fix).
 *
 * bar-renderer.js touches `document` at load time so it cannot be required
 * in plain Node. These tests target the extracted lifecycle module
 * ui/audio-lifecycle.js which bar-renderer/stt must use:
 *
 *  - WaveformLoop: exactly one rAF chain; second start() without stop()
 *    must NOT schedule a second chain; stop() always cancels (covers
 *    SUCCESS/CLIPBOARD/ERROR auto-timers + toggle-off mid-PROCESSING).
 *  - TimerRegistry: start/stop cycles must not leak timeouts/intervals
 *    (reminderTimer, autoHideTimer, pendingTranslation).
 *  - SharedAudio: beep() must reuse one lazily-created AudioContext and
 *    suspend/close it when idle (no brand-new context per beep).
 *  - Generation: in-flight async starts invalidated by stop (toggle during
 *    CONNECTING must not resurrect LISTENING).
 *
 * Run: npm test (node --test tests/*.test.js)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  WaveformLoop,
  TimerRegistry,
  SharedAudio,
  Generation,
} = require("../ui/audio-lifecycle.js");

// --- rAF fakes ---

function fakeRaf() {
  let nextId = 0;
  const pending = new Map(); // id -> callback
  let scheduled = 0;
  let cancelled = 0;
  return {
    requestFrame(cb) {
      nextId += 1;
      pending.set(nextId, cb);
      scheduled += 1;
      return nextId;
    },
    cancelFrame(id) {
      if (pending.delete(id)) cancelled += 1;
    },
    get scheduled() { return scheduled; },
    get cancelled() { return cancelled; },
    get live() { return pending.size; },
    /** Run one tick of every pending callback (real rAF is one-shot). */
    tick() {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb();
    },
  };
}

describe("WaveformLoop — single rAF chain, always cancelled", () => {
  test("second start() without stop() does not schedule a second chain", () => {
    const raf = fakeRaf();
    const loop = new WaveformLoop({
      requestFrame: raf.requestFrame.bind(raf),
      cancelFrame: raf.cancelFrame.bind(raf),
    });
    let draws = 0;
    loop.start(() => { draws += 1; });
    loop.start(() => { draws += 1; }); // BUG today: bar-renderer stacks loops
    assert.equal(raf.live, 1, "two rAF chains scheduled — CPU grows per command");
    raf.tick();
    assert.equal(draws, 1);
    loop.stop();
  });

  test("stop() cancels the chain and is idempotent", () => {
    const raf = fakeRaf();
    const loop = new WaveformLoop({
      requestFrame: raf.requestFrame.bind(raf),
      cancelFrame: raf.cancelFrame.bind(raf),
    });
    loop.start(() => {});
    assert.equal(raf.live, 1);
    loop.stop();
    assert.equal(raf.live, 0, "rAF still live after stop — idle CPU burn");
    assert.equal(loop.active, false);
    loop.stop(); // must not throw / double-cancel
    assert.equal(raf.live, 0);
  });

  test("stop() without start() is a safe no-op", () => {
    const raf = fakeRaf();
    const loop = new WaveformLoop({
      requestFrame: raf.requestFrame.bind(raf),
      cancelFrame: raf.cancelFrame.bind(raf),
    });
    loop.stop();
    assert.equal(loop.active, false);
  });

  test("can restart after stop (toggle back on)", () => {
    const raf = fakeRaf();
    const loop = new WaveformLoop({
      requestFrame: raf.requestFrame.bind(raf),
      cancelFrame: raf.cancelFrame.bind(raf),
    });
    loop.start(() => {});
    loop.stop();
    loop.start(() => {});
    assert.equal(raf.live, 1);
    assert.equal(loop.active, true);
    loop.stop();
  });
});

describe("TimerRegistry — no timer leaks across start/stop cycles", () => {
  test("clear() cancels a pending timeout (autoHide / pendingTranslation)", () => {
    const reg = new TimerRegistry();
    let fired = false;
    reg.setTimeout("autoHide", () => { fired = true; }, 5);
    reg.clear("autoHide");
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.equal(fired, false, "cleared timer still fired — leaks across cycles");
        reg.clearAll();
        resolve();
      }, 25);
    });
  });

  test("clearAll() cancels intervals (reminderTimer) and every named timer", () => {
    const reg = new TimerRegistry();
    let ticks = 0;
    reg.setInterval("reminder", () => { ticks += 1; }, 5);
    reg.setTimeout("autoHide", () => {}, 5);
    reg.clearAll();
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.equal(ticks, 0, "interval survived clearAll — 60s beep leaks when idle");
        resolve();
      }, 25);
    });
  });

  test("re-setting the same name replaces the old timer (no stacking)", async () => {
    const reg = new TimerRegistry();
    let count = 0;
    reg.setTimeout("autoHide", () => { count += 1; }, 10);
    reg.setTimeout("autoHide", () => { count += 10; }, 10);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(count, 10, "old timer was not replaced — SUCCESS timers stack");
    reg.clearAll();
  });
});

// --- SharedAudio fakes ---

function fakeAudioContextFactory() {
  const created = [];
  function create() {
    const ctx = {
      state: "running",
      closed: false,
      suspended: false,
      oscCount: 0,
      createOscillator() {
        const osc = {
          frequency: { value: 0 },
          onended: null,
          connect() {},
          start() {},
          stop() { if (this.onended) this.onended(); },
        };
        ctx.oscCount += 1;
        return osc;
      },
      createGain() {
        return {
          connect() {},
          gain: { value: 0, exponentialRampToValueAtTime() {} },
        };
      },
      get destination() { return {}; },
      get currentTime() { return 0; },
      async suspend() { this.suspended = true; this.state = "suspended"; },
      async resume() { this.suspended = false; this.state = "running"; },
      async close() { this.closed = true; this.state = "closed"; },
    };
    created.push(ctx);
    return ctx;
  }
  return { create, created };
}

describe("SharedAudio — one lazy AudioContext, quiet when idle", () => {
  test("repeated beeps reuse a single AudioContext", () => {
    const f = fakeAudioContextFactory();
    const audio = new SharedAudio({ createContext: f.create });
    audio.beep(660, 0.15, 0.2);
    audio.beep(1200, 0.2, 0.15);
    audio.beep(660, 0.15, 0.2);
    assert.equal(
      f.created.length, 1,
      `created ${f.created.length} AudioContexts for 3 beeps — spins an audio thread per beep`
    );
  });

  test("suspendIdle() suspends the shared context so idle CPU is ~0", async () => {
    const f = fakeAudioContextFactory();
    const audio = new SharedAudio({ createContext: f.create });
    audio.beep(660, 0.15, 0.2);
    await audio.suspendIdle();
    assert.equal(f.created[0].state, "suspended");
  });

  test("closeIdle() closes and drops the context; next beep lazily recreates", async () => {
    const f = fakeAudioContextFactory();
    const audio = new SharedAudio({ createContext: f.create });
    audio.beep(660, 0.15, 0.2);
    await audio.closeIdle();
    assert.equal(f.created[0].closed, true);
    audio.beep(660, 0.15, 0.2);
    assert.equal(f.created.length, 2, "context was not lazily recreated after close");
  });
});

describe("Generation — stale async work never resurrects the mic", () => {
  test("claim after invalidate is stale (toggle during CONNECTING)", () => {
    const gen = new Generation();
    const inFlight = gen.claim(); // startListening claims a generation
    gen.invalidate(); // user toggles off -> stopListening bumps generation
    assert.equal(
      gen.isCurrent(inFlight), false,
      "in-flight start still looks current — mic would flip back to LISTENING after toggle-off"
    );
  });

  test("undisturbed claim stays current", () => {
    const gen = new Generation();
    const id = gen.claim();
    assert.equal(gen.isCurrent(id), true);
  });
});
