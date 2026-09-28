/**
 * SonioxSTT tells the bar WHY a session ended, so the bar can choose between
 * reconnecting and telling the user.
 *
 *  - The live socket closing on its own (network blip, server restart, the
 *    300-minute stream limit) → onClose(err) with err.transient = true.
 *  - Soniox error_message: server-side trouble (408/429/5xx) is transient; a
 *    refusal (bad key 401, bad request 400, no credit 402…) is definite.
 *  - A socket error event is NOT reported on its own: a close always follows
 *    it, and reporting both used to tear the session down twice.
 *  - stop() is silent: closing our own socket must not look like a drop.
 *
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const SonioxSTT = require("../ui/stt.js");
const config = require("../config.json");

function createStt() {
  const stt = new SonioxSTT();
  stt.setConfig(config.soniox);
  return stt;
}

/** A socket that is already open and handed to _attachSocket, as start() does. */
function liveSocket(stt) {
  const ws = { readyState: 1, sent: [], send(d) { this.sent.push(d); }, close() {} };
  stt.ws = ws;
  stt._attachSocket(ws);
  return ws;
}

test("the live socket closing on its own is reported as a transient drop", () => {
  const stt = createStt();
  const drops = [];
  stt.onClose = (err) => drops.push(err);
  const ws = liveSocket(stt);

  ws.onclose({ code: 1006, reason: "" });

  assert.equal(drops.length, 1);
  assert.equal(drops[0].transient, true);
  assert.match(drops[0].message, /1006/);
});

test("a socket error event alone reports nothing (the close that follows does)", () => {
  const stt = createStt();
  const errors = [];
  const drops = [];
  stt.onError = (e) => errors.push(e);
  stt.onClose = (e) => drops.push(e);
  const ws = liveSocket(stt);

  ws.onerror({ type: "error" });
  assert.equal(errors.length + drops.length, 0);

  ws.onclose({ code: 1006, reason: "" });
  assert.equal(drops.length, 1);
});

test("stop() never reports a drop", async () => {
  const stt = createStt();
  const drops = [];
  stt.onClose = (e) => drops.push(e);
  const ws = liveSocket(stt);
  const onclose = ws.onclose;

  await stt.stop();
  // Even if a late close event still reaches the old handler, it is ignored.
  onclose?.({ code: 1000, reason: "" });

  assert.equal(drops.length, 0);
});

for (const [code, transient] of [[408, true], [429, true], [500, true], [503, true], [400, false], [401, false], [402, false]]) {
  test(`Soniox error_code ${code} → transient=${transient}`, () => {
    const stt = createStt();
    let got;
    stt.onError = (e) => { got = e; };
    liveSocket(stt);

    stt._handleMessage({ data: JSON.stringify({ error_code: code, error_message: "x" }) });

    assert.equal(got.transient, transient);
  });
}

test("an error without a code is treated as definite (shown, not retried forever)", () => {
  const stt = createStt();
  let got;
  stt.onError = (e) => { got = e; };
  stt._handleMessage({ data: JSON.stringify({ error_message: "Incorrect API key provided" }) });
  assert.equal(got.transient, false);
  assert.equal(got.message, "Incorrect API key provided");
});

test("a refused microphone is definite — retrying will not grant it", async () => {
  const stt = createStt();
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          const err = new Error("Permission denied");
          err.name = "NotAllowedError";
          throw err;
        },
      },
    },
  });
  try {
    await assert.rejects(stt.start("k"), (err) => err.transient === false);
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete globalThis.navigator;
  }
});
