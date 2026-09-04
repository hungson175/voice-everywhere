const { app, BrowserWindow, Tray, ipcMain, session, globalShortcut, screen, systemPreferences, dialog } = require("electron");

// Disable ScreenCaptureKit — Chromium enables it by default on macOS,
// causing GPU process to burn CPU even though we only need the mic.
app.commandLine.appendSwitch("disable-features", "ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma,TimeoutHangingVideoCaptureStarts");

// Keep app running when all windows are closed (lives in tray)
app.on("window-all-closed", () => {
  // Don't quit on macOS — app stays in tray
  if (process.platform !== "darwin") app.quit();
});
const path = require("path");
const fs = require("fs");

const textInserter = require("./text-inserter");
const credentials = require("./credentials");
const { createScratchpadUpdate } = require("../ui/scratchpad-model");

// --- PATH fix for packaged app (Finder doesn't inherit shell PATH) ---
if (app.isPackaged) {
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  process.env.PATH = `${process.env.PATH}:${extraPaths.join(":")}`;
}

// --- Config path: extraResources when packaged, project root in dev ---
const configPath = app.isPackaged
  ? path.join(process.resourcesPath, "config.json")
  : path.join(__dirname, "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// --- Load the locally stored Soniox credential ---
function loadApiKeys() {
  // Only source: stored credentials (user-entered via setup page)
  // No shell env, no .env fallback — avoids stale/expired key confusion
  credentials.removeLegacyGeminiKey();
  const creds = credentials.getCredentials();
  if (creds.sonioxKey) process.env.SONIOX_API_KEY = creds.sonioxKey;
  if (creds.deepseekKey) process.env.DEEPSEEK_API_KEY = creds.deepseekKey;
}

loadApiKeys();

// Log which keys are loaded (redacted) for debugging
const sonK = process.env.SONIOX_API_KEY || "";
const dsK = process.env.DEEPSEEK_API_KEY || "";
console.log(`[keys] Soniox: ${sonK ? sonK.slice(0, 8) + "..." + sonK.slice(-4) : "NOT SET"}`);
console.log(`[keys] DeepSeek: ${dsK ? dsK.slice(0, 8) + "..." + dsK.slice(-4) : "NOT SET"}`);

// --- Determine which page to show for settings ---
function getSettingsStartUrl() {
  const needsSetup = !credentials.hasCredentials();
  const page = needsSetup ? "setup.html" : "index.html";
  return `file://${path.join(__dirname, "..", "ui", page)}`;
}

const iconPath = path.join(__dirname, "..", "assets", "circleTemplate.png");
const activeIconPath = path.join(__dirname, "..", "assets", "circle-active.png");

let tray = null;
let settingsWin = null;
let barWin = null;
let scratchpadWin = null;
let scratchpadLoad = null;

async function openScratchpad(text) {
  if (!scratchpadWin || scratchpadWin.isDestroyed()) {
    const win = new BrowserWindow({
      width: 760,
      height: 520,
      minWidth: 520,
      minHeight: 320,
      show: false,
      title: "Voice Everywhere — Scratchpad",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#f3efe4",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "scratchpad-preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    scratchpadWin = win;
    scratchpadLoad = win.loadFile(
      path.join(__dirname, "..", "ui", "scratchpad.html")
    );
    win.on("closed", () => {
      if (scratchpadWin === win) {
        scratchpadWin = null;
        scratchpadLoad = null;
      }
    });
  }

  const win = scratchpadWin;
  await scratchpadLoad;
  if (!win || win.isDestroyed()) {
    throw new Error("Scratchpad closed before it was ready");
  }

  // Snapshot focus before showing the window. The renderer also verifies that
  // the textarea itself is active, so a transcript is inserted at its current
  // caret only when the user is actually editing the existing scratchpad.
  const update = createScratchpadUpdate(text, win.isFocused());
  win.webContents.send("scratchpad-text", update);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return { draftApp: "Scratchpad" };
}

function checkAccessibilityPermission() {
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  if (!trusted) {
    // Prompt macOS to show the Accessibility permission dialog
    systemPreferences.isTrustedAccessibilityClient(true);
    dialog.showMessageBox({
      type: "warning",
      title: "Accessibility Permission Required",
      message: "Voice Everywhere needs Accessibility access to insert text.",
      detail: "Go to System Settings → Privacy & Security → Accessibility, then enable Voice Everywhere. Restart the app after granting permission.",
      buttons: ["Open System Settings", "Later"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        require("child_process").exec("open x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
      }
    });
  }
  return trusted;
}

app.on("ready", () => {
  console.log("Voice Everywhere ready");
  checkAccessibilityPermission();

  // Auto-grant microphone permission
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "media") {
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  // --- Tray icon ---
  tray = new Tray(iconPath);
  tray.setToolTip("Voice Everywhere");
  tray.on("click", () => {
    if (settingsWin) {
      if (settingsWin.isVisible()) {
        settingsWin.focus();
      } else {
        settingsWin.show();
      }
    }
  });

  // --- Settings window (focusable, for API keys / settings) ---
  settingsWin = new BrowserWindow({
    width: 360,
    height: 560,
    show: false,
    resizable: true,
    title: "Voice Everywhere",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  settingsWin.loadURL(getSettingsStartUrl());

  // Hide instead of close (keep running in tray)
  settingsWin.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      settingsWin.hide();
    }
  });

  // --- Bar window (floating, non-focusable) ---
  const display = screen.getPrimaryDisplay();
  const { width: screenW } = display.workAreaSize;
  const screenBottom = display.bounds.y + display.bounds.height; // absolute bottom of screen
  const barWidth = 600;
  const barHeight = 56;
  const barX = Math.round((screenW - barWidth) / 2);
  const barY = screenBottom - barHeight;

  barWin = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x: barX,
    y: barY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  barWin.loadURL(`file://${path.join(__dirname, "..", "ui", "bar.html")}`);
  barWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  barWin.setIgnoreMouseEvents(true, { forward: true });

  // Start shown but visually hidden (CSS handles opacity) —
  // keeping the window "shown" is required for setVisibleOnAllWorkspaces to persist across spaces.
  barWin.showInactive();

  // Global shortcut: Ctrl+Option+Cmd+V to toggle mic
  globalShortcut.register("Control+Option+Command+V", () => {
    if (barWin) {
      barWin.webContents.send("toggle-mic");
    }
  });
});

// Quit properly when app.quit() is called
app.on("before-quit", () => {
  app.isQuitting = true;
});

// macOS: re-show settings window when dock icon clicked
app.on("activate", () => {
  if (settingsWin) settingsWin.show();
});

// --- IPC: Bar window control ---
ipcMain.on("show-bar", () => {
  // Window is always shown — CSS handles visibility (opacity/pointer-events).
  // No-op; kept for IPC compatibility.
});

ipcMain.on("hide-bar", () => {
  // Don't actually hide — the bar CSS handles visibility (opacity 0, pointer-events none).
  // Keeping the window shown avoids breaking setVisibleOnAllWorkspaces across spaces.
});

ipcMain.on("set-ignore-mouse", (_event, ignore) => {
  if (barWin) {
    if (ignore) {
      barWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      barWin.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.on("show-settings", () => {
  if (settingsWin) {
    if (settingsWin.isVisible()) {
      settingsWin.focus();
    } else {
      settingsWin.show();
    }
  }
});

// --- IPC: Save credentials from setup page, then reload to main UI ---
ipcMain.handle("save-credentials", async (_event, { sonioxKey, deepseekKey }) => {
  credentials.saveCredentials(sonioxKey, deepseekKey);
  if (sonioxKey) process.env.SONIOX_API_KEY = sonioxKey;
  if (deepseekKey) process.env.DEEPSEEK_API_KEY = deepseekKey;
  settingsWin.loadURL(
    `file://${path.join(__dirname, "..", "ui", "index.html")}`
  );
});

// --- IPC: Save DeepSeek key from settings (Clean Mode), no page reload ---
ipcMain.handle("save-deepseek-key", async (_event, { deepseekKey }) => {
  credentials.saveDeepseekKey(deepseekKey || "");
  if (deepseekKey) process.env.DEEPSEEK_API_KEY = deepseekKey;
  else delete process.env.DEEPSEEK_API_KEY;
  return { success: true };
});

// --- IPC: Reset credentials, go back to setup ---
ipcMain.handle("reset-credentials", async () => {
  credentials.clearCredentials();
  delete process.env.SONIOX_API_KEY;
  settingsWin.loadURL(
    `file://${path.join(__dirname, "..", "ui", "setup.html")}`
  );
});

// --- IPC: Copy to clipboard ---
ipcMain.handle("copy-to-clipboard", async (_event, text) => {
  const { clipboard } = require("electron");
  clipboard.writeText(text);
});

// --- IPC: Quit app ---
ipcMain.on("quit-app", () => {
  app.quit();
});

// Toggle tray icon when mic state changes
ipcMain.on("mic-state", (_event, isActive) => {
  const icon = isActive ? activeIconPath : iconPath;
  if (tray) tray.setImage(icon);
});

// Provide config to renderer
ipcMain.handle("get-config", async () => config);

// Insert text at cursor in frontmost app
ipcMain.handle("insert-text", async (_event, { text, enterMode }) => {
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    checkAccessibilityPermission();
    return { success: false, error: "accessibility_denied" };
  }
  try {
    const result = await textInserter.insertText(
      text,
      { enterMode },
      { openDraft: openScratchpad }
    );
    return { success: true, ...result };
  } catch (err) {
    console.error("Failed to insert text:", err.message);
    // Never lose the transcript — leave it on the clipboard
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    return { success: false, error: err.message, clipboardFallback: true };
  }
});

// Provide Soniox API key to renderer
ipcMain.handle("get-soniox-key", async () => {
  return process.env.SONIOX_API_KEY || "";
});

// Provide DeepSeek API key to renderer (Clean Mode)
ipcMain.handle("get-deepseek-key", async () => {
  return process.env.DEEPSEEK_API_KEY || "";
});
