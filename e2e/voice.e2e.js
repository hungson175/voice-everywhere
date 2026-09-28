/**
 * End-to-end: the real app, a fake microphone, real Soniox and Grok.
 *
 * Launches Electron with Chromium's fake audio capture playing a recorded
 * command ("Kiểm tra lại cái backend giúp tao, thank you." — loops), toggles
 * the mic the way the global shortcut does, and catches the text at the
 * insert-text IPC so nothing is pasted into whatever app has focus.
 *
 * Isolated from an installed copy: its own user-data dir (only
 * credentials.json is copied in). Needs network, the stored Soniox key and
 * XAI_API_KEY in .env. Not part of `npm test`; run: npm run e2e
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const WAV = path.join(__dirname, "fixtures", "voice-command.wav");
const REAL_USER_DATA = path.join(os.homedir(), "Library", "Application Support", "voice-everywhere");
const EXPECTED = /Kiểm tra lại cái backend giúp tao/i;

let app;
let bar;
let userData;

before(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ve-e2e-"));
  fs.copyFileSync(path.join(REAL_USER_DATA, "credentials.json"), path.join(userData, "credentials.json"));

  app = await electron.launch({
    args: [
      ROOT,
      `--user-data-dir=${userData}`,
      // The sandboxed audio service cannot read the WAV: without this the
      // fake mic is silent. Test launch only.
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV}`,
    ],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });

  // Catch text at the insert step instead of pasting it anywhere.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__inserted = [];
    ipcMain.removeHandler("insert-text");
    ipcMain.handle("insert-text", (_event, payload) => {
      globalThis.__inserted.push({ ...payload, at: Date.now() });
      return { success: true };
    });
  });

  bar = await findWindow((url) => url.endsWith("/ui/bar.html"));
  if (process.env.E2E_DEBUG) {
    const t0 = Date.now();
    bar.on("console", (m) => console.log(`[bar +${((Date.now() - t0) / 1000).toFixed(1)}s]`, m.text().slice(0, 160)));
  }
  await bar.waitForFunction(() => typeof stt !== "undefined" && typeof appConfig !== "undefined" && appConfig);
});

after(async () => {
  await app?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

async function findWindow(match) {
  for (let i = 0; i < 50; i++) {
    const win = app.windows().find((w) => match(w.url()));
    if (win) return win;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("window not found");
}

/** Press the global shortcut, as far as the bar can tell. */
async function toggleMic() {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("/ui/bar.html"));
    win.webContents.send("toggle-mic");
  });
}

async function inserted() {
  return app.evaluate(() => globalThis.__inserted);
}

/**
 * The first whole command inserted after `fromIndex`. The fake mic loops the
 * clip and may start mid-clip, so a leading fragment is skipped.
 */
async function waitForCommand(fromIndex = 0, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await inserted()).slice(fromIndex).find((i) => EXPECTED.test(i.text));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no whole command inserted; got ${JSON.stringify((await inserted()).map((i) => i.text))}`);
}

async function barState() {
  return bar.evaluate(() => ({ state, text: document.getElementById("transcript-text").textContent }));
}

async function waitForState(want, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await barState();
    if (last.state === want) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`bar never reached ${want}; last: ${JSON.stringify(last)}`);
}

async function session(engine, drop) {
  await bar.evaluate((id) => localStorage.setItem("sttEngine", id), engine);
  await app.evaluate(() => { globalThis.__inserted = []; });

  await toggleMic();
  await waitForState("LISTENING");
  assert.equal(await bar.evaluate(() => sttEngineId), engine);

  await waitForCommand();

  // The connection drops while listening: the bar must say so, reconnect by
  // itself, and keep inserting commands.
  await waitForState("LISTENING");
  await bar.evaluate(drop);
  const reconnecting = await barState();
  assert.equal(reconnecting.state, "CONNECTING");
  assert.match(reconnecting.text, /Reconnecting/);
  await waitForState("LISTENING");
  await waitForCommand((await inserted()).length);

  // It drops right after a paste, while the bar shows SUCCESS. The feedback
  // timer must not switch the bar off in the middle of the reconnect.
  await waitForState("SUCCESS");
  await bar.evaluate(drop);
  await waitForCommand((await inserted()).length);
  assert.notEqual((await barState()).state, "HIDDEN");

  await toggleMic();
  await waitForState("HIDDEN");
  assert.equal(await bar.evaluate(() => stt.ws), null, "socket left open after toggle-off");
}

test("Soniox: speech → command inserted; a dropped socket reconnects", async () => {
  // A real browser WebSocket closing under us, as a network drop would.
  await session("soniox", () => stt.ws.onclose({ code: 1006, reason: "e2e drop" }));
});

test("Grok: speech → command inserted through the relay; a relay drop reconnects", async () => {
  await session("grok", () => stt.ws._event({ type: "close", code: 1006, reason: "e2e drop" }));
});

test("the xAI key never reaches the bar renderer", async () => {
  const key = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^XAI_API_KEY=(.*)$/m)?.[1]?.trim();
  assert.ok(key, "XAI_API_KEY missing from .env");
  const leaked = await bar.evaluate((k) => {
    const seen = JSON.stringify(Object.keys(window.voiceEverywhere));
    return document.documentElement.outerHTML.includes(k) || seen.includes(k);
  }, key);
  assert.equal(leaked, false);
});
