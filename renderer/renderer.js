const Terminal = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;

const tabs = document.querySelectorAll(".tab");
const panes = {
  slides: document.getElementById("pane-slides"),
  terminal: document.getElementById("pane-terminal"),
};
const deckFrame = document.getElementById("deck-frame");
const deckPath = document.getElementById("deck-path");
const placeholder = document.getElementById("slides-placeholder");

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
    setTab(activeTab === "slides" ? "terminal" : "slides");
  }
});

startPty();
