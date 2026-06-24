const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickDeck: () => ipcRenderer.invoke("deck:pick"),

  pickMarkdown: () => ipcRenderer.invoke("md:pick"),
  readMarkdown: (filePath) => ipcRenderer.invoke("md:read", filePath),

  pty: {
    spawn: (size) => ipcRenderer.invoke("pty:spawn", size),
    write: (id, data) => ipcRenderer.send("pty:input", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("pty:resize", { id, cols, rows }),
    kill: (id) => ipcRenderer.send("pty:kill", { id }),
    onData: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("pty:data", listener);
      return () => ipcRenderer.removeListener("pty:data", listener);
    },
    onExit: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("pty:exit", listener);
      return () => ipcRenderer.removeListener("pty:exit", listener);
    },
  },
});
