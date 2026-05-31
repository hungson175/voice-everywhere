/**
 * LLM voice correction service — fixes STT errors using Gemini 2.5 Flash Lite
 * (non-reasoning) via Google's OpenAI-compatible endpoint.
 */

const STT_FIXES = `## Fix These STT Errors (Boss's vocabulary — synced from command-center voice_corrections.json)
- "cross code" / "cloud code" / "cloth code" → "Claude Code"
- "tea mux" / "tee mux" / "T mux" / "TMAX" → "tmux"
- "tm send" / "T M send" / "team send" / "time send" → "tm-send"
- "L M" / "L.M." / "elem" / "L M M" → "LLM"
- "lốc" / "lốc lốc" / "sắc lốc" / "log lốc" → "logging"
- "A.P.I" / "a p i" → "API"
- "get hub" / "git hub" → "GitHub"
- "pie test" / "pi test" → "pytest"
- "you v" / "UV" → "uv"
- "pee npm" / "P NPM" → "pnpm"
- "P.M." / "p m" / "pee em" → "PM"
- "F.E." / "f e" / "eff ee" → "FE"
- "B.E." / "b e" / "bee ee" → "BE"
- "C.R." / "c r" / "see are" → "CR"
- "D.K." / "d k" / "dee kay" → "DK"
- "S.A." / "s a" / "ess ay" → "SA"
- "seller e" / "celery" → "Celery"
- "gpn" / "gpin" / "jbrain" / "gbr ain" / "gb r a i n" → "gbrain"  (Boss's knowledge-base tool (garrytan/gbrain); Soniox mishears as gpn or jbrain)
- "Gariton" / "Garon" / "Garreton" → "Garry Tan"  (author of gbrain (garrytan/gbrain); VN accent makes 'Garry Tan' → 'Gariton' or 'Garon')
- "esprint" → "sbrain"  (Boss's company brain (~/data/sbrain); STT mishears 'sbrain' as 'esprint' (schwa-prefix + brain→print). Boss-confirmed 2026-05-30: ALWAYS sbrain, even in Kanban/sprint context — never Scrum 'sprint'.)
- "do nét" / "do net" / "Genet" → "Sonnet"  (Claude Sonnet model (e.g. 'Sonnet 4.6'); STT mishears as 'do nét'/'Genet'/'Zellij 4.6'. Boss rates it best-of-world vs MiMo/Gemini/DeepSeek (2026-05-31).)
`;

const COMMON_RULES = `## CRITICAL RULES
1. **Preserve all IDEAS and POINTS** - don't drop any information the user intended to convey
2. **Merge repetitions** - if user repeats the same idea multiple times, say it once clearly
3. **Remove fillers** - drop "uh", "um", "à", "ờ", "ừ", false starts, and self-corrections
4. **Clean up rambling** - if user circles back to restate something, keep the clearest version
5. **PRESERVE ALL SWEAR WORDS** - keep profanity/swearing intact. Swearing = frustration signal for retrospective analysis`;

const PROMPTS = {
  english: `You are a voice transcription corrector. Fix misheard words and translate to natural English.

## User Speech Pattern
User speaks mixed Vietnamese/English. Main language is Vietnamese, but technical terms are in English.

${COMMON_RULES}
6. **Translate MEANING, not word-by-word** - output natural, fluent English
7. Translate Vietnamese profanity to equivalent English swear words

${STT_FIXES}

## Output
ALWAYS output in English. Translate everything to English.
Return ONLY the corrected text. No explanations, no quotes, no formatting.`,

  vietnamese: `You are a voice transcription corrector. Fix misheard words and output in Vietnamese.

## User Speech Pattern
User speaks mixed Vietnamese/English. Keep technical terms in English but output prose in Vietnamese.

${COMMON_RULES}
6. **Output in Vietnamese** - translate English prose to Vietnamese, but keep technical terms (API, GitHub, pytest, tmux, etc.) in English
7. Keep Vietnamese profanity as-is

${STT_FIXES}

## Output
Output in Vietnamese. Keep technical terms in English.
Return ONLY the corrected text. No explanations, no quotes, no formatting.`,

  auto: `You are a voice transcription corrector. Fix misheard words and preserve the original language.

## User Speech Pattern
User speaks mixed Vietnamese/English. Sometimes mostly Vietnamese, sometimes mostly English, sometimes a mix.

${COMMON_RULES}
6. **Preserve the original language mix** - if the user spoke Vietnamese, output Vietnamese. If English, output English. If mixed, output mixed. Match what the user actually said.
7. Keep profanity in whatever language it was spoken

${STT_FIXES}

## Output
Match the language of the input. Do NOT translate — preserve the original language.
Return ONLY the corrected text. No explanations, no quotes, no formatting.`,
};

/**
 * Correct a voice transcript using Gemini 2.5 Flash Lite (non-reasoning).
 *
 * @param {string} transcript - Raw STT transcript
 * @param {string} apiKey - Gemini API key
 * @param {object} llmConfig - LLM config from config.json
 * @param {string} [outputLang="auto"] - Output language: "auto", "english", "vietnamese"
 * @returns {Promise<string>} Corrected text
 */
async function correctTranscript(transcript, apiKey, llmConfig = {}, outputLang = "auto") {
  const systemPrompt = PROMPTS[outputLang] || PROMPTS.auto;
  const userContent = `## Voice Transcript (may have pronunciation errors):\n"${transcript}"`;

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model || "gemini-2.5-flash-lite",
      temperature: llmConfig.temperature ?? 0.1,
      reasoning_effort: "none",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

module.exports = { correctTranscript };
