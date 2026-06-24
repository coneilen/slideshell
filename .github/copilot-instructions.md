# Copilot Instructions

## What this app is

**SlideShell** is an **Electron desktop app** that shows three tabs:

- **Slides** — an `<iframe>` that loads a user-chosen self-contained HTML slide deck (the Clawpilot deck format; see `qmd-llmwiki-slide-presentation.html` for the canonical example).
- **Markdown** — renders a user-chosen `.md` file via [`marked`](https://marked.js.org/) + [`DOMPurify`](https://github.com/cure53/DOMPurify). The renderer rewrites relative `<img src>` and `<a href>` to `file://` URLs based on the markdown file's directory so embedded images and intra-wiki links work.
- **Terminal** — an xterm.js terminal wired through IPC to a `node-pty` zsh process running in the Electron main process.

On launch the user picks a deck via the OS file dialog (or the "Open deck…" button); the Terminal tab spawns its pty automatically the first time the renderer loads. `Cmd/Ctrl + \`` cycles through the three tabs in order (slides → markdown → terminal).

## Commands

- `npm install` — installs deps and runs `electron-rebuild -f -w node-pty` via `postinstall` to compile the native pty binding against Electron's Node ABI.
- `npm start` — launches `electron .`.
- `npm run rebuild` — re-run the native rebuild manually (needed after upgrading Electron, switching Node major versions, or if you see `Module did not self-register` / NODE_MODULE_VERSION mismatch errors at startup).

There are no tests or linters configured. Validation is manual: `npm start`, open a deck, switch to Terminal, run a few zsh commands, resize the window, switch back.

## Process architecture

Three layers, communicating only via the channels listed below:

```
 main.js  ── IPC ──  preload.js  ──  window.api  ──  renderer/renderer.js
 (Node)              (bridge)        (renderer)
   │
   └── node-pty zsh processes  (keyed by pid in the `ptys` Map)
```

- **main.js** owns all Node-side state: the `BrowserWindow`, the file dialog, and a `Map<string, IPty>` of live pty processes keyed by their pid (as a string). It is the only place that imports `node-pty`. When the window closes, every pty in the map is killed.
- **preload.js** is the *only* bridge. It uses `contextBridge.exposeInMainWorld("api", …)` to expose `pickDeck()`, `pickMarkdown()`, `readMarkdown(path)` and a `pty` namespace (`spawn`, `write`, `resize`, `kill`, `onData`, `onExit`). The renderer has `contextIsolation: true` and `nodeIntegration: false` — never reach for `require`/`ipcRenderer` directly in renderer code; extend `preload.js` instead.
- **renderer/renderer.js** is an ES module loaded with `<script type="module">`. It imports xterm directly from `node_modules/` via relative paths — there is no bundler. If you add a renderer dependency, either import it the same way or vendor it; do not introduce webpack/vite without discussion.

### IPC channels (the contract)

| Channel        | Direction          | Payload                              | Notes |
|----------------|--------------------|--------------------------------------|-------|
| `deck:pick`    | renderer → main (invoke) | —                              | Returns absolute path string or `null`. |
| `md:pick`      | renderer → main (invoke) | —                              | Returns absolute `.md` path string or `null`. |
| `md:read`      | renderer → main (invoke) | `path: string`                 | Returns `{ path, dir, text }`. The renderer parses + sanitizes; main does not touch HTML. |
| `pty:spawn`    | renderer → main (invoke) | `{ cols, rows }`               | Returns the pty id (its pid as a string). |
| `pty:input`    | renderer → main (send)   | `{ id, data }`                 | Raw keystrokes from xterm `onData`. |
| `pty:resize`   | renderer → main (send)   | `{ id, cols, rows }`           | Wrapped in try/catch in main — a resize racing with exit must not crash. |
| `pty:kill`     | renderer → main (send)   | `{ id }`                       | |
| `pty:data`     | main → renderer    | `{ id, data }`                       | Always filter by `id` in the renderer — there may be multiple ptys later. |
| `pty:exit`     | main → renderer    | `{ id, exitCode, signal }`           | Renderer should null out its `ptyId` and tear down listeners. |

If you add a new channel, register the handler in `main.js`, expose it through `preload.js`, and use it from the renderer — all three layers must change together.

## Key conventions

- **Single source of truth for tab state** is the `activeTab` variable in `renderer.js` plus the `.active` class on `.tab` and `.pane` elements. When switching to the Terminal tab, the code calls `fitAddon.fit()` and re-sends `pty:resize` inside a `requestAnimationFrame` — xterm cannot measure itself while its pane is `display: none`, so any new code that hides/shows the terminal must do the same.
- **Deck loading uses `file://` URLs in an iframe**, not `<webview>`. The CSP in `renderer/index.html` allows `frame-src file:` and `img-src file:` — extend the CSP rather than disabling `webSecurity` if a deck needs more.
- **Clawpilot theme tokens** (`--cp-bg`, `--cp-surface`, `--cp-border`, `--cp-text`, `--cp-text-muted`, `--cp-accent`, `--cp-accent-fg`) drive all chrome styling and have a `prefers-color-scheme: dark` override block. Reuse these tokens; do not hardcode colors in `styles.css`.
- **The bundled sample deck** (`qmd-llmwiki-slide-presentation.html`) is the reference for the deck format the viewer is designed to display: `<article class="slide" data-title="…">` slides inside `<section class="stage">`, a footer with `#prev`/`#next`/`#notes` controls, and keyboard nav (`←/→`, space, `n` for notes, `f` for fullscreen). The viewer does *not* parse or modify the deck — it just renders it in an iframe — so keep the iframe sandbox permissive enough that the deck's own `<script>` runs.
- **Native modules and Electron upgrades.** Bumping the `electron` version requires re-running `npm run rebuild` (or a fresh `npm install`) to recompile `node-pty`. If the app fails to start with a NODE_MODULE_VERSION error, that is almost always the cause.
- **Shell selection.** `main.js` uses `process.env.SHELL || "/bin/zsh"` and spawns it as a login shell (`-l`). Preserve that behaviour so the user's `~/.zprofile`/`~/.zshrc` run as they would in Terminal.app.
