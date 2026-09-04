// --- Default Soniox terms (used as fallback and reset target) ---
const DEFAULT_TERMS = [
  "Claude Code", "tmux", "tm-send", "LLM", "API", "GitHub",
  "pytest", "uv", "pnpm", "Celery", "Redis", "FastAPI",
  "Docker", "Kubernetes", "git", "npm", "pip", "debug",
  "refactor", "deploy", "endpoint", "middleware", "async", "await",
  "webhook", "caching", "SSH", "localhost", "frontend", "backend",
  "TypeScript", "Python", "logging", "PM", "FE", "BE",
  "CR", "DK", "SA", "gbrain", "Garry Tan", "sbrain",
  "Sonnet"
];

const DEFAULT_TRANSLATION_TERMS = [
  { source: "cross code", target: "Claude Code" },
  { source: "cloud code", target: "Claude Code" },
  { source: "cloth code", target: "Claude Code" },
  { source: "tea mux", target: "tmux" },
  { source: "tee mux", target: "tmux" },
  { source: "T mux", target: "tmux" },
  { source: "TMAX", target: "tmux" },
  { source: "tm send", target: "tm-send" },
  { source: "T M send", target: "tm-send" },
  { source: "team send", target: "tm-send" },
  { source: "time send", target: "tm-send" },
  { source: "L M", target: "LLM" },
  { source: "L.M.", target: "LLM" },
  { source: "elem", target: "LLM" },
  { source: "L M M", target: "LLM" },
  { source: "lốc", target: "logging" },
  { source: "lốc lốc", target: "logging" },
  { source: "sắc lốc", target: "logging" },
  { source: "log lốc", target: "logging" },
  { source: "A.P.I", target: "API" },
  { source: "a p i", target: "API" },
  { source: "get hub", target: "GitHub" },
  { source: "git hub", target: "GitHub" },
  { source: "pie test", target: "pytest" },
  { source: "pi test", target: "pytest" },
  { source: "you v", target: "uv" },
  { source: "UV", target: "uv" },
  { source: "pee npm", target: "pnpm" },
  { source: "P NPM", target: "pnpm" },
  { source: "P.M.", target: "PM" },
  { source: "p m", target: "PM" },
  { source: "pee em", target: "PM" },
  { source: "F.E.", target: "FE" },
  { source: "f e", target: "FE" },
  { source: "eff ee", target: "FE" },
  { source: "B.E.", target: "BE" },
  { source: "b e", target: "BE" },
  { source: "bee ee", target: "BE" },
  { source: "C.R.", target: "CR" },
  { source: "c r", target: "CR" },
  { source: "see are", target: "CR" },
  { source: "D.K.", target: "DK" },
  { source: "d k", target: "DK" },
  { source: "dee kay", target: "DK" },
  { source: "S.A.", target: "SA" },
  { source: "s a", target: "SA" },
  { source: "ess ay", target: "SA" },
  { source: "seller e", target: "Celery" },
  { source: "celery", target: "Celery" },
  // gbrain: Boss's knowledge-base tool (garrytan/gbrain); Soniox mishears as gpn or jbrain
  { source: "gpn", target: "gbrain" },
  { source: "gpin", target: "gbrain" },
  { source: "jbrain", target: "gbrain" },
  { source: "gbr ain", target: "gbrain" },
  { source: "gb r a i n", target: "gbrain" },
  // Garry Tan: author of gbrain (garrytan/gbrain); VN accent makes 'Garry Tan' → 'Gariton' or 'Garon'
  { source: "Gariton", target: "Garry Tan" },
  { source: "Garon", target: "Garry Tan" },
  { source: "Garreton", target: "Garry Tan" },
  // sbrain: Boss's company brain (~/data/sbrain); STT mishears 'sbrain' as 'esprint' (schwa-prefix + brain→print). Boss-confirmed 2026-05-30: ALWAYS sbrain, even in Kanban/sprint context — never Scrum 'sprint'.
  { source: "esprint", target: "sbrain" },
  // Sonnet: Claude Sonnet model (e.g. 'Sonnet 4.6'); STT mishears as 'do nét'/'Genet'/'Zellij 4.6'. Boss rates it best-of-world vs MiMo/Gemini/DeepSeek (2026-05-31).
  { source: "do nét", target: "Sonnet" },
  { source: "do net", target: "Sonnet" },
  { source: "Genet", target: "Sonnet" },
];

// --- Settings state (loaded from localStorage) ---
let sonioxTerms = [];
let sonioxTranslationTerms = [];

function loadSettings() {
  // One-time migration: bump TERMS_VERSION when DEFAULT_* change so stale
  // localStorage terms refresh to the new defaults (future syncs propagate too).
  const TERMS_VERSION = "2026-05-31-cc1";
  if (localStorage.getItem("termsVersion") !== TERMS_VERSION) {
    localStorage.removeItem("sonioxTerms");
    localStorage.removeItem("sonioxTranslationTerms");
    localStorage.setItem("termsVersion", TERMS_VERSION);
  }
  try {
    const storedTerms = localStorage.getItem("sonioxTerms");
    sonioxTerms = storedTerms ? JSON.parse(storedTerms) : [...DEFAULT_TERMS];
  } catch {
    sonioxTerms = [...DEFAULT_TERMS];
  }
  try {
    const storedTrans = localStorage.getItem("sonioxTranslationTerms");
    sonioxTranslationTerms = storedTrans ? JSON.parse(storedTrans) : DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  } catch {
    sonioxTranslationTerms = DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  }
}

// DOM elements
const enterModeToggle = document.getElementById("enter-mode-toggle");

// Enter mode (default ON, persisted in localStorage)
const storedEnterMode = localStorage.getItem("enterMode");
enterModeToggle.checked = storedEnterMode === null ? true : storedEnterMode === "true";
enterModeToggle.addEventListener("change", () => {
  localStorage.setItem("enterMode", enterModeToggle.checked);
});

// Output language (default "auto", persisted in localStorage)
const outputLangSelect = document.getElementById("output-lang-select");
outputLangSelect.value = localStorage.getItem("outputLang") || "auto";
outputLangSelect.addEventListener("change", () => {
  localStorage.setItem("outputLang", outputLangSelect.value);
});

// Clean Mode (default OFF, persisted in localStorage)
const cleanModeToggle = document.getElementById("clean-mode-toggle");
cleanModeToggle.checked = localStorage.getItem("cleanMode") === "true";
cleanModeToggle.addEventListener("change", () => {
  localStorage.setItem("cleanMode", cleanModeToggle.checked);
});

// DeepSeek API key for Clean Mode (stored in local credentials file via main)
const deepseekKeyInput = document.getElementById("deepseek-key-input");
let deepseekKeyDirty = false;
deepseekKeyInput.addEventListener("input", () => {
  deepseekKeyDirty = true;
});
deepseekKeyInput.addEventListener("change", async () => {
  if (!deepseekKeyDirty) return;
  deepseekKeyDirty = false;
  const key = deepseekKeyInput.value.trim();
  try {
    await window.voiceEverywhere.saveDeepseekKey(key);
    deepseekKeyInput.value = "";
    deepseekKeyInput.placeholder = key ? "Saved" : "Not set";
  } catch (err) {
    deepseekKeyInput.placeholder = "Save failed";
  }
});
window.voiceEverywhere.getDeepseekKey().then((key) => {
  if (key) deepseekKeyInput.placeholder = "Saved (hidden)";
}).catch(() => {});

// Reset API keys
document.getElementById("reset-keys-btn").addEventListener("click", () => {
  window.voiceEverywhere.resetCredentials();
});

// Quit button
document.getElementById("quit-btn").addEventListener("click", () => {
  window.voiceEverywhere.quitApp();
});

// --- Settings dialog ---
const settingsOverlay = document.getElementById("settings-overlay");
const settingsTermsList = document.getElementById("settings-terms-list");
const settingsTransList = document.getElementById("settings-trans-list");
const settingsTermInput = document.getElementById("settings-term-input");
const settingsTransSource = document.getElementById("settings-trans-source");
const settingsTransTarget = document.getElementById("settings-trans-target");

// Working copies for the dialog (only committed on Save)
let editTerms = [];
let editTranslationTerms = [];

function openSettings() {
  editTerms = [...sonioxTerms];
  editTranslationTerms = sonioxTranslationTerms.map(t => ({ ...t }));
  renderSettingsTerms();
  renderSettingsTranslation();
  settingsOverlay.style.display = "flex";
}

function closeSettings() {
  settingsOverlay.style.display = "none";
  settingsTermInput.value = "";
  settingsTransSource.value = "";
  settingsTransTarget.value = "";
}

function saveSettings() {
  sonioxTerms = [...editTerms];
  sonioxTranslationTerms = editTranslationTerms.map(t => ({ ...t }));
  localStorage.setItem("sonioxTerms", JSON.stringify(sonioxTerms));
  localStorage.setItem("sonioxTranslationTerms", JSON.stringify(sonioxTranslationTerms));
  closeSettings();
}

function resetSettingsToDefaults() {
  editTerms = [...DEFAULT_TERMS];
  editTranslationTerms = DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  renderSettingsTerms();
  renderSettingsTranslation();
}

function renderSettingsTerms() {
  settingsTermsList.innerHTML = "";
  editTerms.forEach((term, i) => {
    const item = document.createElement("div");
    item.className = "settings-item";
    const text = document.createElement("span");
    text.className = "settings-item-text";
    text.textContent = term;
    const del = document.createElement("button");
    del.className = "settings-item-delete";
    del.innerHTML = "&times;";
    del.addEventListener("click", () => {
      editTerms.splice(i, 1);
      renderSettingsTerms();
    });
    item.appendChild(text);
    item.appendChild(del);
    settingsTermsList.appendChild(item);
  });
}

function renderSettingsTranslation() {
  settingsTransList.innerHTML = "";
  editTranslationTerms.forEach((t, i) => {
    const item = document.createElement("div");
    item.className = "settings-item";
    const src = document.createElement("span");
    src.className = "settings-item-text";
    src.textContent = t.source;
    const arrow = document.createElement("span");
    arrow.className = "settings-item-arrow";
    arrow.innerHTML = "&#8594;";
    const tgt = document.createElement("span");
    tgt.className = "settings-item-text";
    tgt.textContent = t.target;
    const del = document.createElement("button");
    del.className = "settings-item-delete";
    del.innerHTML = "&times;";
    del.addEventListener("click", () => {
      editTranslationTerms.splice(i, 1);
      renderSettingsTranslation();
    });
    item.appendChild(src);
    item.appendChild(arrow);
    item.appendChild(tgt);
    item.appendChild(del);
    settingsTransList.appendChild(item);
  });
}

function addTerm() {
  const val = settingsTermInput.value.trim();
  if (!val) return;
  if (editTerms.includes(val)) {
    settingsTermInput.value = "";
    return;
  }
  editTerms.push(val);
  settingsTermInput.value = "";
  renderSettingsTerms();
}

function addTranslationTerm() {
  const src = settingsTransSource.value.trim();
  const tgt = settingsTransTarget.value.trim();
  if (!src || !tgt) return;
  if (editTranslationTerms.some(t => t.source === src && t.target === tgt)) {
    settingsTransSource.value = "";
    settingsTransTarget.value = "";
    return;
  }
  editTranslationTerms.push({ source: src, target: tgt });
  settingsTransSource.value = "";
  settingsTransTarget.value = "";
  renderSettingsTranslation();
}

// Settings event listeners
document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("settings-save").addEventListener("click", saveSettings);
document.getElementById("settings-cancel").addEventListener("click", closeSettings);
document.getElementById("settings-reset").addEventListener("click", resetSettingsToDefaults);
document.getElementById("settings-term-add").addEventListener("click", addTerm);
document.getElementById("settings-trans-add").addEventListener("click", addTranslationTerm);

settingsTermInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTerm();
});
settingsTransTarget.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTranslationTerm();
});

// --- Boot ---
loadSettings();
