/**
 * Credential storage — plain JSON file.
 *
 * Stores API keys in:
 *   ~/Library/Application Support/voice-everywhere/credentials.json
 *
 * Previously used Electron safeStorage (macOS Keychain), but that breaks
 * across unsigned rebuilds (different code-signing identity = can't decrypt).
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function getCredentialsPath() {
  return path.join(app.getPath("userData"), "credentials.json");
}

function readStore() {
  const filePath = getCredentialsPath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data) {
  const filePath = getCredentialsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function hasCredentials() {
  const store = readStore();
  return !!(store.geminiKey && store.sonioxKey);
}

function getCredentials() {
  const store = readStore();
  return {
    geminiKey: store.geminiKey || "",
    sonioxKey: store.sonioxKey || "",
  };
}

function saveCredentials(geminiKey, sonioxKey) {
  writeStore({ geminiKey, sonioxKey });
}

function saveGeminiKey(geminiKey) {
  const store = readStore();
  store.geminiKey = geminiKey;
  writeStore(store);
}

function clearCredentials() {
  const filePath = getCredentialsPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { hasCredentials, getCredentials, saveCredentials, saveGeminiKey, clearCredentials };
