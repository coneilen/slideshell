const Terminal = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;
const marked = window.marked;
const DOMPurify = window.DOMPurify;

const tabs = document.querySelectorAll(".tab");
const panes = {
  slides: document.getElementById("pane-slides"),
  markdown: document.getElementById("pane-markdown"),
  terminal: document.getElementById("pane-terminal"),
};
const deckFrame = document.getElementById("deck-frame");
const deckPath = document.getElementById("deck-path");
const placeholder = document.getElementById("slides-placeholder");
const mdContent = document.getElementById("md-content");
const mdScroll = document.getElementById("md-scroll");
const mdPlaceholder = document.getElementById("md-placeholder");
const openMdBtn = document.getElementById("open-md");

let activeTab = "slides";

function setTab(name) {
  activeTab = name;
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  }
  for (const [key, el] of Object.entries(panes)) {
    el.classList.toggle("active", key === name);
  }
  openMdBtn.hidden = name !== "markdown";
  if (name === "terminal") {
    requestAnimationFrame(() => {
      fitAddon.fit();
      sendResize();
      term.focus();
    });
  }
}

tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

async function openDeck() {
  const file = await window.api.pickDeck();
  if (!file) return;
  deckFrame.src = "file://" + file;
  deckFrame.hidden = false;
  placeholder.style.display = "none";
  deckPath.textContent = file;
  setTab("slides");
}

document.getElementById("open-deck").addEventListener("click", openDeck);
document.getElementById("open-deck-2").addEventListener("click", openDeck);

marked.setOptions({ gfm: true, breaks: false });

function isAbsoluteUrl(url) {
  return /^([a-z]+:|#|\/\/)/i.test(url);
}

function rewriteRelativePaths(root, baseDir) {
  const base = "file://" + baseDir + "/";
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (src && !isAbsoluteUrl(src) && !src.startsWith("file:")) {
      try { img.src = new URL(src, base).href; } catch { /* ignore */ }
    }
  }
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    if (href.startsWith("#")) continue;
    if (!isAbsoluteUrl(href) && !href.startsWith("file:")) {
      try { a.href = new URL(href, base).href; } catch { /* ignore */ }
    }
    if (/^https?:/i.test(a.href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
}

async function openMarkdown() {
  const filePath = await window.api.pickMarkdown();
  if (!filePath) return;
  try {
    const { text, dir, path: p } = await window.api.readMarkdown(filePath);
    const rawHtml = marked.parse(text);
    const clean = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ["target"],
    });
    mdContent.innerHTML = clean;
    rewriteRelativePaths(mdContent, dir);
    mdPlaceholder.style.display = "none";
    mdScroll.hidden = false;
    mdScroll.scrollTop = 0;
    deckPath.textContent = p;
    setTab("markdown");
  } catch (err) {
    mdContent.innerHTML = `<pre class="md-error">Failed to load markdown:\n${String(err && err.message ? err.message : err)}</pre>`;
    mdPlaceholder.style.display = "none";
    mdScroll.hidden = false;
    setTab("markdown");
  }
}

openMdBtn.addEventListener("click", openMarkdown);
document.getElementById("open-md-2").addEventListener("click", openMarkdown);

const term = new Terminal({
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  cursorBlink: true,
  theme: { background: "#1a1a1a", foreground: "#dedede", cursor: "#fd8ea1" },
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();

let ptyId = null;
let detachData = null;
let detachExit = null;

async function startPty() {
  const { cols, rows } = term;
  ptyId = await window.api.pty.spawn({ cols, rows });
  detachData = window.api.pty.onData(({ id, data }) => {
    if (id === ptyId) term.write(data);
  });
  detachExit = window.api.pty.onExit(({ id }) => {
    if (id === ptyId) {
      term.write("\r\n[process exited]\r\n");
      ptyId = null;
    }
  });
}

term.onData((data) => {
  if (ptyId) window.api.pty.write(ptyId, data);
});

function sendResize() {
  if (!ptyId) return;
  window.api.pty.resize(ptyId, term.cols, term.rows);
}

window.addEventListener("resize", () => {
  if (activeTab === "terminal") {
    fitAddon.fit();
    sendResize();
  }
});

window.addEventListener("beforeunload", () => {
  if (ptyId) window.api.pty.kill(ptyId);
  detachData?.();
  detachExit?.();
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "`") {
    e.preventDefault();
    const order = ["slides", "markdown", "terminal"];
    const idx = order.indexOf(activeTab);
    setTab(order[(idx + 1) % order.length]);
  }
});

startPty();
