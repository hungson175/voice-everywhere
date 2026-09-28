/**
 * Grok relay (Electron main): the renderer's socket to Grok Voice Transcribe.
 *
 * xAI authenticates the socket with an Authorization header, which a browser
 * WebSocket cannot set, and says never to ship the key to a client. So the key
 * stays in main; the renderer streams audio over IPC and gets Grok's messages
 * back. Same design as AI-teams-controller's backend relay (524ab107).
 *
 * Run: npm test
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  GrokRelay,
  grokUrl,
  cleanKeyterms,
  CLOSE_NO_KEY,
  CLOSE_KEY_REJECTED,
} = require("../electron/grok-relay.js");

/** A fake xAI socket the test drives by hand. */
function fakeUpstream() {
  const sockets = [];
  class FakeWS {
    constructor(url, opts) {
      this.url = url;
      this.opts = opts;
      this.readyState = 0;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }
    send(d) { this.sent.push(d); }
    close() { this.closed = true; this.readyState = 3; }
    // test helpers
    open() { this.readyState = 1; this.onopen?.(); }
    message(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
    fail() { this.onerror?.({}); this.readyState = 3; this.onclose?.({ code: 1006, reason: "" }); }
    // Node's WebSocket on a refused handshake (non-101): error, and no close.
    refuse() { this.readyState = 3; this.onerror?.({ message: "non-101 status code" }); }
    drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: "" }); }
  }
  return { FakeWS, sockets };
}

const tick = () => new Promise((r) => setImmediate(r));

function makeRelay({ key = "xai-test", checkKey = async () => 200 } = {}) {
  const { FakeWS, sockets } = fakeUpstream();
  const relay = new GrokRelay({ WebSocketImpl: FakeWS, getKey: () => key, checkKey });
  return { relay, sockets };
}

describe("grokUrl / cleanKeyterms", () => {
  test("asks xAI for 16 kHz PCM, interim results and 300 ms endpointing", () => {
    const url = new URL(grokUrl([]));
    assert.equal(url.origin + url.pathname, "wss://api.x.ai/v1/stt");
    assert.equal(url.searchParams.get("model"), "grok-voice-transcribe-2.0");
    assert.equal(url.searchParams.get("encoding"), "pcm");
    assert.equal(url.searchParams.get("sample_rate"), "16000");
    assert.equal(url.searchParams.get("interim_results"), "true");
    assert.equal(url.searchParams.get("endpointing"), "300");
  });

  test("sends the vocabulary as keyterms", () => {
    const url = new URL(grokUrl(["Claude Code", "tmux"]));
    assert.deepEqual(url.searchParams.getAll("keyterm"), ["Claude Code", "tmux"]);
  });

  test("trims keyterms to what xAI accepts: ≤100 terms, ≤50 chars, no blanks/dupes", () => {
    const many = Array.from({ length: 150 }, (_, i) => `t${i}`);
    assert.equal(cleanKeyterms(many).length, 100);
    assert.deepEqual(cleanKeyterms([" a ", "a", "", "x".repeat(51), 7, "b"]), ["a", "b"]);
    assert.deepEqual(cleanKeyterms("not a list"), []);
  });
});

describe("GrokRelay.open", () => {
  test("connects with the key in an Authorization header, never in the URL", async () => {
    const { relay, sockets } = makeRelay();
    const opening = relay.open("s1", { keyterms: [] }, () => {});
    await tick();
    assert.equal(sockets[0].opts.headers.Authorization, "Bearer xai-test");
    assert.ok(!sockets[0].url.includes("xai-test"));
    sockets[0].open();
    sockets[0].message({ type: "transcript.created", id: "x" });
    assert.deepEqual(await opening, { ok: true });
  });

  test("is ready only once xAI says transcript.created (audio before that is lost)", async () => {
    const { relay, sockets } = makeRelay();
    let settled = false;
    const opening = relay.open("s1", {}, () => {}).then((r) => { settled = true; return r; });
    await tick();
    sockets[0].open();
    await tick();
    assert.equal(settled, false);
    sockets[0].message({ type: "transcript.created" });
    assert.deepEqual(await opening, { ok: true });
  });

  test("no key → definite refusal, no socket opened", async () => {
    const { relay, sockets } = makeRelay({ key: "" });
    const res = await relay.open("s1", {}, () => {});
    assert.equal(res.ok, false);
    assert.equal(res.code, CLOSE_NO_KEY);
    assert.match(res.reason, /XAI_API_KEY/);
    assert.equal(sockets.length, 0);
  });

  test("a failed connect with a rejected key → definite (not retried)", async () => {
    const { relay, sockets } = makeRelay({ checkKey: async () => 401 });
    const opening = relay.open("s1", {}, () => {});
    await tick();
    sockets[0].fail();
    const res = await opening;
    assert.equal(res.code, CLOSE_KEY_REJECTED);
  });

  test("xAI's answer to an incorrect key (HTTP 400) counts as rejected", async () => {
    const { relay, sockets } = makeRelay({ checkKey: async () => 400 });
    const opening = relay.open("s1", {}, () => {});
    await tick();
    sockets[0].fail();
    assert.equal((await opening).code, CLOSE_KEY_REJECTED);
  });

  test("a refused handshake reported only by an error event still settles at once", async () => {
    const { relay, sockets } = makeRelay({ checkKey: async () => 401 });
    const opening = relay.open("s1", {}, () => {});
    await tick();
    sockets[0].refuse();
    const res = await Promise.race([opening, new Promise((r) => setTimeout(() => r("hung"), 200))]);
    assert.equal(res.code, CLOSE_KEY_REJECTED);
  });

  test("a failed connect with a good key → a lost connection (retried)", async () => {
    const { relay, sockets } = makeRelay({ checkKey: async () => 200 });
    const opening = relay.open("s1", {}, () => {});
    await tick();
    sockets[0].fail();
    const res = await opening;
    assert.equal(res.ok, false);
    assert.equal(res.code, 1006);
  });

  test("an xAI error before ready is reported, and the socket closed", async () => {
    const { relay, sockets } = makeRelay();
    const opening = relay.open("s1", {}, () => {});
    await tick();
    sockets[0].open();
    sockets[0].message({ type: "error", message: "bad model" });
    const res = await opening;
    assert.equal(res.ok, false);
    assert.match(res.reason, /bad model/);
    assert.equal(sockets[0].closed, true);
  });

  test("closed by the renderer while opening → the late socket is closed, not kept", async () => {
    const { relay, sockets } = makeRelay();
    const opening = relay.open("s1", {}, () => {});
    await tick();
    relay.close("s1");
    sockets[0].open();
    sockets[0].message({ type: "transcript.created" });
    const res = await opening;
    assert.equal(res.ok, false);
    assert.equal(sockets[0].closed, true);
    assert.equal(relay.size, 0);
  });
});

describe("GrokRelay streaming", () => {
  async function openSession(relay, sockets, events) {
    const opening = relay.open("s1", {}, (ev) => events.push(ev));
    await tick();
    const ws = sockets[sockets.length - 1];
    ws.open();
    ws.message({ type: "transcript.created" });
    await opening;
    return ws;
  }

  test("audio goes upstream; Grok's messages come back as text", async () => {
    const { relay, sockets } = makeRelay();
    const events = [];
    const ws = await openSession(relay, sockets, events);

    const chunk = new Int16Array([1, 2, 3]).buffer;
    relay.audio("s1", chunk);
    assert.equal(ws.sent.length, 1);

    ws.message({ type: "transcript.partial", text: "hi", is_final: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "message");
    assert.equal(JSON.parse(events[0].data).text, "hi");
  });

  test("audio for an unknown or closed session is dropped", async () => {
    const { relay, sockets } = makeRelay();
    const ws = await openSession(relay, sockets, []);
    relay.close("s1");
    relay.audio("s1", new ArrayBuffer(2));
    relay.audio("nope", new ArrayBuffer(2));
    assert.equal(ws.sent.length, 0);
  });

  test("xAI dropping the socket is reported once as a close", async () => {
    const { relay, sockets } = makeRelay();
    const events = [];
    const ws = await openSession(relay, sockets, events);
    ws.drop(1011);
    assert.deepEqual(events, [{ type: "close", code: 1011, reason: "" }]);
    assert.equal(relay.size, 0);
  });

  test("close() by the renderer is silent and closes upstream", async () => {
    const { relay, sockets } = makeRelay();
    const events = [];
    const ws = await openSession(relay, sockets, events);
    relay.close("s1");
    ws.drop(1000);
    assert.equal(ws.closed, true);
    assert.deepEqual(events, []);
  });

  test("closeAll() (renderer reloaded / app quits) closes every session", async () => {
    const { relay, sockets } = makeRelay();
    const ws = await openSession(relay, sockets, []);
    relay.closeAll();
    assert.equal(ws.closed, true);
    assert.equal(relay.size, 0);
  });
});
