/**
 * GrokSTT — the Grok engine as the bar sees it: same contract as SonioxSTT
 * (start/stop/resetTranscript/onTranscript/onError/onClose), audio and
 * messages over the main-process relay (electron/grok-relay.js).
 *
 * Run: npm test
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const SonioxSTT = require("../ui/stt.js");
// Browser globals the engine uses, as bar.html loads them.
globalThis.MicStreamSTT = SonioxSTT.MicStreamSTT;
globalThis.sttError = SonioxSTT.sttError;
globalThis.GrokTranscript = require("../ui/grok-transcript.js");
const { GrokSTT } = require("../ui/grok-stt.js");
const StopWordDetector = require("../ui/stopword.js");
const capture = require("./fixtures/grok-turn-three-pieces.json");

const tick = () => new Promise((r) => setImmediate(r));

/** The preload bridge, faked: records calls, lets the test play main. */
function fakeBridge() {
  const bridge = {
    opened: [],
    audioSent: [],
    closedIds: [],
    listeners: new Set(),
    replies: [],
    open(id, options) {
      bridge.opened.push({ id, options });
      return new Promise((resolve) => bridge.replies.push(resolve));
    },
    audio(id, chunk) { bridge.audioSent.push({ id, chunk }); },
    close(id) { bridge.closedIds.push(id); },
    onEvent(cb) {
      bridge.listeners.add(cb);
      return () => bridge.listeners.delete(cb);
    },
    emit(id, ev) { for (const cb of [...bridge.listeners]) cb(id, ev); },
    reply(result) { bridge.replies.shift()(result); },
  };
  return bridge;
}

function installMic() {
  const saved = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    AudioContext: Object.getOwnPropertyDescriptor(globalThis, "AudioContext"),
  };
  const processors = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
  });
  globalThis.AudioContext = function () {
    return {
      sampleRate: 16000,
      destination: {},
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      createAnalyser: () => ({ fftSize: 0, disconnect() {} }),
      createScriptProcessor: () => {
        const p = { connect() {}, disconnect() {}, onaudioprocess: null };
        processors.push(p);
        return p;
      },
      async close() {},
    };
  };
  const restore = () => {
    for (const [k, d] of Object.entries(saved)) {
      if (d === undefined) delete globalThis[k];
      else Object.defineProperty(globalThis, k, d);
    }
  };
  return { processors, restore };
}

async function startedGrok(bridge, context = { terms: ["Claude Code"] }) {
  const stt = new GrokSTT(bridge);
  const starting = stt.start(undefined, context);
  await tick();
  await tick();
  bridge.reply({ ok: true });
  await starting;
  return stt;
}

function transcriptMsg(obj) {
  return { type: "message", data: JSON.stringify(obj) };
}

describe("GrokSTT", () => {
  test("opens a relay session with the vocabulary as keyterms", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      await startedGrok(bridge);
      assert.equal(bridge.opened.length, 1);
      const { keyterms } = bridge.opened[0].options;
      assert.ok(keyterms.includes("Claude Code"), "user vocabulary is kept");
    } finally {
      mic.restore();
    }
  });

  test("pins the session to Vietnamese formatting + Vietnamese anchor keyterms", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      await startedGrok(bridge);
      assert.equal(bridge.opened.length, 1);
      const { language, keyterms } = bridge.opened[0].options;
      assert.equal(language, "vi");
      for (const anchor of ["rồi", "không", "giúp tao", "kiểm tra"]) {
        assert.ok(keyterms.includes(anchor), `anchor ${anchor} biases xAI toward Vietnamese`);
      }
    } finally {
      mic.restore();
    }
  });

  test("streams 16-bit PCM from the mic to the relay", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      await startedGrok(bridge);
      const processor = mic.processors[mic.processors.length - 1];
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0, 0.5, -1]) } });
      assert.equal(bridge.audioSent.length, 1);
      assert.deepEqual([...new Int16Array(bridge.audioSent[0].chunk)], [0, 16383, -32768]);
    } finally {
      mic.restore();
    }
  });

  test("a real Grok turn + 'Thank you.' gives exactly the spoken command", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      const stt = await startedGrok(bridge);
      const id = bridge.opened[0].id;
      const detector = new StopWordDetector("thank you");
      const commands = [];
      stt.onTranscript = (full, final, hasFinal) => {
        assert.ok(full.startsWith(final), "the display text begins with the final text");
        if (!hasFinal) return;
        const r = detector.process(final);
        if (r.detected && r.command) {
          commands.push(r.command);
          stt.resetTranscript();
        }
      };

      for (const m of capture.messages) bridge.emit(id, transcriptMsg(m));
      bridge.emit(id, transcriptMsg({
        type: "transcript.partial", text: "Thank you.", start: 0.001, duration: 30,
        is_final: true, speech_final: false,
      }));

      assert.deepEqual(commands, [capture.expected]);
    } finally {
      mic.restore();
    }
  });

  test("messages for another session are ignored", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      const stt = await startedGrok(bridge);
      let calls = 0;
      stt.onTranscript = () => { calls += 1; };
      bridge.emit("someone-else", transcriptMsg({ type: "transcript.partial", text: "x", is_final: true, start: 0, duration: 1 }));
      assert.equal(calls, 0);
    } finally {
      mic.restore();
    }
  });

  test("the relay dropping the session is a transient drop", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      const stt = await startedGrok(bridge);
      let drop;
      stt.onClose = (e) => { drop = e; };
      bridge.emit(bridge.opened[0].id, { type: "close", code: 1011, reason: "" });
      assert.equal(drop.transient, true);
    } finally {
      mic.restore();
    }
  });

  test("no key / rejected key at connect is definite", async () => {
    for (const code of [4001, 4003]) {
      const mic = installMic();
      try {
        const bridge = fakeBridge();
        const stt = new GrokSTT(bridge);
        const starting = stt.start(undefined, {});
        await tick();
        await tick();
        bridge.reply({ ok: false, code, reason: "No Grok key — add XAI_API_KEY to .env" });
        await assert.rejects(starting, (err) => err.transient === false && /XAI_API_KEY/.test(err.message));
      } finally {
        mic.restore();
      }
    }
  });

  test("a failed connect otherwise is transient", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      const stt = new GrokSTT(bridge);
      const starting = stt.start(undefined, {});
      await tick();
      await tick();
      bridge.reply({ ok: false, code: 1006, reason: "Grok connection failed" });
      await assert.rejects(starting, (err) => err.transient === true);
    } finally {
      mic.restore();
    }
  });

  test("stop() closes the relay session and reports nothing", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      const stt = await startedGrok(bridge);
      let drops = 0;
      stt.onClose = () => { drops += 1; };
      await stt.stop();
      bridge.emit(bridge.opened[0].id, { type: "close", code: 1000, reason: "" });
      assert.deepEqual(bridge.closedIds, [bridge.opened[0].id]);
      assert.equal(drops, 0);
      assert.equal(bridge.listeners.size, 0, "event listener leaked");
    } finally {
      mic.restore();
    }
  });

  test("stop() while the relay is still opening aborts start()", async () => {
    const mic = installMic();
    try {
      const bridge = fakeBridge();
      const stt = new GrokSTT(bridge);
      const starting = stt.start(undefined, {});
      await tick();
      await tick();
      await stt.stop();
      bridge.reply({ ok: true }); // relay opened late
      await assert.rejects(starting, /stopped while connecting/);
      assert.equal(stt.ws, null);
      assert.ok(bridge.closedIds.includes(bridge.opened[0].id));
    } finally {
      mic.restore();
    }
  });

  test("without the relay bridge, start() fails definitely", async () => {
    const stt = new GrokSTT(undefined);
    await assert.rejects(stt.start(undefined, {}), (err) => err.transient === false);
  });
});
