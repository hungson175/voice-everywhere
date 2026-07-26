const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scratchpad", {
  onText: (callback) => {
    ipcRenderer.on("scratchpad-text", (_event, text) => callback(text));
  },
});
