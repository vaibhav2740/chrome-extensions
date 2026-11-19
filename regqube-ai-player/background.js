// Krillion Bot - Background Service Worker
// Default keys come from keys.local.js (gitignored, never committed; see keys.example.js).
// Without that file the keys simply come from the popup settings.
let LOCAL_KEYS = {};
try {
  importScripts("keys.local.js");
  LOCAL_KEYS = self.KRILLION_KEYS || {};
} catch (e) { /* no local keys file */ }
const DEFAULT_API_KEY = LOCAL_KEYS.gemini || "";
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite-preview", "gemini-flash-latest", "gemini-3-flash-preview"];
const DEFAULT_GROQ_KEY = LOCAL_KEYS.groq || "";
// Verified against the live API: ~0.4s, returns a clean JSON array, no hidden reasoning tokens.
// (openai/gpt-oss-* spend the whole token budget on reasoning and return empty content - do not swap them in.)
const GROQ_MODEL = "qwen/qwen3.8-27b";
const GEMINI_ATTEMPT_TIMEOUT_MS = 6000;
const GROQ_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = GEMINI_ATTEMPT_TIMEOUT_MS;
const BATCH_BUDGET_MS = 12000;     // everything (all providers) for a batch refill; content script waits 14s
const SINGLE_BUDGET_MS = 7000;     // single-answer fallback runs mid-turn, so it must fail fast
const SHARED_GEMINI_BUDGET_MS = 6500; // when another provider is available, Gemini may not eat more than this
const MIN_BATCH_SIZE = 3;
const OLD_DEFAULT_MODEL = "gemini-3-flash-preview";

chrome.runtime.onInstalled.addListener(async () => {
  await migrateSettings();
  // Belt-and-suspenders keep-alive: wakes the worker every 24s even if all game tabs close.
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
});

// Ensure keep-alive alarm exists across browser restarts/unpacked reloads
chrome.alarms.get("keepalive", (alarm) => {
  if (!alarm) {
    chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  }
});

// The alarm handler is intentionally a no-op; its only purpose is to wake the service worker.
chrome.alarms.onAlarm.addListener(() => {});

function isDeprecatedModel(model) {
  return !model || /(^|[-.])(1\.5|2\.0|2\.5)([-.]|$)/.test(model);
}

async function migrateSettings() {
  const current = await chrome.storage.local.get(["apiKey", "groqApiKey", "model", "modelMigrated", "autoWrite", "autoPlay", "thinkingDelay", "showHud", "provider", "humanTyping", "typingWpm"]);
  const updates = {};

  // Seed keys only when never set. An empty string is a deliberate "disabled", not "missing".
  if (current.apiKey === undefined) updates.apiKey = DEFAULT_API_KEY;
  if (current.groqApiKey === undefined) updates.groqApiKey = DEFAULT_GROQ_KEY;
  if (isDeprecatedModel(current.model)) {
    updates.model = DEFAULT_MODEL;
  } else if (current.model === OLD_DEFAULT_MODEL && !current.modelMigrated) {
    // One-time move off the old preview default (tight free quota). Afterwards the user's own choice is respected.
    updates.model = DEFAULT_MODEL;
  }
  if (!current.modelMigrated) updates.modelMigrated = true;
  if (!current.provider) updates.provider = "auto";
  if (current.autoWrite === undefined) updates.autoWrite = false;
  if (current.autoPlay === undefined) updates.autoPlay = false;
  if (current.thinkingDelay === undefined) updates.thinkingDelay = 300;
  if (current.showHud === undefined) updates.showHud = true;
  if (current.humanTyping === undefined) updates.humanTyping = false;
  if (current.typingWpm === undefined) updates.typingWpm = 100;

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

async function getSettings() {
  const s = await chrome.storage.local.get(["apiKey", "groqApiKey", "model", "provider"]);
  const model = isDeprecatedModel(s.model) ? DEFAULT_MODEL : s.model;
  return {
    apiKey: (s.apiKey && s.apiKey.trim()) || DEFAULT_API_KEY,
    groqApiKey: (s.groqApiKey && s.groqApiKey.trim()) || DEFAULT_GROQ_KEY,
    model,
    provider: ["auto", "gemini", "groq"].includes(s.provider) ? s.provider : "auto",
  };
}

function modelsToTry(model) {
  return [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
}

// Keep the question as plain data inside the prompt: one line, no quotes, bounded length.
function sanitizeQuestion(question) {
  return String(question || "").replace(/["“”\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

// Normalise one raw model answer into something typeable, or "" if it is junk.
function cleanAnswer(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.endsWith(":")) return "";
  if (/^(?:here\s+(?:are|is)|sure[,!.]?|certainly[,!.]?|below\s+(?:are|is)|the\s+following\b)/i.test(trimmed)) return "";
  // Strip list markers ("1.", "2)", "-", "*") but keep leading digits that belong to the answer ("7 Up").
  let a = raw
    .replace(/^\s*(?:\d{1,2}[.)]|[-*•])\s+/, "")
    .replace(/^(answer\s*:\s*)/i, "")
    .replace(/^["'`*_\s]+/, "")
    .replace(/[\s"'`,;:.!?*_\]\[]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (a.length < 2 || a.length > 50) return "";
  if (/[<>{}|\\=]/.test(a)) return "";
  if (a.split(" ").length > 6) return "";
  return a;
}

function stemPlural(word) {
  if (!word || word.length <= 3) return word;
  const parts = word.split(" ");
  const last = parts[parts.length - 1];
  if (last.length <= 3) return word;
  let stemmed = last;
  if (/sses$/i.test(last)) {
    stemmed = last.slice(0, -2);
  } else if (/series|species/i.test(last)) {
    return word;
  } else if (/ies$/i.test(last) && last.length > 4) {
    stemmed = last.slice(0, -3) + "y";
  } else if (/(?:ch|sh|x|z)es$/i.test(last)) {
    stemmed = last.slice(0, -2);
  } else if (/s$/i.test(last) && !/(?:ss|us|is|as|os)$/i.test(last)) {
    stemmed = last.slice(0, -1);
  }
  if (stemmed !== last) {
    parts[parts.length - 1] = stemmed;
    return parts.join(" ");
  }
  return word;
}

function normalizeKey(str) {
  const base = String(str || "")
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
  return stemPlural(base);
}

function cleanAnswerList(list, forbidden = []) {
  const seen = new Set(forbidden.map(normalizeKey));
  const out = [];
  for (const item of list) {
    const a = cleanAnswer(item);
    const key = normalizeKey(a);
    if (!a || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function parseAnswerList(raw) {
  const stripped = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // some reasoning models inline their thoughts
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.answers)) return parsed.answers;
  } catch (e) {
    // fall through to line parsing
  }
  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // fall through
    }
  }
  return stripped.split("\n");
}

// ---------------------------------------------------------------------------
// Rate-limit governor + provider routing. Free-tier quotas are small, so every request must earn its place.
// ---------------------------------------------------------------------------
const DAILY_RECHECK_MS = 30 * 60 * 1000;
const DEFAULT_RATE_BLOCK_MS = 30 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MIN_USABLE = 8;
const CACHE_MAX_ENTRIES = 60;
const PRIOR_LATENCY_MS = { groq: 500, gemini: 1500 };
const FAILURE_PENALTY_MS = 5000;

const blocked = new Map();        // "gemini model" | "groq" -> { until, daily }
const noThinking = new Set();     // Gemini models that rejected thinkingConfig
const batchCache = new Map();     // normalised question -> { answers, at }
const inflightBatch = new Map();  // normalised question -> Promise (concurrent identical requests share one call)
const health = { gemini: { ema: 0, failedAt: 0 }, groq: { ema: 0, failedAt: 0 } };
let groqLimits = null;            // last seen x-ratelimit-* headers from Groq (live quota readout)

class ApiError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0, daily = false } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.daily = daily;
  }
}

const dayKey = () => new Date().toISOString().slice(0, 10);
const freshStats = () => ({ day: dayKey(), calls: 0, ok: 0, rateLimited: 0, errors: 0, cacheHits: 0, shared: 0, groqCalls: 0, groqLimited: 0 });
let stats = freshStats();
let statsTimer = 0;
const statsReady = (async () => {
  try {
    const { apiStats } = await chrome.storage.local.get("apiStats");
    if (apiStats && apiStats.day === dayKey()) stats = { ...stats, ...apiStats };
  } catch (e) { /* stats are best effort */ }
})();

function bump(field) {
  if (stats.day !== dayKey()) stats = freshStats();
  stats[field] = (stats[field] || 0) + 1;
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    chrome.storage.local.set({ apiStats: stats }).catch(() => {});
  }, 1500);
}

function parseDurationMs(text) {
  // "1m26.4s", "34s", "250ms", "2h3m"
  if (!text) return 0;
  let ms = 0;
  const re = /([\d.]+)\s*(ms|h|m|s)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const n = parseFloat(m[1]);
    ms += m[2] === "ms" ? n : m[2] === "h" ? n * 3600000 : m[2] === "m" ? n * 60000 : n * 1000;
  }
  return Math.ceil(ms);
}

function parseRateLimit(response, bodyText) {
  let ms = 0;
  let daily = false;
  const hdr = (name) => (response.headers && response.headers.get ? response.headers.get(name) : null);
  const retryAfter = Number(hdr("retry-after"));
  if (retryAfter > 0) ms = retryAfter * 1000;
  try {
    const json = JSON.parse(bodyText);
    for (const d of json.error?.details || []) {
      const m = d.retryDelay && /([\d.]+)\s*s/.exec(d.retryDelay);
      if (m) ms = Math.max(ms, Math.ceil(parseFloat(m[1]) * 1000));
      for (const v of d.violations || []) {
        if (/PerDay/i.test(v.quotaId || "")) daily = true;
      }
    }
  } catch (e) { /* not JSON */ }
  if (!daily && /PerDay|per day|requests per day|RPD/i.test(bodyText)) daily = true;
  if (!ms) ms = daily ? DAILY_RECHECK_MS : DEFAULT_RATE_BLOCK_MS;
  if (daily) ms = Math.max(ms, DAILY_RECHECK_MS);
  return { ms, daily };
}

function noteResult(provider, ok, ms) {
  const h = health[provider];
  if (ok) {
    h.ema = h.ema ? 0.7 * h.ema + 0.3 * ms : ms;
    h.failedAt = 0;
  } else {
    h.failedAt = Date.now();
  }
}

function geminiModelsNow(model) {
  const t = Date.now();
  return modelsToTry(model).filter((m) => (blocked.get(m)?.until || 0) <= t);
}

// null when the provider can be called right now, otherwise { until, daily } describing the cooldown.
function providerBlock(provider, settings) {
  const t = Date.now();
  if (provider === "groq") {
    const b = blocked.get("groq");
    return b && b.until > t ? b : null;
  }
  const waits = modelsToTry(settings.model).map((m) => blocked.get(m)).filter((b) => b && b.until > t);
  return waits.length === modelsToTry(settings.model).length
    ? { until: Math.min(...waits.map((b) => b.until)), daily: waits.every((b) => b.daily) }
    : null;
}

function configuredProviders(settings) {
  const list = [];
  if (settings.groqApiKey) list.push("groq");
  if (settings.apiKey) list.push("gemini");
  return list;
}

function providerScore(p) {
  const h = health[p];
  let score = h.ema || PRIOR_LATENCY_MS[p];
  if (h.failedAt && Date.now() - h.failedAt < 60000) score += FAILURE_PENALTY_MS;
  return score;
}

// Callable providers, best first. "auto" = fastest recently-healthy one; otherwise the user's pick first.
// Throws a rate-limit ApiError (with the wait) when every configured provider is cooling down.
function providerOrder(settings) {
  const configured = configuredProviders(settings);
  if (!configured.length) throw new Error("No API key configured - add a Groq or Gemini key in the popup");
  const ready = configured.filter((p) => !providerBlock(p, settings));
  if (!ready.length) {
    const t = Date.now();
    const blocks = configured.map((p) => providerBlock(p, settings));
    const until = Math.min(...blocks.map((b) => b.until));
    const daily = blocks.every((b) => b.daily);
    const names = configured.map((p) => (p === "groq" ? "Groq" : "Gemini")).join(" + ");
    throw new ApiError(
      daily ? `${names} daily free quota used up - try again later or add another key` : `${names} rate limit hit - retry in ${Math.max(1, Math.ceil((until - t) / 1000))}s`,
      { status: 429, retryAfterMs: Math.max(1000, until - t), daily }
    );
  }
  ready.sort((a, b) => providerScore(a) - providerScore(b));
  if (settings.provider === "gemini" || settings.provider === "groq") {
    ready.sort((a, b) => (a === settings.provider ? -1 : 0) - (b === settings.provider ? -1 : 0));
  }
  return ready;
}

// After a failed sweep: if everything is cooling down report that (with the wait), else the last real error.
function finalError(lastError, settings) {
  try {
    providerOrder(settings);
  } catch (e) {
    return e;
  }
  return lastError || new Error("AI request failed");
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
function thinkingConfigFor(model, variant) {
  if (variant === "none") return undefined;
  if (/gemini-3|flash-lite|latest/.test(model)) return { thinkingLevel: "minimal" };
  return { thinkingBudget: 0 };
}

// Low temperature for deterministic, standard answers. Retries once without thinkingConfig if rejected (remembered).
async function callGemini(model, apiKey, prompt, { maxTokens = 400, json = false, timeoutMs = GEMINI_ATTEMPT_TIMEOUT_MS } = {}) {
  await statsReady;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const variants = noThinking.has(model) ? ["none"] : ["thinking", "none"];

  for (const variant of variants) {
    const generationConfig = { temperature: 0.1, maxOutputTokens: maxTokens };
    const thinking = thinkingConfigFor(model, variant);
    if (thinking) generationConfig.thinkingConfig = thinking;
    if (json) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = { type: "ARRAY", items: { type: "STRING" } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    bump("calls");
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: controller.signal,
      });
    } catch (err) {
      bump("errors");
      throw new Error(err.name === "AbortError" ? `Gemini timeout after ${timeoutMs}ms` : err.message);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 429) {
        const { ms, daily } = parseRateLimit(response, body);
        blocked.set(model, { until: Date.now() + ms, daily });
        bump("rateLimited");
        throw new ApiError(`Gemini 429 on ${model}: ${daily ? "daily quota" : "rate limit"} (retry in ${Math.ceil(ms / 1000)}s)`, { status: 429, retryAfterMs: ms, daily });
      }
      if (response.status === 400 && variant === "thinking") {
        noThinking.add(model);
        continue;
      }
      bump("errors");
      throw new ApiError(`Gemini ${response.status}: ${body.slice(0, 300)}`, { status: response.status });
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
    if (!text) {
      bump("errors");
      throw new Error("empty response from Gemini");
    }
    bump("ok");
    return text;
  }
  throw new Error("Gemini request failed");
}

// Walk the Gemini models (skipping cooling ones) within `budgetMs`; first usable result wins.
async function geminiSweep(settings, budgetMs, maxModels, attempt) {
  const deadline = Date.now() + budgetMs;
  let lastError = null;
  let tried = 0;
  for (const target of geminiModelsNow(settings.model)) {
    const left = deadline - Date.now();
    if (left < 1200 || tried >= maxModels) break;
    if ((blocked.get(target)?.until || 0) > Date.now()) continue; // blocked earlier in this sweep
    tried++;
    try {
      const result = await attempt(target, Math.min(GEMINI_ATTEMPT_TIMEOUT_MS, left));
      if (result) return result;
      lastError = new Error(`unusable answer from ${target}`);
    } catch (err) {
      lastError = err;
      console.warn(`[RegQube AI] Gemini ${target} failed:`, err.message);
    }
  }
  throw lastError || new Error("no Gemini model available");
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible)
// ---------------------------------------------------------------------------
function readGroqLimits(response) {
  const h = (n) => (response.headers && response.headers.get ? response.headers.get(n) : null);
  const limit = Number(h("x-ratelimit-limit-requests"));
  const remaining = Number(h("x-ratelimit-remaining-requests"));
  if (!Number.isFinite(limit) || !limit) return;
  groqLimits = {
    limit,
    remaining: Number.isFinite(remaining) ? remaining : null,
    tokenLimit: Number(h("x-ratelimit-limit-tokens")) || null,
    tokensRemaining: Number(h("x-ratelimit-remaining-tokens")) || null,
    resetMs: parseDurationMs(h("x-ratelimit-reset-requests")),
    at: Date.now(),
  };
}

async function callGroq(apiKey, messages, { maxTokens = 600, timeoutMs = GROQ_TIMEOUT_MS } = {}) {
  await statsReady;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  bump("calls");
  bump("groqCalls");
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.1, max_tokens: maxTokens }),
      signal: controller.signal,
    });
  } catch (err) {
    bump("errors");
    throw new Error(err.name === "AbortError" ? `Groq timeout after ${timeoutMs}ms` : err.message);
  } finally {
    clearTimeout(timer);
  }

  readGroqLimits(response);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 429) {
      const { ms, daily } = parseRateLimit(response, body);
      const exhausted = groqLimits && groqLimits.remaining === 0;
      const until = Math.max(ms, exhausted && groqLimits.resetMs ? groqLimits.resetMs : 0);
      blocked.set("groq", { until: Date.now() + until, daily: daily || !!exhausted });
      bump("rateLimited");
      bump("groqLimited");
      throw new ApiError(`Groq 429: ${daily || exhausted ? "daily quota" : "rate limit"} (retry in ${Math.ceil(until / 1000)}s)`, { status: 429, retryAfterMs: until, daily: daily || !!exhausted });
    }
    if (response.status === 401 || response.status === 403) {
      blocked.set("groq", { until: Date.now() + 10 * 60 * 1000, daily: false });
      bump("errors");
      throw new ApiError(`Groq key rejected (${response.status}) - check it in the popup`, { status: response.status });
    }
    if (response.status === 404 || (response.status === 400 && /model/i.test(body))) {
      blocked.set("groq", { until: Date.now() + 10 * 60 * 1000, daily: false });
      bump("errors");
      throw new ApiError(`Groq model ${GROQ_MODEL} unavailable (${response.status})`, { status: response.status });
    }
    bump("errors");
    throw new ApiError(`Groq ${response.status}: ${body.slice(0, 200)}`, { status: response.status });
  }

  const data = await response.json();
  const content = (data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!content) {
    bump("errors");
    throw new Error("empty response from Groq");
  }
  bump("ok");
  return content;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
function cacheGet(qkey) {
  const e = batchCache.get(qkey);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    batchCache.delete(qkey);
    return null;
  }
  return e;
}

function cachePut(qkey, answers) {
  const prev = cacheGet(qkey);
  batchCache.delete(qkey);
  batchCache.set(qkey, { answers: cleanAnswerList([...(prev ? prev.answers : []), ...answers]), at: Date.now() });
  while (batchCache.size > CACHE_MAX_ENTRIES) batchCache.delete(batchCache.keys().next().value);
}

async function requestBatch(q, avoid) {
  const settings = await getSettings();
  const order = providerOrder(settings);
  const avoidText = avoid.length ? `\nDo NOT include any of these (already used or rejected):\n${avoid.map((a) => `- ${a}`).join("\n")}\n` : "";

  const geminiPrompt = `You are playing a fast elimination trivia game. Category prompt: ${q}
List 24 different answers that fit this category.${avoidText}
Rules:
- Every answer must be a real, correctly spelled, widely recognised member of the category. Never invent or guess.
- Answers must be entries a standard English trivia database would include — no jargon, technical names, or regional slang.
- Prefer well-known answers that a standard answer list would accept; no obscure or borderline items.
- Order from most widely recognised to less recognised.
- Each answer is 1 to 3 words, with no explanations.
- Return only a JSON array of strings.`;
  const groqMessages = [
    { role: "system", content: "You are playing a fast trivia elimination game. Reply ONLY with a valid JSON array of strings: [\"Answer 1\", \"Answer 2\", ...]" },
    { role: "user", content: `Category: ${q}\nProvide 24 different, widely recognised, correctly spelled answers that a standard English trivia database would include. Most well-known first.${avoidText}\nSTRICT: Return ONLY the JSON array of strings, 1 to 3 words per answer.` },
  ];

  const deadline = Date.now() + BATCH_BUDGET_MS;
  let lastError = null;
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    const left = deadline - Date.now();
    if (left < 1200) break;
    const started = Date.now();
    try {
      let answers;
      if (provider === "groq") {
        const raw = await callGroq(settings.groqApiKey, groqMessages, { maxTokens: 700, timeoutMs: Math.min(GROQ_TIMEOUT_MS, left) });
        answers = cleanAnswerList(parseAnswerList(raw), avoid);
      } else {
        const hasNext = i < order.length - 1;
        answers = await geminiSweep(settings, hasNext ? Math.min(left, SHARED_GEMINI_BUDGET_MS) : left, hasNext ? 2 : 4, async (target, timeoutMs) => {
          const raw = await callGemini(target, settings.apiKey, geminiPrompt, { maxTokens: 700, json: true, timeoutMs });
          const list = cleanAnswerList(parseAnswerList(raw), avoid);
          return list.length >= MIN_BATCH_SIZE ? list : null;
        });
      }
      if (answers && answers.length >= MIN_BATCH_SIZE) {
        noteResult(provider, true, Date.now() - started);
        return answers;
      }
      lastError = new Error(`only ${answers ? answers.length : 0} usable answers from ${provider}`);
      noteResult(provider, false);
    } catch (err) {
      lastError = err;
      noteResult(provider, false);
      console.warn(`[RegQube AI] ${provider} batch failed:`, err.message);
    }
  }
  throw finalError(lastError, settings);
}

// Batch pre-fetch: many verified answers in one call so the turn itself costs 0ms of network.
// Repeat categories and concurrent identical requests are served without touching any API.
async function prefetchAnswersBatch(question, forbidden = []) {
  const q = sanitizeQuestion(question);
  if (!q) throw new Error("empty question");
  const qkey = normalizeKey(q);
  const avoid = forbidden.slice(0, 60);

  const fromCache = () => {
    const c = cacheGet(qkey);
    return c ? cleanAnswerList(c.answers, avoid) : [];
  };

  const cached = fromCache();
  if (cached.length >= CACHE_MIN_USABLE) {
    bump("cacheHits");
    return cached;
  }

  const running = inflightBatch.get(qkey);
  if (running) {
    bump("shared");
    try { await running; } catch (e) { /* fall through to our own attempt / the shared result */ }
    const shared = fromCache();
    if (shared.length >= MIN_BATCH_SIZE) return shared;
  }

  const job = requestBatch(q, avoid).then((answers) => {
    cachePut(qkey, answers);
    return answers;
  });
  inflightBatch.set(qkey, job);
  try {
    return await job;
  } finally {
    if (inflightBatch.get(qkey) === job) inflightBatch.delete(qkey);
  }
}

// Single answer fallback query (used mid-turn when no pool answer is ready).
async function queryGemini(question, usedAnswers = []) {
  const settings = await getSettings();
  const order = providerOrder(settings);
  const q = sanitizeQuestion(question);
  if (!q) throw new Error("empty question");

  const avoid = usedAnswers.slice(0, 60);
  const geminiPrompt = `Elimination trivia game. Category prompt: ${q}
Already used or rejected (do not repeat): ${avoid.length ? avoid.join(", ") : "(none)"}
Give ONE correctly spelled, widely recognised answer that fits the category, 1 to 3 words.
Reply with only the answer text.`;
  const groqMessages = [
    { role: "system", content: "You are playing an elimination trivia game. Reply with ONLY the raw answer text (1 to 3 words), nothing else." },
    { role: "user", content: `Category: ${q}\nAlready used: ${avoid.slice(0, 30).join(", ") || "(none)"}\nGive ONE different, real, widely recognised answer.` },
  ];

  const deadline = Date.now() + SINGLE_BUDGET_MS;
  let lastError = null;
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    const left = deadline - Date.now();
    if (left < 1200) break;
    const started = Date.now();
    try {
      let answer;
      if (provider === "groq") {
        const raw = await callGroq(settings.groqApiKey, groqMessages, { maxTokens: 30, timeoutMs: Math.min(GROQ_TIMEOUT_MS, left) });
        [answer] = cleanAnswerList([raw.split("\n")[0]], avoid);
      } else {
        const hasNext = i < order.length - 1;
        answer = await geminiSweep(settings, hasNext ? Math.min(left, 4500) : left, hasNext ? 1 : 3, async (target, timeoutMs) => {
          const raw = await callGemini(target, settings.apiKey, geminiPrompt, { maxTokens: 40, timeoutMs });
          const [a] = cleanAnswerList([raw.split("\n")[0]], avoid);
          return a || null;
        });
      }
      if (answer) {
        noteResult(provider, true, Date.now() - started);
        return answer;
      }
      lastError = new Error(`unusable answer from ${provider}`);
      noteResult(provider, false);
    } catch (err) {
      lastError = err;
      noteResult(provider, false);
      console.warn(`[RegQube AI] ${provider} single query failed:`, err.message);
    }
  }
  throw finalError(lastError, settings);
}

function errorPayload(err) {
  return { success: false, error: err.message, retryAfterMs: err.retryAfterMs || 0, rateLimited: err.status === 429, daily: !!err.daily };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "PREFETCH_BATCH") {
    prefetchAnswersBatch(request.question, request.forbidden)
      .then((answers) => sendResponse({ success: true, answers }))
      .catch((err) => {
        console.error("[RegQube AI] Batch prefetch error:", err.message);
        sendResponse({ ...errorPayload(err), answers: [] });
      });
    return true;
  }

  if (request?.type === "GENERATE_ANSWER") {
    queryGemini(request.question, request.usedAnswers)
      .then((answer) => sendResponse({ success: true, answer }))
      .catch((err) => {
        console.error("[RegQube AI] Error querying Gemini:", err.message);
        sendResponse(errorPayload(err));
      });
    return true;
  }

  if (request?.type === "GET_API_STATS") {
    Promise.all([statsReady, getSettings()]).then(([, settings]) => {
      const t = Date.now();
      sendResponse({
        stats,
        // Only booleans/limits leave this worker - never the keys themselves.
        providers: {
          gemini: { configured: !!settings.apiKey, model: settings.model, block: (() => { const b = providerBlock("gemini", settings); return b ? { secondsLeft: Math.ceil((b.until - t) / 1000), daily: b.daily } : null; })(), latencyMs: Math.round(health.gemini.ema) || null },
          groq: { configured: !!settings.groqApiKey, model: GROQ_MODEL, block: (() => { const b = providerBlock("groq", settings); return b ? { secondsLeft: Math.ceil((b.until - t) / 1000), daily: b.daily } : null; })(), latencyMs: Math.round(health.groq.ema) || null, limits: groqLimits },
          preferred: settings.provider,
        },
        blocked: [...blocked.entries()].filter(([, b]) => b.until > t).map(([model, b]) => ({ model, secondsLeft: Math.ceil((b.until - t) / 1000), daily: b.daily })),
      });
    }).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (request?.type === "SLEEP") {
    setTimeout(() => sendResponse({ ok: true }), Math.min(Math.max(Number(request.ms) || 0, 0), 5000));
    return true;
  }

  if (request?.type === "CLEAR_ALL_MEMORY") {
    (async () => {
      batchCache.clear();
      inflightBatch.clear();
      const all = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(all).filter((k) => k.startsWith("memory_"));
      if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
      sendResponse({ success: true, count: keysToRemove.length });
    })().catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  return false;
});

// While a game tab is hidden/occluded Chrome throttles its timers; this worker's timers are not throttled.
// The content script asks us to do its short waits and subscribes to a tick while hidden.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tick") return;
  let hidden = false;
  const timer = setInterval(() => {
    if (!hidden) return;
    try { port.postMessage({ t: Date.now() }); } catch (e) { clearInterval(timer); }
  }, 250);
  port.onMessage.addListener((m) => { hidden = !!(m && m.hidden); });
  port.onDisconnect.addListener(() => clearInterval(timer));
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger_play_turn") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // Content script only exists on game hosts; ignore tabs where it is absent.
  chrome.tabs.sendMessage(tab.id, { type: "MANUAL_PLAY_TRIGGER" }).catch(() => {});
});

// A freshly pasted key deserves a fresh start, so it clears that provider's cooldown. Only key changes count:
// the extension's own bookkeeping writes (usage stats, memory, learned submit method) happen constantly and must
// never reset a rate-limit cooldown, or every 429 would be forgotten a second later and the API hammered again.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.groqApiKey) blocked.delete("groq");
  if (changes.apiKey) {
    for (const model of [...blocked.keys()]) {
      if (model !== "groq") blocked.delete(model);
    }
  }
});
