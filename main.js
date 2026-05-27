const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require("electron");
const path = require("node:path");
const os = require("node:os");
const pty = require("node-pty");

const ptys = new Map();
const iconPath = path.join(__dirname, "assets", "icon.png");
const appIcon = nativeImage.createFromPath(iconPath);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#f7f4ef",
    icon: appIcon,
    title: "SlideShell",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

ipcMain.handle("deck:pick", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Choose a slide deck",
    properties: ["openFile"],
    filters: [{ name: "HTML decks", extensions: ["html", "htm"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("pty:spawn", (event, { cols, rows }) => {
  const shell = process.env.SHELL || "/bin/zsh";
  const proc = pty.spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: process.env.HOME || os.homedir(),
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const id = String(proc.pid);
  ptys.set(id, proc);

  const wc = event.sender;
  proc.onData((data) => {
    if (!wc.isDestroyed()) wc.send("pty:data", { id, data });
  });
  proc.onExit(({ exitCode, signal }) => {
    if (!wc.isDestroyed()) wc.send("pty:exit", { id, exitCode, signal });
    ptys.delete(id);
  });

  return id;
});

ipcMain.on("pty:input", (_event, { id, data }) => {
  const proc = ptys.get(id);
  if (proc) proc.write(data);
});

ipcMain.on("pty:resize", (_event, { id, cols, rows }) => {
  const proc = ptys.get(id);
  if (proc) {
    try { proc.resize(cols, rows); } catch { /* ignore mid-exit resize */ }
  }
});

ipcMain.on("pty:kill", (_event, { id }) => {
  const proc = ptys.get(id);
  if (proc) proc.kill();
  ptys.delete(id);
});

app.whenReady().then(() => {
  if (process.platform === "darwin" && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const proc of ptys.values()) {
    try { proc.kill(); } catch { /* ignore */ }
  }
  ptys.clear();
  if (process.platform !== "darwin") app.quit();
});
