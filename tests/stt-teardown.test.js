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
