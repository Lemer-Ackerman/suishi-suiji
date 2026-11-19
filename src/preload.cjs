const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("daynote", {
  call: (action, payload) =>
    ipcRenderer.invoke("daynote:action", action, payload),
  onState: (callback) =>
    ipcRenderer.on("daynote:state", (_event, state) => callback(state)),
  onStatus: (callback) =>
    ipcRenderer.on("daynote:status", (_event, status) => callback(status)),
});
