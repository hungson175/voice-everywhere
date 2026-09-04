/**
 * Soniox STT client — runs in renderer process.
 *
 * Uses Web Audio API for mic capture, WebSocket for Soniox streaming.
 *
 * CRITICAL PROTOCOL:
 * 1. Send JSON config FIRST (text frame)
 * 2. Then binary audio ONLY (no more JSON!)
 */

class SonioxSTT {
  constructor() {
    this.ws = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.analyser = null;
    this.stream = null;
    this.originalTranscript = "";
    this.translationTranscript = "";
    this.translationEnabled = false;
    this.onTranscript = null; // (fullTranscript, finalTranscript, hasFinal) => void
    this.onError = null; // (error) => void
    this.sonioxConfig = null; // loaded from config.json
    this._connectReject = null; // settle fn for the in-flight connect await
  }

  /**
   * Set Soniox config from config.json (called once at init).
   */
  setConfig(sonioxConfig) {
    this.sonioxConfig = sonioxConfig;
  }

  /**
   * Start mic capture and connect to Soniox.
   * @param {string} apiKey
   * @param {object} [context] - Soniox context injection object
   * @param {object} [sessionOptions] - Optional Soniox session fields such as translation
   */
  async start(apiKey, context, sessionOptions = {}) {
    if (!this.sonioxConfig) {
      throw new Error("Soniox config not set — call setConfig() first");
    }

    const cfg = this.sonioxConfig;
    this.originalTranscript = "";
    this.translationTranscript = "";
    this.translationEnabled = !!sessionOptions.translation;

    // Clean up any stale session first (rapid toggle safety). stop() nulls
    // handles synchronously so the fresh pipeline below owns new objects.
    if (this.ws || this.stream || this.audioContext) {
      await this.stop();
    }

    // Get microphone
    console.log("[stt] Requesting mic...");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: cfg.num_channels,
        sampleRate: { ideal: cfg.sample_rate },
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Set up Web Audio pipeline
    this.audioContext = new AudioContext({ sampleRate: cfg.sample_rate });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.source = source;

    // AnalyserNode for waveform visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // ScriptProcessorNode for raw PCM access
    this.processor = this.audioContext.createScriptProcessor(
      cfg.chunk_size || 4096,
      cfg.num_channels,
      cfg.num_channels
    );

    console.log("[stt] Mic OK, sample rate:", this.audioContext.sampleRate);

    // Connect to Soniox WebSocket
    console.log("[stt] Connecting to", cfg.ws_url);
    this.ws = new WebSocket(cfg.ws_url);
    const pendingWs = this.ws;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Soniox connection timeout")),
        10000
      );
      const settle = () => {
        clearTimeout(timeout);
        this._connectReject = null;
      };
      // stop() calls this to fail fast instead of hanging until timeout/open.
      this._connectReject = (err) => {
        settle();
        reject(err);
      };
      pendingWs.onopen = () => {
        settle();
        resolve();
      };
      pendingWs.onerror = () => {
        settle();
        reject(new Error("Soniox connection failed"));
      };
    });

    // Stopped (or restarted) while connecting — close the orphaned socket
    // and abort instead of resurrecting a session after toggle-off.
    if (this.ws !== pendingWs) {
      try {
        pendingWs.close();
      } catch {
        // ignore — socket may already be gone
      }
      throw new Error("stopped while connecting");
    }

    console.log("[stt] Connected! Sending config...");

    // CRITICAL: Send JSON config as FIRST message
    const initMsg = this._buildInitMessage(apiKey, context, sessionOptions);

    console.log("[stt] Init msg:", JSON.stringify(initMsg, null, 2));
    this.ws.send(JSON.stringify(initMsg));

    // Handle incoming tokens
    this.ws.onmessage = (event) => this._handleMessage(event);
    this.ws.onerror = (e) => {
      console.error("[stt] WS error:", e);
      this.onError?.(new Error("Soniox WebSocket error"));
    };
    this.ws.onclose = (e) => {
      console.log("[stt] WS closed: code=" + e.code + " reason=" + e.reason);
    };

    // Stream audio chunks as binary
    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = this._float32ToInt16(float32);
        this.ws.send(int16.buffer);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    console.log("[stt] Audio pipeline connected, streaming...");
  }

  _buildInitMessage(apiKey, context, sessionOptions = {}) {
    const cfg = this.sonioxConfig;
    const initMsg = {
      api_key: apiKey,
      model: cfg.model,
      sample_rate: cfg.sample_rate,
      num_channels: cfg.num_channels,
      audio_format: cfg.audio_format,
    };
    if (cfg.language_hints) initMsg.language_hints = cfg.language_hints;
    if (cfg.language_hints_strict != null) {
      initMsg.language_hints_strict = cfg.language_hints_strict;
    }
    if (context) initMsg.context = context;
    if (sessionOptions.translation) {
      initMsg.translation = sessionOptions.translation;
      initMsg.enable_language_identification = true;
    }
    return initMsg;
  }

  /**
   * Get the AnalyserNode for waveform visualization.
   */
  getAnalyser() {
    return this.analyser;
  }

  /**
   * Stop mic and disconnect. Fully tears down the pipeline so idle CPU/GPU
   * is ~0: disconnects the MediaStreamSource + analyser + processor nodes,
   * clears onaudioprocess and WebSocket handlers (a late close/error can
   * never call back into the app), stops ALL getUserMedia tracks, closes
   * the socket cleanly, and awaits audioContext.close().
   *
   * Idempotent: handles are nulled synchronously, so concurrent/double
   * stops and rapid start→stop→start races close nothing twice. Async but
   * safe to call without await (teardown of captured refs continues in the
   * background while new sessions own fresh objects).
   */
  async stop() {
    // Fail a pending connect await immediately (toggle-off mid-CONNECTING)
    // instead of leaving start() hanging until timeout/open.
    if (this._connectReject) {
      const rejectConnect = this._connectReject;
      this._connectReject = null;
      try {
        rejectConnect(new Error("stopped while connecting"));
      } catch {
        // ignore — teardown must never throw
      }
    }

    // Detach callbacks FIRST so in-flight audio/socket events cannot
    // resurrect the pipeline after teardown begins.
    if (this.processor) {
      try {
        this.processor.onaudioprocess = null;
      } catch {
        // ignore — teardown must never throw
      }
    }
    if (this.ws) {
      try {
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
      } catch {
        // ignore — teardown must never throw
      }
    }

    // Capture then null synchronously: makes stop idempotent and makes a
    // concurrent start's fresh handles immune to this teardown.
    const source = this.source;
    const analyser = this.analyser;
    const processor = this.processor;
    const audioContext = this.audioContext;
    const stream = this.stream;
    const ws = this.ws;
    this.source = null;
    this.analyser = null;
    this.processor = null;
    this.audioContext = null;
    this.stream = null;
    this.ws = null;

    for (const node of [source, analyser, processor]) {
      try {
        if (node && typeof node.disconnect === "function") node.disconnect();
      } catch {
        // ignore — best-effort node teardown
      }
    }
    if (stream) {
      try {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore — one bad track must not spare the rest
          }
        });
      } catch {
        // ignore — a broken stream object must not abort teardown
      }
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore — socket may already be gone
      }
    }
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // ignore — context may already be closed
      }
    }
  }

  /**
   * Reset accumulated transcript.
   */
  resetTranscript() {
    this.originalTranscript = "";
    this.translationTranscript = "";
  }

  /**
   * Handle Soniox WebSocket message — parse tokens, accumulate transcript.
   */
  _handleMessage(event) {
    try {
      const data = JSON.parse(event.data);

      if (data.error_message) {
        this.onError?.(new Error(data.error_message));
        return;
      }

      const tokens = data.tokens || [];
      let originalFinalText = "";
      let originalInterimText = "";
      let translationFinalText = "";
      let translationInterimText = "";

      for (const token of tokens) {
        const isTranslation = token.translation_status === "translation";
        if (isTranslation && token.is_final) {
          translationFinalText += token.text;
        } else if (isTranslation) {
          translationInterimText += token.text;
        } else if (token.is_final) {
          originalFinalText += token.text;
        } else {
          originalInterimText += token.text;
        }
      }

      if (originalFinalText) {
        this.originalTranscript += originalFinalText;
        console.log("[stt] transcript", {
          stt_model: this.sonioxConfig.model,
          text: originalFinalText,
        });
      }
      if (translationFinalText) {
        this.translationTranscript += translationFinalText;
        console.log("[stt] translation", {
          stt_model: this.sonioxConfig.model,
          text: translationFinalText,
        });
      }

      const originalFull = this.originalTranscript + originalInterimText;
      const translationFull = this.translationTranscript + translationInterimText;
      const displayFull = this.translationEnabled && translationFull
        ? translationFull
        : originalFull;
      const displayFinal = this.translationEnabled && this.translationTranscript
        ? this.translationTranscript
        : this.originalTranscript;

      this.onTranscript?.(
        displayFull,
        displayFinal,
        !!(translationFinalText || originalFinalText),
        {
          originalFull,
          originalFinal: this.originalTranscript,
          translationFull,
          translationFinal: this.translationTranscript,
          hasOriginalFinal: !!originalFinalText,
          hasTranslationFinal: !!translationFinalText,
        }
      );
    } catch (err) {
      console.error("STT message parse error:", err);
    }
  }

  /**
   * Convert Float32 audio samples to Int16 PCM.
   */
  _float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = SonioxSTT;
}
