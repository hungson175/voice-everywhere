/**
 * SonioxSTT.stop() teardown tests (TDD — must FAIL before the fix).
 *
 * Idle-off CPU burn suspects in ui/stt.js stop():
 *  - MediaStreamSource node is never disconnected (mic graph keeps flowing).
 *  - ScriptProcessorNode.onaudioprocess keeps firing after stop.
 *  - audioContext.close() is fire-and-forget (async race on rapid toggle).
 *  - getUserMedia tracks must ALL stop; WebSocket must close cleanly with
 *    handlers removed so a late onclose/onerror cannot resurrect the bar.
 *  - stop() must be idempotent (double toggle / error-path double stop).
 *
 * Run: npm test (node --test tests/*.test.js)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const SonioxSTT = require("../ui/stt.js");

function fakeTrack() {
  return { stopped: false, stop() { this.stopped = true; } };
}

function wireFakePipeline(stt) {
  const track = fakeTrack();
  const source = { disconnected: false, disconnect() { this.disconnected = true; } };
  const analyser = { disconnected: false, disconnect() { this.disconnected = true; } };
  let closeCalls = 0;
  const audioContext = {
    closed: false,
    async close() { closeCalls += 1; this.closed = true; },
  };
  const processor = {
    disconnected: false,
    onaudioprocess: () => {},
    disconnect() { this.disconnected = true; },
  };
  const wsHandlers = {};
  const ws = {
    closed: false,
    close() {
      this.closed = true;
      // A closing socket must NOT be able to call back into the app.
      assert.equal(wsHandlers.onmessage, null, "ws.onmessage still attached at close");
      assert.equal(wsHandlers.onerror, null, "ws.onerror still attached at close");
      assert.equal(wsHandlers.onclose, null, "ws.onclose still attached at close");
    },
  };
  Object.defineProperties(ws, {
    onmessage: { get: () => wsHandlers.onmessage, set: (v) => { wsHandlers.onmessage = v; } },
    onerror: { get: () => wsHandlers.onerror, set: (v) => { wsHandlers.onerror = v; } },
    onclose: { get: () => wsHandlers.onclose, set: (v) => { wsHandlers.onclose = v; } },
  });
  ws.onmessage = () => {};
  ws.onerror = () => {};
  ws.onclose = () => {};

  stt.source = source;
  stt.analyser = analyser;
  stt.audioContext = audioContext;
  stt.processor = processor;
  const tracks = [track, fakeTrack()];
  stt.stream = { getTracks: () => tracks };
  stt.ws = ws;
  return { source, analyser, audioContext, processor, ws, get closeCalls() { return closeCalls; } };
}

describe("SonioxSTT.stop() — full teardown, zero idle work", () => {
  test("disconnects the MediaStreamSource node", async () => {
    const stt = new SonioxSTT();
    stt.setConfig({ model: "stt-rt-v5" });
    const f = wireFakePipeline(stt);
    await stt.stop();
    assert.equal(f.source.disconnected, true, "source node never disconnected — mic graph keeps flowing");
  });

  test("clears onaudioprocess so the processor can never fire again", async () => {
    const stt = new SonioxSTT();
    stt.setConfig({ model: "stt-rt-v5" });
    const f = wireFakePipeline(stt);
    await stt.stop();
    assert.equal(stt.processor, null);
    assert.equal(f.processor.onaudioprocess, null, "onaudioprocess still attached after stop");
  });

  test("detaches WebSocket handlers before closing", async () => {
    const stt = new SonioxSTT();
    stt.setConfig({ model: "stt-rt-v5" });
    wireFakePipeline(stt); // asserts inside fake ws.close()
    await stt.stop();
    assert.equal(stt.ws, null);
  });

  test("awaits audioContext.close() and nulls every handle", async () => {
    const stt = new SonioxSTT();
    stt.setConfig({ model: "stt-rt-v5" });
    const f = wireFakePipeline(stt);
    const tracks = stt.stream.getTracks();
    await stt.stop();
    assert.equal(f.audioContext.closed, true, "audioContext.close() was not awaited");
    assert.equal(f.closeCalls, 1);
    assert.equal(stt.audioContext, null);
    assert.equal(stt.analyser, null);
    assert.equal(stt.processor, null);
    assert.equal(stt.source, null);
    assert.equal(stt.stream, null);
    assert.equal(stt.ws, null);
    for (const t of tracks) assert.equal(t.stopped, true, "a getUserMedia track kept running");
  });

  test("stop() is idempotent — second call closes nothing twice", async () => {
    const stt = new SonioxSTT();
    stt.setConfig({ model: "stt-rt-v5" });
    const f = wireFakePipeline(stt);
    await stt.stop();
    await stt.stop(); // must not throw or double-close
    assert.equal(f.closeCalls, 1, "audioContext.close() called twice across idempotent stops");
  });

  test("stop() on a never-started client is a safe no-op", async () => {
    const stt = new SonioxSTT();
    stt.setConfig({ model: "stt-rt-v5" });
    await stt.stop();
  });
});

describe("SonioxSTT.start() — stop mid-connect never resurrects a session", () => {
  let savedNavigator;
  let savedAudioContext;
  let savedWebSocket;

  function installFakes(openSockets) {
    // NOTE: Node ≥22 ships a read-only global `navigator`; plain assignment
    // silently fails, so (re)define the globals explicitly.
    savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    savedAudioContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
    savedWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");

    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: async () => ({ getTracks: () => [] }),
        },
      },
      configurable: true,
      writable: true,
    });
    globalThis.AudioContext = function () {      return {
        sampleRate: 16000,
        destination: {},
        createMediaStreamSource: () => ({
          connect() {},
          disconnect() {},
        }),
        createAnalyser: () => ({ fftSize: 0 }),
        createScriptProcessor: () => ({
          connect() {},
          disconnect() {},
          onaudioprocess: null,
        }),
        async close() {},
      };
    };
    globalThis.WebSocket = class {
      static OPEN = 1;
      constructor() {
        this.readyState = 0;
        this.closed = false;
        this.sent = [];
        openSockets.push(this);
      }
      send(d) { this.sent.push(d); }
      close() { this.closed = true; }
      open() {
        this.readyState = 1;
        this.onopen?.();
      }
    };
  }

  function restoreFakes() {
    for (const [key, desc] of [
      ["navigator", savedNavigator],
      ["AudioContext", savedAudioContext],
      ["WebSocket", savedWebSocket],
    ]) {
      if (desc === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, desc);
    }
  }

  test("a late WebSocket open after stop() aborts instead of streaming", async () => {
    const openSockets = [];
    installFakes(openSockets);
    try {
      const stt = new SonioxSTT();
      stt.setConfig({
        model: "stt-rt-v5",
        sample_rate: 16000,
        num_channels: 1,
        audio_format: "pcm_s16le",
        ws_url: "wss://example.invalid",
      });
      const started = stt.start("test-key", {});
      // Let start() run until it is awaiting the socket open.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(openSockets.length, 1);
      await stt.stop(); // user toggles off mid-CONNECTING
      openSockets[0].open(); // server (late) accepts the orphaned socket
      await assert.rejects(started, /stopped while connecting/);
      assert.equal(stt.ws, null, "late open resurrected the socket after stop");
      assert.equal(stt.audioContext, null);
      assert.equal(stt.stream, null);
      assert.equal(stt.processor, null);
    } finally {
      restoreFakes();
    }
  });
});
