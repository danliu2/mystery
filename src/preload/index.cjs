const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "bootstrap",
  "lobby",
  "start",
  "view",
  "act",
  "ack",
  "pause",
  "resume",
  "abandon",
  "review",
  "rest",
  "rosterReset",
  "saves",
  "load",
  "deleteSave",
  "settings",
  "reloadProvider",
  "testProvider",
  "budget",
  "manual",
  "updateSettings",
];
const api = {};
for (const method of methods)
  api[method] = async (payload = null) => {
    const result = await ipcRenderer.invoke(`mystery:${method}`, payload);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
api.onView = (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on("mystery:viewChanged", listener);
  return () => ipcRenderer.removeListener("mystery:viewChanged", listener);
};
contextBridge.exposeInMainWorld("mystery", api);
