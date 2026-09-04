/**
 * Bar renderer — floating voice bar pipeline logic.
 *
 * States: HIDDEN → CONNECTING → LISTENING → PROCESSING → INSERTING → SUCCESS → HIDDEN/LISTENING
 *                                                                       ↓
 *                                                                     ERROR
 */

// --- Default Soniox terms (shared with settings window via localStorage) ---
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

// --- DOM ---
const bar = document.getElementById("bar");
const statusDot = document.getElementById("status-dot");
const waveformCanvas = document.getElementById("waveform");
const waveformCtx = waveformCanvas.getContext("2d");
const transcriptEl = document.getElementById("transcript-text");
const gearBtn = document.getElementById("gear-btn");
const closeBtn = document.getElementById("close-btn");

// --- Services ---
const stt = new SonioxSTT();
let detector = null;

// --- Idle-CPU lifecycle (ui/audio-lifecycle.js, loaded via bar.html) ---
// Single rAF chain (no stacking across SUCCESS/ERROR auto-timers), named
// timers cleared on every stop, one shared AudioContext for beeps, and a
// generation guard so toggle-off mid-CONNECTING can't resurrect LISTENING.
const waveformLoop = new AudioLifecycle.WaveformLoop();
const timers = new AudioLifecycle.TimerRegistry();
const sharedAudio = new AudioLifecycle.SharedAudio();
const startGen = new AudioLifecycle.Generation();

// --- State ---
let state = "HIDDEN"; // HIDDEN, CONNECTING, LISTENING, PROCESSING, INSERTING, SUCCESS, ERROR
let cmdGen = 0; // bumped on stop; invalidates in-flight handleCommandDetected() runs
let sonioxKey = "";
let sonioxTerms = [];
let sonioxTranslationTerms = [];
// NOTE: Soniox is transcription-only (auto language, whatever was said).
// All translation/cleanup happens AFTER the stop word via DeepSeek
// (see maybeRewriteTranscript) — Soniox native translation is NOT used.

// --- Settings from localStorage (shared with settings window) ---
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
    const stored = localStorage.getItem("sonioxTerms");
    sonioxTerms = stored ? JSON.parse(stored) : [...DEFAULT_TERMS];
  } catch { sonioxTerms = [...DEFAULT_TERMS]; }
  try {
    const stored = localStorage.getItem("sonioxTranslationTerms");
    sonioxTranslationTerms = stored ? JSON.parse(stored) : DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t }));
  } catch { sonioxTranslationTerms = DEFAULT_TRANSLATION_TERMS.map(t => ({ ...t })); }
}

// --- State machine ---
function setState(newState, message) {
  state = newState;

  // Remove all state classes
  bar.classList.remove("state-connecting", "state-listening", "state-processing",
    "state-inserting", "state-success", "state-clipboard", "state-error", "hidden", "visible");

  if (newState === "HIDDEN") {
    bar.classList.add("hidden");
    timers.clear("autoHide"); // a pending SUCCESS/ERROR return must not pop the bar back up
    stopWaveform();
    sharedAudio.suspendIdle(); // quiet the shared beep context while off
    window.voiceEverywhere.hideBar(); // really hides the window (near-0 CPU/GPU)
    return;
  }

  bar.classList.add("visible");
  bar.classList.add("state-" + newState.toLowerCase());

  if (message) {
    setTranscriptStatus(message, newState.toLowerCase());
  }

  // After success/error, return to LISTENING (keep bar visible, STT still running).
  // TimerRegistry replaces any pending timer — auto-transitions never stack.
  if (newState === "SUCCESS" || newState === "CLIPBOARD") {
    timers.setTimeout("autoHide", () => {
      stt.resetTranscript();
      setState("LISTENING");
      transcriptEl.textContent = "";
      startWaveform();
    }, newState === "CLIPBOARD" ? 3000 : 1500);
  } else if (newState === "ERROR") {
    timers.setTimeout("autoHide", () => {
      stt.resetTranscript();
      setState("LISTENING");
      transcriptEl.textContent = "";
      startWaveform();
    }, 2000);
  }
}

function setTranscriptStatus(msg, cls) {
  transcriptEl.innerHTML = `<span class="status-msg ${cls}">${escapeHtml(msg)}</span>`;
}

function setTranscriptLive(finalText, interimText) {
  transcriptEl.innerHTML = escapeHtml(finalText) +
    (interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : "");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Waveform rendering (single rAF chain via WaveformLoop) ---
function startWaveform() {
  const analyser = stt.getAnalyser();
  if (!analyser) {
    waveformLoop.stop();
    return;
  }

  const bufLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);

  // The loop owns scheduling; this renders ONE frame per tick. A second
  // start() while active is refused, so SUCCESS/ERROR auto-timers can never
  // stack another 60fps chain and toggle-off cancels the only chain.
  waveformLoop.start(() => {
    analyser.getByteFrequencyData(dataArray);

    const w = waveformCanvas.width;
    const h = waveformCanvas.height;
    waveformCtx.clearRect(0, 0, w, h);

    // Draw bars
    const barCount = 16;
    const barW = w / barCount - 2;
    const step = Math.floor(bufLen / barCount);

    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i * step] / 255;
      const barH = Math.max(2, val * h * 0.9);
      const x = i * (barW + 2);
      const y = (h - barH) / 2;

      waveformCtx.fillStyle = state === "LISTENING"
        ? `rgba(255, 59, 48, ${0.4 + val * 0.6})`
        : `rgba(255, 255, 255, ${0.2 + val * 0.3})`;
      waveformCtx.beginPath();
      waveformCtx.roundRect(x, y, barW, barH, 1.5);
      waveformCtx.fill();
    }
  });
}

function stopWaveform() {
  waveformLoop.stop(); // idempotent — always cancelled when leaving LISTENING/HIDDEN
  waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

// --- Soniox context ---
function buildSonioxContext() {
  return {
    general: [
      { key: "domain", value: "Software Development" },
      { key: "speaker", value: "Vietnamese developer" },
    ],
    terms: [...sonioxTerms],
    translation_terms: sonioxTranslationTerms.map(t => ({ ...t })),
  };
}

// --- Pipeline ---
async function startListening() {
  if (state === "LISTENING" || state === "CONNECTING") return;

  // Cancel any pending auto-transition and clean up any lingering session
  timers.clear("autoHide");
  stopListening(); // invalidates generations, clears timers, stops STT/waveform
  const myStart = startGen.claim(); // stale if a stop lands mid-CONNECTING

  loadSettings();
  if (!sonioxKey) {
    setState("ERROR", "No Soniox key");
    return;
  }

  try {
    window.voiceEverywhere.showBar(); // really re-shows the hidden window
    setState("CONNECTING", "Connecting...");
    window.voiceEverywhere.setMicState(true);

    const context = buildSonioxContext();
    // Transcription-only: no Soniox translation option. The transcript is
    // whatever was said; DeepSeek translates/cleans after the stop word.
    await stt.start(sonioxKey, context);

    // Toggled off (or restarted) while connecting — tear down the stale
    // session instead of resurrecting LISTENING + waveform + reminder.
    if (!startGen.isCurrent(myStart)) {
      stt.stop();
      return;
    }

    setState("LISTENING");
    transcriptEl.textContent = "";
    startWaveform();

    timers.setInterval("reminder", () => beep(660, 0.15, 0.2), 60000);
  } catch (err) {
    if (!startGen.isCurrent(myStart) || state === "HIDDEN") return; // stopped externally while connecting
    console.error("Failed to start:", err);
    setState("ERROR", "Mic error: " + err.message);
    window.voiceEverywhere.setMicState(false);
  }
}

function stopListening() {
  cmdGen++; // invalidate any in-flight command so it won't paste after stop
  startGen.invalidate(); // invalidate any in-flight startListening()
  stt.stop();
  stopWaveform();
  window.voiceEverywhere.setMicState(false);
  timers.clear("reminder");
  sharedAudio.suspendIdle(); // quiet the shared beep context while off
}

// --- Transcript handling (transcription-only: display what was said) ---
function handleTranscript(fullTranscript, finalTranscript, hasFinal) {
  if (state !== "LISTENING") return;

  const interimPart = fullTranscript.slice(finalTranscript.length);
  setTranscriptLive(finalTranscript, interimPart);

  if (hasFinal) {
    const result = detector.process(finalTranscript);
    if (result.detected && result.command) {
      handleCommandDetected(result.command);
    }
  }
}

async function handleCommandDetected(rawCommand) {
  const myGen = ++cmdGen; // claim this generation; a later stop bumps cmdGen past it
  stt.resetTranscript();
  let text = rawCommand.trim();

  // Cancelled while post-processing (user toggled off / restarted) — don't paste into whatever is now focused
  if (myGen !== cmdGen) return;

  // DeepSeek post-step: runs when Clean Mode is ON, or when an output target
  // language is set (translate + clean). Otherwise the raw transcript goes
  // straight to insertion. Any failure falls back to raw — never lost.
  if (text && shouldPostProcessNow()) {
    const rewritten = await maybeRewriteTranscript(text, myGen);
    if (myGen !== cmdGen) return; // stopped during post-process — don't paste
    if (rewritten !== null) text = rewritten;
  }

  // Insert text
  if (text) {
    setState("INSERTING", "Inserting...");
    try {
      const enterMode = localStorage.getItem("enterMode") !== "false";
      const result = await window.voiceEverywhere.insertText(text, { enterMode });
      if (myGen !== cmdGen) return; // stopped during insert — don't pop the bar back up
      if (result.success && result.openedDraft) {
        beep(1200, 0.2, 0.15);
        setState("SUCCESS", `Opened draft in ${result.draftApp || "text editor"}`);
      } else if (result.success && !result.clipboardFallback) {
        beep(1200, 0.2, 0.15);
        setState("SUCCESS", text);
      } else if (result.clipboardFallback) {
        // AX state uncertain (or insert failed) — text kept on clipboard
        beep(700, 0.2, 0.2);
        setState("CLIPBOARD", "Could not verify target — copied, press ⌘V");
      } else {
        setState("ERROR", "Insert failed");
      }
    } catch (err) {
      console.error("Insert failed:", err);
      setState("ERROR", "Insert failed");
    }
  } else {
    stopListening();
    setState("HIDDEN");
  }
}

// --- DeepSeek post-step (translate/clean AFTER the stop word) ---
// Soniox transcribes whatever was said; this step translates to the output
// target language (if set) and/or cleans fluency when Clean Mode is ON.
function getPostProcessSettings() {
  let cleanModeEnabled = false;
  let outputLang = "auto";
  try {
    cleanModeEnabled =
      localStorage.getItem(window.CleanMode?.CLEAN_MODE_STORAGE_KEYS?.enabled || "cleanMode") === "true";
    outputLang = localStorage.getItem("outputLang") || "auto";
  } catch { /* private mode etc. — stay raw */ }
  return { cleanModeEnabled, outputLang };
}

function shouldPostProcessNow() {
  if (!window.CleanMode) return false;
  try {
    return window.CleanMode.shouldPostProcess(getPostProcessSettings());
  } catch { return false; }
}

function getCleanOverrides() {
  const keys = window.CleanMode?.CLEAN_MODE_STORAGE_KEYS || {};
  try {
    return {
      baseURL: localStorage.getItem(keys.baseURL || "cleanModeBaseURL") || undefined,
      model: localStorage.getItem(keys.model || "cleanModeModel") || undefined,
    };
  } catch { return {}; }
}

/**
 * Translate/clean via DeepSeek. Always resolves to insertable text (processed
 * or raw fallback); resolves null only when the run was cancelled mid-flight.
 */
async function maybeRewriteTranscript(text, myGen) {
  const settings = getPostProcessSettings();
  const label = window.CleanMode.postProcessLabel(settings);
  if (!window.CleanMode) {
    console.error("DeepSeek post-step wanted but clean-mode.js failed to load — using original text");
    return text;
  }
  let deepseekKey = "";
  try {
    deepseekKey = await window.voiceEverywhere.getDeepseekKey();
  } catch (err) {
    console.error("DeepSeek post-step: could not load key:", err);
  }
  if (myGen !== cmdGen) return null;
  if (!deepseekKey) {
    console.warn("DeepSeek post-step wanted but no key is set — using original text");
    setState("PROCESSING", "DeepSeek: no key — using original…");
    await new Promise((r) => setTimeout(r, 600));
    return text;
  }
  setState("PROCESSING", label);
  try {
    return await window.CleanMode.rewriteTranscript({
      transcript: text,
      apiKey: deepseekKey,
      ...getCleanOverrides(),
      outputLang: settings.outputLang,
      contextTerms: sonioxTerms,
    });
  } catch (err) {
    console.error("DeepSeek post-step failed, using original text:", err.message || err);
    return text;
  }
}

function isAuthError(errMsg) {
  const lower = errMsg.toLowerCase();
  return lower.includes("401") || lower.includes("403") ||
    lower.includes("unauthorized") || lower.includes("invalid") ||
    lower.includes("authentication") || lower.includes("api key");
}

// --- Beep (shared AudioContext — no brand-new context per call) ---
function beep(freq, volume, duration) {
  try {
    sharedAudio.beep(freq, volume, duration);
  } catch (err) {
    console.error("Beep failed:", err);
  }
}

// --- Button handlers ---
gearBtn.addEventListener("click", () => {
  window.voiceEverywhere.showSettings();
});

closeBtn.addEventListener("click", () => {
  stopListening();
  setState("HIDDEN");
});

// --- Focus management: enable mouse events on bar hover (for drag + buttons) ---
bar.addEventListener("mouseenter", () => {
  window.voiceEverywhere.setMouseEvents(false);
});
bar.addEventListener("mouseleave", () => {
  window.voiceEverywhere.setMouseEvents(true);
});

// --- Toggle mic from global shortcut ---
window.voiceEverywhere.onToggleMic(() => {
  if (state === "HIDDEN") {
    startListening();
  } else {
    // Stop regardless of state (LISTENING, CONNECTING, PROCESSING, INSERTING, SUCCESS, ERROR)
    timers.clear("autoHide");
    stopListening();
    setState("HIDDEN");
  }
});

// --- Init ---
async function init() {
  const config = await window.voiceEverywhere.getConfig();
  sonioxKey = await window.voiceEverywhere.getSonioxKey();

  stt.setConfig(config.soniox);
  detector = new StopWordDetector(config.voice.stop_word);

  stt.onTranscript = handleTranscript;
  stt.onError = (err) => {
    console.error("STT error:", err);
    stopListening();
    setState("ERROR", "STT error");
  };

  loadSettings();
}

init();
