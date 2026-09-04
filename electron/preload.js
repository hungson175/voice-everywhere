const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceEverywhere", {
  // Mic state (tray icon)
  setMicState: (isActive) => ipcRenderer.send("mic-state", isActive),

  // Text insertion (clipboard paste + AppleScript)
  insertText: (text, options) => ipcRenderer.invoke("insert-text", { text, ...options }),

  // Soniox API key (for direct WebSocket from renderer)
  getSonioxKey: () => ipcRenderer.invoke("get-soniox-key"),

  // DeepSeek API key (for Clean Mode rewrite from the bar renderer)
  getDeepseekKey: () => ipcRenderer.invoke("get-deepseek-key"),
  saveDeepseekKey: (deepseekKey) =>
    ipcRenderer.invoke("save-deepseek-key", { deepseekKey }),

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),

  // Setup: save Soniox credentials (+ optional DeepSeek key for Clean Mode)
  saveCredentials: (sonioxKey, deepseekKey) =>
    ipcRenderer.invoke("save-credentials", { sonioxKey, deepseekKey }),

  // Reset API keys (back to setup)
  resetCredentials: () => ipcRenderer.invoke("reset-credentials"),

  // Listen for toggle-mic from global shortcut
  onToggleMic: (callback) => ipcRenderer.on("toggle-mic", callback),

  // Copy to clipboard (navigator.clipboard fails in Electron)
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),

  // Quit the app
  quitApp: () => ipcRenderer.send("quit-app"),

  // Bar window control
  showBar: () => ipcRenderer.send("show-bar"),
  hideBar: () => ipcRenderer.send("hide-bar"),
  setMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse", ignore),
  showSettings: () => ipcRenderer.send("show-settings"),
});
