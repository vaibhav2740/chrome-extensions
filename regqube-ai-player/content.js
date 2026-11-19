// RegQube AI Player - Content Script (v1.1)
// Round state machine for Krillion "Puffer Party": detect the category, pre-fetch answers,
// and (optionally) type + submit them the moment you hold the puffer, retrying on rejection.
(function () {
  "use strict";

  if (window.__REGQUBE_AI_LOADED__) return;
  window.__REGQUBE_AI_LOADED__ = true;

  const VERSION = "1.4.0";
  const HUD_ID = "regqube-ai-hud";

  // ---------------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------------
  const TICK_MIN_GAP_MS = 40;        // coalesce bursts of DOM mutations into one tick
  const HEARTBEAT_MS = 120;          // safety-net tick when no mutation fires
  const QUESTION_STABLE_MS = 160;    // a new category must persist this long before we commit to it
  const QUESTION_GONE_MS = 1500;     // category must be missing this long before we call the round over
  const POOL_LOW_WATER = 5;          // top the pool up below this many answers
  const POOL_WAIT_MS = 5000;         // max wait for an in-flight fetch when the turn has already started
  const FETCH_TIMEOUT_MS = 14000;
  const SUBMIT_FALLBACK_MS = [450, 400]; // how long each submit method gets before trying the next (first turn only)
  const IGNORE_AFTER_MS = 1600;      // still my turn, word still in the box, no shake, no reaction => "ignored"
  const ACCEPT_WAIT_MS = 1400;       // box cleared, still my turn, no shake => unknown (don't blame word)
  const TURN_LOST_CONFIRM_MS = 350;  // box cleared and no longer mine: confirm before calling it accepted
  const TURN_PENDING_MAX_MS = 1500;  // box disabled but our word still in it: how long to wait for a late verdict
  const MAX_ATTEMPTS_PER_TURN = 15;
  const WEAK_STABLE_MS = 1500;       // heuristic ("near the label") category guesses must be very stable
  const COUNTER_ONLY_WAIT_MS = 1500; // counter moved but text is the same: give the new text a chance to appear (swap = 1300ms)
  const FLIP_WINDOW_MS = 12000;      // more than FLIP_MAX category commits inside this window is not a real game
  const FLIP_MAX = 3;
  const FLIP_HOLD_MS = 20000;
  const IGNORED_RETRY_GAP_MS = 700;  // game gave no reaction at all: it was probably not listening yet
  const MEMORY_VERSION = 2;
  const MAX_FETCHES_PER_MIN = 6;     // hard ceiling on API refills, whatever else goes wrong
  const MAX_EMPTY_YIELDS = 3;        // stop auto-refilling after this many "nothing new" responses
  const MEMORY_GOOD_LIMIT = 120;
  const MEMORY_BAD_LIMIT = 200;
  const MEMORY_CANDIDATES_LIMIT = 60;
  const BAD_FORBID_COUNT = 2;        // a word rejected this many times is never offered again
  const INTERMISSION_PHASES = /^(door|lobby|over|gameover|game-over|results|end|ended)$/i;

  function getPlayerCount() {
    return document.querySelectorAll(".pf-say").length || 4;
  }
  function getPoolLowWater() {
    return getPlayerCount() <= 2 ? 3 : POOL_LOW_WATER;
  }
  function getMaxEmptyYields() {
    return getPlayerCount() <= 2 ? 5 : MAX_EMPTY_YIELDS;
  }

  const COLORS = { info: "#818cf8", ok: "#34d399", warn: "#f59e0b", bad: "#ef4444", idle: "#94a3b8", act: "#38bdf8" };
  const NO_CATEGORY_MSG = "Your turn, but no category found — click ⚙ for diagnostics";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const S = {
    autoWrite: false,
    thinkingDelay: 300,
    humanTyping: false,
    typingWpm: 100,
    showHud: true,
    tornDown: false,

    epoch: 0,                 // bumps whenever the round changes; invalidates all in-flight async work
    current: null,            // { text, counter, key } of the committed category
    question: "",
    pending: null,            // { cand, since } candidate waiting out QUESTION_STABLE_MS
    absentSince: 0,

    pool: [],                 // answers to try, best first
    used: new Set(),          // normalised answers unavailable this round (opponents, ours, rejected, skipped)
    usedSource: new Map(),    // normalised answer -> why it is in `used` (for diagnostics)
    why: "",                  // most recent reason the pool/round changed (shown in the HUD)
    whyAt: 0,
    lastTop: "",
    lastMine: null,
    good: [],                 // answers the game accepted for this category before (persisted)
    bad: {},                  // normalised answer -> rejection count (persisted)
    stale: new WeakMap(),     // chip element -> text left over from the previous round
    memoryReady: null,

    fetch: null,              // in-flight refill { epoch, promise }
    fetchFailures: 0,
    fetchNextAt: 0,
    emptyYields: 0,

    turn: { running: false, handled: false, retryAt: 0 },
    lastShakeAt: -1,
    hadRound: false,
    apiBlockedUntil: 0,       // Gemini said "slow down" until this time (performance.now clock)
    fetchTimes: [],           // recent refill start times (hard cap per minute)
    unknownPh: new Set(),
    shakeSeen: false,         // has the game ever shown us a rejection shake in this page session?
    commitTimes: [],
    holdUntil: 0,
    mineSince: 0,
    preferredMethod: "",     // submit method that worked last time (learned, persisted)

    status: "Starting…",
    statusColor: COLORS.idle,
    lastTickAt: 0,
    tickTimer: 0,
    heartbeat: 0,
    answerCount: 0,
  };

  let hud = null;
  let hudDismissed = false;
  let hudMode = "auto"; // "auto" follows game detection + settings; "on"/"off" are explicit popup toggles
  try {
    hudDismissed = sessionStorage.getItem("regqube_ai_hud_dismissed") === "true";
  } catch (e) { /* storage blocked */ }

  const cleanups = [];
  const logBuf = [];

  function fmt(a) {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  // jr = verbose journal entry (kept for diagnostics, no console output); log = jr + console.
  function jr(...args) {
    logBuf.push(`${(performance.now() / 1000).toFixed(2)}s ${args.map(fmt).join(" ")}`);
    if (logBuf.length > 300) logBuf.shift();
  }
  function log(...args) {
    jr(...args);
    console.log("%c[RegQube AI]", "color:#6366f1;font-weight:bold", ...args);
  }

  // Hidden/occluded tabs get their timers throttled (>=1s). The background worker's timers are not, so while
  // the tab is hidden we let it do the waiting for us.
  const sleepRaw = (ms) => new Promise((r) => setTimeout(r, ms));
  function sleep(ms) {
    if (document.hidden && extensionAlive()) {
      return chrome.runtime.sendMessage({ type: "SLEEP", ms }).then(() => {}, () => sleepRaw(ms));
    }
    return sleepRaw(ms);
  }
  const now = () => performance.now();

  // ---------------------------------------------------------------------------
  // Game-level telemetry (stored in chrome.storage.local for popup readout)
  // ---------------------------------------------------------------------------
  const dayKey = () => new Date().toISOString().slice(0, 10);
  const freshGameStats = () => ({ day: dayKey(), rounds: 0, turns: 0, accepted: 0, rejected: 0, fallbacks: 0 });
  let gameStats = freshGameStats();
  let gameStatsTimer = 0;
  chrome.storage.local.get("gameStats").then(({ gameStats: gs }) => {
    if (gs && gs.day === dayKey()) gameStats = { ...gameStats, ...gs };
  }).catch(() => {});

  function bumpGameStat(field) {
    if (gameStats.day !== dayKey()) gameStats = freshGameStats();
    gameStats[field] = (gameStats[field] || 0) + 1;
    clearTimeout(gameStatsTimer);
    gameStatsTimer = setTimeout(() => {
      chrome.storage.local.set({ gameStats }).catch(() => {});
    }, 1200);
  }

  async function waitFor(cond, timeoutMs, stepMs = 15) {
    const end = now() + timeoutMs;
    while (now() < end) {
      if (cond()) return true;
      await sleep(stepMs);
    }
    return cond();
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

  function norm(str) {
    if (!str) return "";
    const base = String(str)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
    const stripped = base
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const res = stripped || base;
    return stemPlural(res);
  }

  function cleanText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  const isInlineLike = (display) => display === "" || display === "contents" || display.startsWith("inline");

  // Text of an element, with a space between separate blocks ("YOU WIN" + "last one floating" must not fuse into
  // "YOU WINlast one floating") but none between inline pieces, so per-letter animated spans still read correctly.
  function readText(el) {
    const parts = [];
    let lastBlock = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      if (!t || !t.trim()) {
        if (t) parts.push(t); // keep real whitespace between inline pieces
        continue;
      }
      let block = n.parentElement;
      while (block && block !== el && isInlineLike(getComputedStyle(block).display)) block = block.parentElement;
      if (lastBlock && block !== lastBlock) parts.push(" ");
      lastBlock = block;
      parts.push(t);
    }
    return cleanText(parts.join(""));
  }

  function extensionAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  const HOLD_MSG = "Category detection keeps flipping — holding the current one. Click ⚙ and send the diagnostics.";

  function setStatus(text, color = COLORS.idle) {
    // While the flip breaker is holding, keep its warning on screen instead of letting routine updates bury it.
    if (S.holdUntil > now() && text !== HOLD_MSG) return;
    S.status = text;
    S.statusColor = color;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  chrome.storage.local.get(["autoWrite", "autoPlay", "thinkingDelay", "showHud", "submitMethod", "humanTyping", "typingWpm"]).then((res) => {
    if (typeof res.submitMethod === "string") S.preferredMethod = res.submitMethod;
    S.autoWrite = res.autoWrite !== undefined ? !!res.autoWrite : !!res.autoPlay;
    if (res.thinkingDelay !== undefined) S.thinkingDelay = Number(res.thinkingDelay) || 0;
    if (res.showHud !== undefined) S.showHud = !!res.showHud;
    if (res.humanTyping !== undefined) S.humanTyping = !!res.humanTyping;
    if (res.typingWpm !== undefined) S.typingWpm = Number(res.typingWpm) || 100;
    scheduleTick();
  }).catch(() => {});

  const onStorageChanged = (changes, area) => {
    if (area !== "local") return;
    if (changes.autoWrite) S.autoWrite = !!changes.autoWrite.newValue;
    else if (changes.autoPlay) S.autoWrite = !!changes.autoPlay.newValue;
    if (changes.thinkingDelay) S.thinkingDelay = Number(changes.thinkingDelay.newValue) || 0;
    if (changes.humanTyping) S.humanTyping = !!changes.humanTyping.newValue;
    if (changes.typingWpm) S.typingWpm = Number(changes.typingWpm.newValue) || 100;
    if (changes.showHud) {
      S.showHud = !!changes.showHud.newValue;
      hudMode = "auto";
    }
    scheduleTick();
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  cleanups.push(() => chrome.storage.onChanged.removeListener(onStorageChanged));

  // ---------------------------------------------------------------------------
  // Game DOM readers (all selectors live here so they are easy to adjust)
  // ---------------------------------------------------------------------------
  const QUESTION_SELECTORS = [".ds-card .prompt", ".ds-card.long .prompt", ".ds-prompt", ".prompt", "#puffer-question", "[data-question]"];
  const LABEL_SELECTOR = ".ds-prompt-count, .pf-hud-label";

  const NOT_A_QUESTION = [
    /^(game|round|category)\s+\d+/i,
    /^(get\s+ready|menu|chat|winner|starting in|waiting for|spectating|lobby)\b/i,
    /\blobby$/i,
    /game over/i,
    /\bwins the (round|game)\b/i,
    /leave the game/i,
    /scoreboard/i,
    /^your (turn|puffer)/i,
    /\S's turn\b/i,
    /you.?re out/i,
    /\byou\s+(win|won|lose|lost)\b/i,
    /last one floating/i,
    /\b(rematch|play again|new game|back to lobby)\b/i,
  ];

  function isValidQuestion(text, minWords = 2) {
    if (!text) return false;
    const str = text.trim();
    if (str.length < 8 || str.length > 200) return false;
    if (!/[a-zA-Z]{2,}/.test(str)) return false;
    if (/^[▲-◄\s\d.:\-_|/\\+><()·]+$/.test(str)) return false;
    if (NOT_A_QUESTION.some((re) => re.test(str))) return false;
    return str.split(/\s+/).length >= minWords;
  }

  function isRendered(el, checkOpacity) {
    for (let n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute("aria-hidden") === "true") return false;
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (checkOpacity && parseFloat(cs.opacity) < 0.2) return false;
    }
    return true;
  }

  function getRoot() {
    return document.querySelector(".ds-root");
  }

  function getPhase() {
    return getRoot()?.getAttribute("data-phase") || "";
  }

  function isIntermissionPhase() {
    const p = getPhase();
    return !!p && INTERMISSION_PHASES.test(p);
  }

  function isGameDetected() {
    return !!document.querySelector(".ds-root, .ds-stage, input.ds-input");
  }

  function readCounter() {
    const el = document.querySelector(LABEL_SELECTOR);
    const m = el && /category\s*(\d+)/i.exec(el.textContent || "");
    return m ? m[1] : "";
  }

  // Siblings of the "CATEGORY n" label (and of its ancestors) that look like the category text.
  function questionsNearLabels() {
    const out = [];
    for (const label of document.querySelectorAll(LABEL_SELECTOR)) {
      if (label.closest("#" + HUD_ID)) continue;
      let anchor = label;
      for (let depth = 0; depth < 3 && anchor.parentElement; depth++) {
        for (const sib of anchor.parentElement.children) {
          if (sib === anchor || sib.closest("#" + HUD_ID)) continue;
          if (sib.querySelectorAll("*").length > 6) continue;
          const text = readText(sib);
          if (isValidQuestion(text, 3)) out.push({ el: sib, text, strat: 100 + depth });
        }
        anchor = anchor.parentElement;
      }
    }
    return out;
  }

  function collectQuestionCandidates() {
    const found = [];
    QUESTION_SELECTORS.forEach((sel, strat) => {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest("#" + HUD_ID)) continue;
        const text = readText(el);
        if (isValidQuestion(text, 2)) found.push({ el, text, strat, sel });
      }
    });
    if (!found.length) {
      for (const c of questionsNearLabels()) found.push({ ...c, sel: "near-label" });
    }
    return found;
  }

  function readQuestion() {
    if (isIntermissionPhase()) return null;
    // Hidden / faded-out cards (e.g. the old one during a category swap) are not the live category.
    const found = collectQuestionCandidates().filter((c) => isRendered(c.el, true));
    if (!found.length) return null;
    // Lowest strategy index wins; within it the last element in the DOM (the new card during a swap).
    const best = found.reduce((a, b) => (b.strat <= a.strat ? b : a));
    const counter = readCounter();
    return { text: best.text, counter, key: norm(best.text), via: best.sel, weak: best.sel === "near-label" };
  }

  function sameQuestion(a, b) {
    if (!a || !b || a.key !== b.key) return false;
    // Counter only distinguishes a repeated category when both sides actually show one.
    return !a.counter || !b.counter || a.counter === b.counter;
  }

  function getGameInput() {
    for (const inp of document.querySelectorAll("input.ds-input")) {
      if (!inp.closest("#" + HUD_ID)) return inp;
    }
    return document.querySelector("input[aria-label='Your answer']");
  }

  function findSendButton(input) {
    if (!input) return null;
    const scope = input.closest(".ds-dock-inner, .ds-dock") || input.form || input.parentElement;
    if (!scope) return null;
    const buttons = Array.from(scope.querySelectorAll("button"));
    return buttons.find((b) => b.textContent.trim().toUpperCase() === "SEND") || scope.querySelector("button[type='submit']") || null;
  }

  function isEliminated(input) {
    return !!input && /you.?re out|eliminated/i.test(input.placeholder || "");
  }

  // It is my turn only on POSITIVE evidence: an enabled box whose hint says it is my puffer. An enabled box alone
  // is not enough (the box can be typeable while someone else holds the puffer, and typing then goes nowhere).
  const TURN_YES = /your puffer|your turn|type!/i;
  const TURN_NO = /wait|watch|you.?re out|eliminated|spectat|next up|their turn|not your/i;

  function isMyTurn(input) {
    if (!input || !input.isConnected) return false;
    if (input.disabled || input.readOnly) return false;
    if (isIntermissionPhase()) return false;
    const ph = input.placeholder || "";
    if (TURN_NO.test(ph)) return false;
    if (!TURN_YES.test(ph)) {
      if (!S.unknownPh.has(ph)) {
        S.unknownPh.add(ph);
        jr("enabled answer box with UNRECOGNISED hint — not treating as my turn", { placeholder: ph, phase: getPhase() });
      }
      return false;
    }
    return isRendered(input, false);
  }

  // ---------------------------------------------------------------------------
  // Rejection signal: the stage gets `.ds-shake` (animation `ds-shake`). The class can linger after the
  // animation ends, so we only trust *events* (class added / animation started), never mere presence.
  // ---------------------------------------------------------------------------
  function noteShake() {
    S.lastShakeAt = now();
    S.shakeSeen = true;
  }

  const onAnimationStart = (e) => {
    if (e.animationName === "ds-shake") noteShake();
  };
  document.addEventListener("animationstart", onAnimationStart, true);
  cleanups.push(() => document.removeEventListener("animationstart", onAnimationStart, true));

  // ---------------------------------------------------------------------------
  // Opponent answers: seat chips `.pf-say`. `.on.caret` = someone typing (ignore), `.on.rest` = committed.
  // ---------------------------------------------------------------------------
  function snapshotStaleChips() {
    S.stale = new WeakMap();
    for (const el of document.querySelectorAll(".pf-say.on:not(.caret)")) {
      const text = el.textContent.trim();
      if (text) S.stale.set(el, text);
    }
  }

  function scrapeChips() {
    let added = false;
    let seat = -1;
    for (const el of document.querySelectorAll(".pf-say")) {
      seat++;
      if (el.closest("#" + HUD_ID)) continue;
      const text = el.textContent.trim();
      const typing = el.classList.contains("caret");
      const active = el.classList.contains("on") && !typing && text;
      if (!active) {
        S.stale.delete(el); // a new typing session / emptied chip is never "left over"
        continue;
      }
      if (S.stale.get(el) === text) continue;
      S.stale.delete(el);
      const k = norm(text);
      if (!k || text.length > 60) continue;
      if (markUsed(k, `chip #${seat} class="${el.className}"`)) {
        jr("used+", `"${text}" from chip #${seat} class="${el.className}"`);
        added = true;
      }
    }
    if (added) prunePool();
  }

  function chipHas(key) {
    for (const el of document.querySelectorAll(".pf-say.on:not(.caret)")) {
      const text = el.textContent.trim();
      if (S.stale.get(el) === text) continue; // left over from the previous round
      if (norm(text) === key) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Persistent per-category memory: answers the game accepted (seed the pool) and rejected counts.
  // ---------------------------------------------------------------------------
  let memoryWrites = Promise.resolve();

  const memKey = (qkey) => `memory_${qkey}`;

  async function loadMemory(qkey) {
    const k = memKey(qkey);
    const data = await chrome.storage.local.get(k);
    let v = data[k];
    // Older formats (v1.0 flat "used" lists, v1.1 entries that could contain wrongly-blamed words) are discarded.
    if (!v || v.v !== MEMORY_VERSION) v = null;
    const good = Array.isArray(v?.good) ? v.good.filter((x) => typeof x === "string") : [];
    const bad = v && v.bad && typeof v.bad === "object" && !Array.isArray(v.bad) ? v.bad : {};
    const candidates = Array.isArray(v?.candidates) ? v.candidates.filter((x) => typeof x === "string") : [];
    return { good, bad, candidates };
  }

  function updateMemory(qkey, mutate) {
    memoryWrites = memoryWrites
      .then(async () => {
        const mem = await loadMemory(qkey);
        mutate(mem);
        mem.good = mem.good.slice(-MEMORY_GOOD_LIMIT);
        mem.candidates = Array.isArray(mem.candidates) ? mem.candidates.slice(-MEMORY_CANDIDATES_LIMIT) : [];
        const badEntries = Object.entries(mem.bad);
        if (badEntries.length > MEMORY_BAD_LIMIT) {
          badEntries.sort((a, b) => b[1] - a[1]);
          mem.bad = Object.fromEntries(badEntries.slice(0, MEMORY_BAD_LIMIT));
        }
        await chrome.storage.local.set({ [memKey(qkey)]: { v: MEMORY_VERSION, good: mem.good, bad: mem.bad, candidates: mem.candidates } });
      })
      .catch((e) => log("memory write failed:", e.message));
    return memoryWrites;
  }

  function rememberGood(qkey, word) {
    const k = norm(word);
    S.good = S.good.filter((g) => norm(g) !== k).concat(word);
    updateMemory(qkey, (mem) => {
      mem.good = mem.good.filter((g) => norm(g) !== k).concat(word);
      mem.candidates = (mem.candidates || []).filter((c) => norm(c) !== k);
      delete mem.bad[k];
    });
  }

  function rememberBad(qkey, word) {
    const k = norm(word);
    S.bad[k] = (S.bad[k] || 0) + 1;
    updateMemory(qkey, (mem) => {
      mem.good = mem.good.filter((g) => norm(g) !== k);
      mem.candidates = (mem.candidates || []).filter((c) => norm(c) !== k);
      mem.bad[k] = (mem.bad[k] || 0) + 1;
    });
  }

  function rememberCandidates(qkey, newCandidates) {
    if (!newCandidates || !newCandidates.length) return;
    updateMemory(qkey, (mem) => {
      const existing = new Set([...mem.good.map(norm), ...(mem.candidates || []).map(norm)]);
      const list = mem.candidates ? [...mem.candidates] : [];
      for (const item of newCandidates) {
        const k = norm(item);
        if (k && !existing.has(k) && (mem.bad[k] || 0) < BAD_FORBID_COUNT) {
          existing.add(k);
          list.push(item);
        }
      }
      mem.candidates = list.slice(-MEMORY_CANDIDATES_LIMIT);
    });
  }

  // Generate plausible formatting/compound variants to attempt when pool runs dry in sudden death
  function getWordVariants(word) {
    if (!word || typeof word !== "string") return [];
    const trimmed = word.trim();
    const variants = [];
    if (trimmed.includes("-")) {
      variants.push(trimmed.replace(/-/g, " "));
      variants.push(trimmed.replace(/-/g, ""));
    }
    if (trimmed.includes("'") || trimmed.includes("’")) {
      variants.push(trimmed.replace(/['’]/g, ""));
    }
    if (/\bst\.?\s+/i.test(trimmed)) {
      variants.push(trimmed.replace(/\bst\.?\s+/i, "Saint "));
    } else if (/\bsaint\s+/i.test(trimmed)) {
      variants.push(trimmed.replace(/\bsaint\s+/i, "St. "));
    }
    return variants.filter((v) => {
      const vk = norm(v);
      return v && v !== word && vk && !isUnavailable(vk);
    });
  }

  // ---------------------------------------------------------------------------
  // Answer pool
  // ---------------------------------------------------------------------------
  function isUnavailable(key) {
    return !key || S.used.has(key) || (S.bad[key] || 0) >= BAD_FORBID_COUNT;
  }

  // Short, friendly explanation shown in the HUD for a few seconds (the detailed trail stays in the diagnostics journal).
  function setWhy(text) {
    S.why = text;
    S.whyAt = now();
  }

  function humanDrop(info) {
    const w = `"${info.word}"`;
    if (/^chip/.test(info.source)) return `${w} was taken by another player`;
    if (/accepted/.test(info.source)) return `${w} was played`;
    if (/rejected by game/.test(info.source)) return `${w} was rejected by the game`;
    if (/skipped/.test(info.source)) return `${w} skipped`;
    if (/no reaction/.test(info.source)) return `${w} got no reaction`;
    if (/rejected \d+x/.test(info.reason)) return `${w} was rejected before — removed`;
    return `${w} removed`;
  }

  function markUsed(key, source) {
    if (!key || S.used.has(key)) return false;
    S.used.add(key);
    S.usedSource.set(key, source);
    return true;
  }

  function prunePool() {
    const seen = new Set();
    const dropped = [];
    const droppedInfo = [];
    S.pool = S.pool.filter((a) => {
      const k = norm(a);
      let reason = "";
      if (!k) reason = "empty";
      else if (S.used.has(k)) reason = `used: ${S.usedSource.get(k) || "?"}`;
      else if ((S.bad[k] || 0) >= BAD_FORBID_COUNT) reason = `rejected ${S.bad[k]}x in past games`;
      else if (seen.has(k)) reason = "duplicate";
      if (reason) {
        dropped.push(`"${a}" -> ${reason}`);
        droppedInfo.push({ word: a, source: S.usedSource.get(k) || "", reason });
        return false;
      }
      seen.add(k);
      return true;
    });
    if (dropped.length) {
      jr("pool dropped", dropped);
      setWhy(dropped.length === 1 ? humanDrop(droppedInfo[0]) : `${droppedInfo.length} answers dropped (${humanDrop(droppedInfo[0])})`);
    }
  }

  function peek() {
    prunePool();
    return S.pool[0] || "";
  }

  function takeNext() {
    prunePool();
    return S.pool.shift() || "";
  }

  function skipCurrent() {
    const w = S.pool.shift();
    if (w) markUsed(norm(w), "skipped by you");
    prunePool();
  }

  function buildForbidden() {
    const list = new Set([...S.used, ...Object.keys(S.bad), ...S.pool.map(norm)]);
    return Array.from(list).slice(0, 60);
  }

  function sendMessageWithTimeout(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("request timed out")), timeoutMs);
      let p;
      try {
        p = chrome.runtime.sendMessage(message);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      p.then((res) => { clearTimeout(timer); resolve(res); },
        (err) => { clearTimeout(timer); reject(err); });
    });
  }

  function fetchInFlight() {
    return !!S.fetch && S.fetch.epoch === S.epoch;
  }

  function apiBlocked() {
    return S.apiBlockedUntil > now();
  }

  function noteApiLimit(retryAfterMs, message) {
    const waitMs = Math.min(Math.max(Number(retryAfterMs) || 3000, 1000), 5000);
    S.apiBlockedUntil = now() + waitMs;
    S.fetchNextAt = Math.max(S.fetchNextAt, S.apiBlockedUntil);
    setStatus(`${message} — retrying in ${Math.ceil(waitMs / 1000)}s`, COLORS.warn);
    log(`API limit: ${message}; retrying in ${Math.ceil(waitMs / 1000)}s`);
  }

  function requestRefill(force = false) {
    if (!S.current || S.tornDown) return;
    if (isEliminated(getGameInput())) return;
    if (fetchInFlight()) return;
    if (!force && apiBlocked()) return;
    if (!force) {
      if (now() < S.fetchNextAt) return;
      if (S.emptyYields >= getMaxEmptyYields()) return;
    }
    S.fetchTimes = S.fetchTimes.filter((x) => now() - x < 60000);
    if (S.fetchTimes.length >= MAX_FETCHES_PER_MIN) {
      jr("refill skipped: per-minute cap reached", S.fetchTimes.length);
      return;
    }
    S.fetchTimes.push(now());
    const job = { epoch: S.epoch, memoryReady: S.memoryReady };
    S.fetch = job;
    job.promise = runRefill(job, S.question).finally(() => {
      if (S.fetch === job) S.fetch = null;
    });
  }

  async function runRefill(job, question) {
    setStatus("Fetching answers…", COLORS.info);
    try {
      await job.memoryReady;
      if (S.tornDown || job.epoch !== S.epoch) return;
      if (S.pool.length >= 8) {
        log(`pool already has ${S.pool.length} verified/cached answers from memory — skipping initial API prefetch`);
        setStatus(`Ready: ${S.pool.length} answers`, COLORS.ok);
        return;
      }
      const res = await sendMessageWithTimeout({ type: "PREFETCH_BATCH", question, forbidden: buildForbidden() }, FETCH_TIMEOUT_MS);
      if (S.tornDown || job.epoch !== S.epoch) {
        log(`discarded stale answers for "${question}"`);
        return;
      }
      if (!res || !res.success) {
        const err = new Error((res && res.error) || "no response");
        if (res && res.retryAfterMs) err.retryAfterMs = res.retryAfterMs;
        throw err;
      }

      const incoming = (res.answers || []).filter((a) => typeof a === "string").map((a) => a.trim()).filter((a) => a && a.length <= 60);
      if (incoming.length && S.current) {
        rememberCandidates(S.current.key, incoming);
      }
      const before = S.pool.length;
      S.pool = S.pool.concat(incoming);
      prunePool();
      const gained = S.pool.length - before;
      if (gained <= 0) {
        S.emptyYields++;
        S.fetchNextAt = now() + 4000;
        setStatus("No new answers available", COLORS.warn);
        return;
      }
      S.emptyYields = 0;
      S.fetchFailures = 0;
      S.fetchNextAt = now() + 1500;
      log(`pool +${gained} -> ${S.pool.length} for "${question}"`);
      setStatus(`Ready: ${S.pool.length} answers`, COLORS.ok);
    } catch (e) {
      if (/invalidated/i.test(e.message)) { teardown("extension reloaded"); return; }
      if (job.epoch !== S.epoch) return;
      S.fetchFailures++;
      if (e.retryAfterMs) {
        noteApiLimit(e.retryAfterMs, /daily/i.test(e.message) ? "Gemini daily quota used up" : "Gemini rate limit");
      } else {
        S.fetchNextAt = now() + Math.min(30000, 1500 * 2 ** S.fetchFailures);
        log("refill failed:", e.message);
        setStatus(`Fetch failed: ${e.message}`.slice(0, 80), COLORS.bad);
      }
    }
  }

  async function fetchSingle() {
    bumpGameStat("fallbacks");
    const epoch = S.epoch;
    try {
      const res = await sendMessageWithTimeout({ type: "GENERATE_ANSWER", question: S.question, usedAnswers: buildForbidden() }, FETCH_TIMEOUT_MS);
      if (S.tornDown || epoch !== S.epoch) return "";
      if (res && res.success && typeof res.answer === "string") {
        const a = res.answer.trim();
        return a && !isUnavailable(norm(a)) ? a : "";
      }
      if (res && res.retryAfterMs) noteApiLimit(res.retryAfterMs, "Rate limit hit");
    } catch (e) {
      if (/invalidated/i.test(e.message)) teardown("extension reloaded");
      log("single answer failed:", e.message);
    }
    return "";
  }

  // ---------------------------------------------------------------------------
  // Round lifecycle
  // ---------------------------------------------------------------------------
  function resetRoundState() {
    S.epoch++;
    S.pool = [];
    S.used = new Set();
    S.usedSource = new Map();
    S.good = [];
    S.bad = {};
    S.fetchFailures = 0;
    S.fetchNextAt = 0;
    S.emptyYields = 0;
    S.turn.handled = false;
    S.turn.retryAt = 0;
    S.answerCount = 0;
    S.apiBlockedUntil = 0;
  }

  function describeCandidates() {
    return collectQuestionCandidates().slice(0, 6).map((c) => `${c.sel}: "${c.text}"`);
  }

  function commitQuestion(cand) {
    const prev = S.current;
    jr("COMMIT new round", {
      from: prev ? `"${prev.text}" #${prev.counter}` : null,
      to: `"${cand.text}" #${cand.counter}`,
      via: cand.via,
      phase: getPhase(),
      candidates: describeCandidates(),
    });
    setWhy(prev ? "New category" : "");
    S.commitTimes.push(now());
    resetRoundState();
    const epoch = S.epoch;
    S.current = { text: cand.text, counter: cand.counter, key: cand.key, weak: !!cand.weak };
    S.question = cand.text;
    // Chips already on screen when we first see a category (page refresh mid-round) belong to THIS round.
    if (S.hadRound) snapshotStaleChips();
    S.hadRound = true;
    log(`category #${epoch}: "${cand.text}" (via ${cand.via}${cand.counter ? `, counter ${cand.counter}` : ""})`);
    setStatus("New category — loading answers…", COLORS.info);
    bumpGameStat("rounds");

    S.memoryReady = loadMemory(cand.key)
      .then((mem) => {
        if (S.epoch !== epoch) return;
        S.bad = mem.bad;
        S.good = mem.good;
        // Previously accepted answers are verified by the game itself: most recent first.
        // Followed by cached candidate answers from previous batches.
        const cachedCandidates = (mem.candidates || []).filter((c) => {
          const k = norm(c);
          return k && !S.used.has(k) && (S.bad[k] || 0) < BAD_FORBID_COUNT;
        });
        S.pool = mem.good.slice().reverse().concat(cachedCandidates, S.pool);
        prunePool();
        if (S.pool.length) {
          log(`seeded ${S.pool.length} remembered answers (${mem.good.length} verified, ${cachedCandidates.length} cached)`);
        }
      })
      .catch((e) => log("memory load failed:", e.message));

    requestRefill(true);
  }

  function endRound(reason) {
    if (!S.current) return;
    log("round ended / waiting for next category —", reason);
    jr("END round", { reason, phase: getPhase(), candidates: describeCandidates() });
    setWhy("Round ended");
    resetRoundState();
    S.current = null;
    S.question = "";
    S.pending = null;
    S.absentSince = 0;
    setStatus("Waiting for next category…", COLORS.idle);
  }

  function observeQuestion(t) {
    let cand = readQuestion();
    // A heuristic guess must never replace a category we matched by a real selector.
    if (cand && cand.weak && S.current && !S.current.weak) cand = null;
    if (!cand) {
      S.pending = null;
      if (S.current) {
        if (!S.absentSince) S.absentSince = t;
        else if (t - S.absentSince >= QUESTION_GONE_MS) endRound(`category missing for ${Math.round(t - S.absentSince)}ms (phase="${getPhase()}")`);
      }
      return;
    }
    S.absentSince = 0;
    if (S.current && sameQuestion(cand, S.current)) {
      S.pending = null;
      if (!S.current.counter && cand.counter) S.current.counter = cand.counter;
      return;
    }
    if (S.holdUntil > t) return; // detection was flipping; keep the current round until things settle

    if (!S.pending || !sameQuestion(cand, S.pending.cand)) {
      S.pending = { cand, since: t };
      jr("candidate differs from committed", { committed: S.current ? `"${S.current.text}" #${S.current.counter}` : null, seen: `"${cand.text}" #${cand.counter}`, via: cand.via });
    }
    let need = QUESTION_STABLE_MS;
    if (cand.weak) need = WEAK_STABLE_MS;
    else if (S.current && cand.key === S.current.key) need = COUNTER_ONLY_WAIT_MS;
    if (t - S.pending.since < need) return;

    // Circuit breaker: real categories last many seconds. Several "new categories" in a few seconds means
    // detection is flipping between different elements/texts, and acting on it would just burn answers.
    const recent = S.commitTimes.filter((x) => t - x < FLIP_WINDOW_MS);
    if (S.current && recent.length >= FLIP_MAX) {
      S.holdUntil = t + FLIP_HOLD_MS;
      S.pending = null;
      jr("FLIP BREAKER", { recentCommits: recent.length, holdMs: FLIP_HOLD_MS, seen: `"${cand.text}" via ${cand.via}`, candidates: describeCandidates() });
      setWhy("Category unstable — holding the current one");
      setStatus(HOLD_MSG, COLORS.warn);
      return;
    }
    const c = S.pending.cand;
    S.pending = null;
    commitQuestion(c);
  }

  // ---------------------------------------------------------------------------
  // Typing + submitting
  // ---------------------------------------------------------------------------
  function setInputValue(el, value) {
    el.focus({ preventScroll: true });
    // The prototype setter bypasses framework value interceptors so the game's input handler sees a change.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: value ? "insertText" : "deleteContent", data: value || null }));
  }

  function pressEnter(input) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    input.dispatchEvent(new KeyboardEvent("keydown", opts));
    input.dispatchEvent(new KeyboardEvent("keypress", opts));
    input.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function getKeyboardCodes(char) {
    if (char === " ") return { code: "Space", keyCode: 32 };
    if (char >= "0" && char <= "9") return { code: `Digit${char}`, keyCode: char.charCodeAt(0) };
    if (/[a-zA-Z]/.test(char)) return { code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0) };
    if (char === "-") return { code: "Minus", keyCode: 189 };
    if (char === ".") return { code: "Period", keyCode: 190 };
    if (char === "'" || char === "’") return { code: "Quote", keyCode: 222 };
    if (char === ",") return { code: "Comma", keyCode: 188 };
    return { code: "", keyCode: char.charCodeAt(0) };
  }

  // Types `word` into `input` character-by-character with realistic human cadence,
  // respecting React 18 synthetic input events, panic retry acceleration, and fuse protection.
  async function typeHuman(input, word, { wpm = 100, isRetry = false, turnStartTime = 0, stillMine, epoch } = {}) {
    if (!input || !word) return false;
    input.focus({ preventScroll: true });

    // Base delay per character from WPM formula: (60,000 ms / (WPM * 5 chars)) = 12,000 / WPM
    let baseDelay = 12000 / Math.max(30, Math.min(wpm, 250));

    // Panic override: On retry attempts after a rejection, typist goes into fast reflex mode (2.2x speed)
    if (isRetry) baseDelay = Math.max(25, baseDelay / 2.2);

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    let typedSoFar = "";
    let prevChar = "";

    for (let i = 0; i < word.length; i++) {
      if (S.tornDown || S.epoch !== epoch) return false;
      if (stillMine && !stillMine()) return false;

      // Emergency fuse protection: if the turn has dragged on past 3.2s, flush remaining characters instantly
      if (turnStartTime && (now() - turnStartTime > 3200)) {
        if (setter) setter.call(input, word);
        else input.value = word;
        input.dispatchEvent(new InputEvent("input", {
          bubbles: true, cancelable: true, composed: true,
          inputType: "insertText", data: word.slice(i),
        }));
        return true;
      }

      const char = word[i];
      typedSoFar += char;

      // 1. Dispatch keydown with proper W3C code mapping
      const { code, keyCode } = getKeyboardCodes(char);
      const keyOpts = { key: char, code: code || `Key${char.toUpperCase()}`, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
      input.dispatchEvent(new KeyboardEvent("keydown", keyOpts));

      // 2. Dispatch beforeinput (W3C Input Events Level 2)
      input.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, composed: true,
        inputType: "insertText", data: char,
      }));

      // 3. Set native value descriptor & dispatch input event for React 18
      if (setter) setter.call(input, typedSoFar);
      else input.value = typedSoFar;

      input.dispatchEvent(new InputEvent("input", {
        bubbles: true, cancelable: true, composed: true,
        inputType: "insertText", data: char,
      }));

      // 4. Dispatch keyup
      input.dispatchEvent(new KeyboardEvent("keyup", keyOpts));

      // Humanized cadence calculation:
      let delay = baseDelay;
      // Per-keystroke random variance (+/- 25%)
      delay += (Math.random() * 0.5 - 0.25) * baseDelay;
      // Double letters typed faster (finger already in position)
      if (char === prevChar) delay *= 0.65;
      // Spaces have a slight pause
      if (char === " ") delay += baseDelay * 0.35;
      // Capital letters have slight Shift-key hesitation
      if (/[A-Z]/.test(char) && i > 0) delay += 30;

      prevChar = char;

      // Don't sleep after the very last character (immediately proceed to submission)
      if (i < word.length - 1) {
        await sleep(Math.max(18, Math.round(delay)));
      }
    }

    return true;
  }

  // Ordered submit strategies. Only ONE fires at a time; the next is tried only if the game showed no reaction,
  // so a single word is never sent twice by accident. The method that worked last time goes first, which means
  // the fallback delay is only ever paid on the very first turn.
  function submitMethods(input) {
    const methods = [];
    const form = input.form;
    const btn = findSendButton(input);
    if (form) {
      methods.push({
        id: "form",
        run: () => {
          try {
            if (typeof form.requestSubmit !== "function") throw new Error("no requestSubmit");
            if (btn && !btn.disabled && btn.form === form) form.requestSubmit(btn);
            else form.requestSubmit();
          } catch (e) {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          }
        },
      });
    }
    if (btn) methods.push({ id: "click", run: () => { if (!btn.disabled) btn.click(); } });
    methods.push({ id: "enter", run: () => pressEnter(input) });

    const i = methods.findIndex((m) => m.id === S.preferredMethod);
    if (i > 0) methods.unshift(methods.splice(i, 1)[0]);
    return methods;
  }

  function learnMethod(id) {
    if (!id || S.preferredMethod === id) return;
    S.preferredMethod = id;
    log(`learned submit method: ${id}`);
    chrome.storage.local.set({ submitMethod: id }).catch(() => {});
  }

  // Types `word`, submits it, and works out what the game did with it.
  // Resolves "accepted" | "rejected" | "unknown" | "lost".
  async function submitWord(word, epoch, { attempt = 0, turnStartTime = 0, stillMine } = {}) {
    const input = getGameInput();
    if (!input) return "lost";
    const key = norm(word);

    if (S.humanTyping) {
      const ok = await typeHuman(input, word, {
        wpm: S.typingWpm || 100,
        isRetry: attempt > 0,
        turnStartTime,
        stillMine,
        epoch,
      });
      if (!ok) return "lost";
    } else {
      setInputValue(input, word);
    }

    const btn = findSendButton(input);
    if (btn) await waitFor(() => !btn.disabled, 150);

    const t0 = now();
    const methods = submitMethods(input);
    let fired = 0;
    let nextFireAt = t0;
    let reacted = false;
    let turnLostAt = 0;

    const fire = () => {
      try { methods[fired].run(); } catch (e) { log("submit method failed:", e.message); }
      fired++;
      nextFireAt = now() + (SUBMIT_FALLBACK_MS[fired - 1] ?? 1e9);
    };
    fire();

    // Whatever method was fired last is the one the game reacted to.
    const done = (outcome) => {
      if (outcome === "accepted" || outcome === "rejected") learnMethod(methods[fired - 1].id);
      return outcome;
    };

    for (;;) {
      await sleep(20);
      if (S.tornDown || S.epoch !== epoch) return "lost";
      const t = now();
      const live = getGameInput();
      const mine = isMyTurn(live);

      if (chipHas(key)) return done("accepted");
      if (!live) return "lost"; // the page changed under us
      if (!mine) {
        // Not my box any more. A shake or the box coming back overrules whatever we conclude here.
        if (S.lastShakeAt >= t0) return done("rejected");
        if (!turnLostAt) turnLostAt = t;
        if (norm(live.value) !== key) {
          // The game consumed our text (an accepted answer clears the box): accepted.
          if (t - turnLostAt >= TURN_LOST_CONFIRM_MS) return done("accepted");
        } else if (t - turnLostAt >= TURN_PENDING_MAX_MS) {
          // Turn moved on but our word is still sitting there untouched: the game never took it.
          return "lost";
        }
        continue;
      }
      turnLostAt = 0;
      if (S.lastShakeAt >= t0) return done("rejected");
      if (norm(live.value) !== key) reacted = true;
      if (!reacted && fired < methods.length && t >= nextFireAt) fire();
      // No shake, turn unchanged: either the box cleared with no verdict ("unknown") or the game did not react
      // at all ("ignored" — e.g. it was not ready for answers yet). Neither proves the word is bad.
      if (t - t0 >= (reacted ? ACCEPT_WAIT_MS : IGNORE_AFTER_MS)) return reacted ? "unknown" : "ignored";
    }
  }

  // Wait for an answer to exist: use the pool, else the in-flight fetch, else a single-answer query.
  async function awaitAnswer(stillMine) {
    if (peek()) return true;
    const deadline = now() + POOL_WAIT_MS;
    let kicked = false;
    while (stillMine() && now() < deadline) {
      if (peek()) return true;
      if (apiBlocked()) break;
      if (!fetchInFlight()) {
        // Start at most one forced refill per wait; if a fetch already finished empty-handed, ask for one answer.
        if (kicked || S.fetchFailures > 0) break;
        kicked = true;
        requestRefill(true);
        if (!fetchInFlight()) break;
      }
      await sleep(40);
    }
    if (peek()) return true;
    if (!stillMine()) return false;
    setStatus("Batch unavailable — trying fallback single answer…", COLORS.warn);
    const single = await fetchSingle();
    if (single && stillMine()) {
      S.pool.unshift(single);
      return true;
    }
    return !!peek();
  }

  // One full turn: wait for an answer, think, type, submit, and keep retrying until accepted or the turn ends.
  async function playTurn({ manual = false } = {}) {
    const turn = S.turn;
    if (turn.running) return { ok: false, error: "busy" };
    if (!S.current) return { ok: false, error: "No category detected" };
    if (!isMyTurn(getGameInput())) return { ok: false, error: "Not your turn" };

    turn.running = true;
    const epoch = S.epoch;
    const qkey = S.current.key;
    bumpGameStat("turns");
    jr("playTurn start", { manual, autoWrite: S.autoWrite, pool: S.pool.length });
    const live = () => !S.tornDown && S.epoch === epoch;
    const stillMine = () => live() && isMyTurn(getGameInput());
    let result = { ok: false, error: "aborted" };
    const ignoredCount = {};
    let typedWord = "";

    try {
      setStatus("Your turn — preparing answer…", COLORS.act);
      if (!(await awaitAnswer(stillMine))) {
        if (stillMine()) {
          if (!apiBlocked()) setStatus("No answer available — retrying shortly", COLORS.warn);
          turn.retryAt = now() + 2000;
          result = { ok: false, error: "No answer available" };
        }
        return result;
      }

      const rawDelay = manual ? 0 : Math.min(Math.max(S.thinkingDelay, 0), 3000);
      let delay = rawDelay;
      if (rawDelay > 0) {
        // Uniform jitter: +/- 30% of configured delay (minimum 40ms)
        const jitter = (Math.random() * 2 - 1) * (rawDelay * 0.3);
        delay = Math.max(40, Math.round(rawDelay + jitter));
      }
      if (delay) await sleep(delay);

      const turnStartTime = now();
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TURN; attempt++) {
        if (!stillMine()) {
          // After a rejection the box can briefly be disabled; give it a moment to come back.
          if (attempt === 0 || !(await waitFor(stillMine, 400))) break;
        }
        let word = takeNext();
        if (!word) {
          if (!(await awaitAnswer(stillMine))) break;
          word = takeNext();
          if (!word) break;
        }

        const modeStr = S.humanTyping ? ` (${attempt > 0 ? "turbo" : `${S.typingWpm} WPM`})` : "";
        setStatus(`Typing "${word}"${modeStr}…`, COLORS.act);
        typedWord = word;
        const outcome = await submitWord(word, epoch, { attempt, turnStartTime, stillMine });
        const k = norm(word);
        S.answerCount++;

        if (outcome === "accepted") {
          bumpGameStat("accepted");
          markUsed(k, "accepted by game (our turn)");
          rememberGood(qkey, word);
          log(`"${word}" accepted`);
          setStatus(`Accepted: "${word}"`, COLORS.ok);
          turn.handled = true;
          result = { ok: true, typed: word };
          break;
        }
        if (outcome === "rejected") {
          bumpGameStat("rejected");
          markUsed(k, "rejected by game (our turn)");
          rememberBad(qkey, word);
          log(`"${word}" rejected — trying next`);
          // If the pool is completely empty in sudden death, check if this rejected word has a plausible formatting variant
          // (e.g. "Spider-Man" -> "Spiderman", "St. Louis" -> "Saint Louis") to try before slow network fallback.
          if (S.pool.length === 0) {
            const variants = getWordVariants(word);
            if (variants.length > 0) {
              const bestVariant = variants[0];
              log(`pool dry; attempting variant "${bestVariant}" for rejected "${word}"`);
              S.pool.unshift(bestVariant);
            }
          }
          setStatus(`"${word}" rejected — next…`, COLORS.bad);
          result = { ok: false, error: `"${word}" was rejected` };
          continue;
        }
        if (outcome === "ignored") {
          // The game showed no reaction at all. Keep the word and try again shortly instead of burning answers.
          const n = (ignoredCount[k] = (ignoredCount[k] || 0) + 1);
          const maxTries = S.shakeSeen ? 3 : 2;
          if (n < maxTries) {
            S.pool.unshift(word);
            log(`"${word}" got no reaction (try ${n}/${maxTries}) — game may not be ready; retrying`);
            setStatus(`No reaction to "${word}" — retrying…`, COLORS.warn);
            await sleep(IGNORED_RETRY_GAP_MS);
            continue;
          }
          markUsed(k, `no reaction from game x${n} (our turn)`);
          log(`"${word}" ignored ${n}x — moving on (not blamed)`);
          result = { ok: false, error: "No reaction from the game" };
          continue;
        }
        if (outcome === "unknown") {
          markUsed(k, "outcome unclear (our turn)");
          log(`"${word}" outcome unclear — moving on`);
          result = { ok: false, error: "Outcome unclear" };
          continue;
        }
        break; // "lost": round changed or the page went away
      }
      if (!result.ok && live() && stillMine()) {
        turn.retryAt = now() + 2500; // out of answers for now; a refill may still land before the fuse
        setStatus("Out of answers — retrying shortly", COLORS.warn);
      }
    } catch (e) {
      log("turn error:", e.message);
      setStatus(`Error: ${e.message}`.slice(0, 80), COLORS.bad);
      turn.retryAt = now() + 1500;
      result = { ok: false, error: e.message };
    } finally {
      turn.running = false;
      // Never leave our own text sitting in the answer box (it stays there when the game ignores it).
      try {
        const box = getGameInput();
        if (!result.ok && box && typedWord && norm(box.value) === norm(typedWord)) setInputValue(box, "");
      } catch (e) { /* page is navigating away */ }
    }
    return result;
  }

  function driveAutoWrite() {
    const input = getGameInput();
    const mine = isMyTurn(input);
    if (mine !== S.lastMine) {
      jr("myTurn", { mine, disabled: input ? input.disabled : null, placeholder: input ? input.placeholder : null, phase: getPhase(), autoWrite: S.autoWrite });
      S.lastMine = mine;
    }
    if (!mine) {
      S.turn.handled = false;
      S.mineSince = 0;
      return;
    }
    if (!S.mineSince) S.mineSince = now();
    if (!S.autoWrite || S.turn.running || S.turn.handled) return;
    if (!S.current) {
      if (now() - S.mineSince > 1200 && S.status !== NO_CATEGORY_MSG) setStatus(NO_CATEGORY_MSG, COLORS.warn);
      return;
    }
    if (now() < S.turn.retryAt) return;
    playTurn({ manual: false }).catch((e) => log("turn crashed:", e && e.message));
  }

  function maintainPool() {
    if (S.current && S.pool.length < getPoolLowWater()) requestRefill(false);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat: mutation-driven (instant) + interval (safety net), coalesced
  // ---------------------------------------------------------------------------
  function tick() {
    if (S.tornDown) return;
    if (!extensionAlive()) {
      teardown("extension context invalidated");
      return;
    }
    S.lastTickAt = now();
    try {
      ensureHud();
      observeQuestion(S.lastTickAt);
      if (S.current) {
        scrapeChips();
        maintainPool();
      }
      driveAutoWrite();
      const top = S.current ? peek() : "";
      if (top !== S.lastTop) {
        jr("top answer", `"${S.lastTop}" -> "${top}"`);
        S.lastTop = top;
      }
      refreshHud();
    } catch (e) {
      log("tick error:", e && e.message);
    }
  }

  function scheduleTick() {
    if (S.tornDown) return;
    const gap = now() - S.lastTickAt;
    if (gap >= TICK_MIN_GAP_MS) {
      tick();
    } else if (!S.tickTimer) {
      S.tickTimer = setTimeout(() => {
        S.tickTimer = 0;
        tick();
      }, TICK_MIN_GAP_MS - gap);
    }
  }

  const observer = new MutationObserver((mutations) => {
    let relevant = false;
    for (const m of mutations) {
      if (hud && hud.contains(m.target)) continue;
      relevant = true;
      if (m.type === "attributes" && m.attributeName === "class") {
        const t = m.target;
        if (t.classList && t.classList.contains("ds-shake") && !(m.oldValue || "").split(/\s+/).includes("ds-shake")) noteShake();
      }
    }
    if (relevant) scheduleTick();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["disabled", "class", "placeholder", "data-phase"],
  });

  S.heartbeat = setInterval(scheduleTick, HEARTBEAT_MS);

  // ---------------------------------------------------------------------------
  // Floating HUD
  // ---------------------------------------------------------------------------
  const hudCache = {};
  function setText(id, text) {
    if (hudCache[id] === text || !hud) return;
    const first = hudCache[id] === undefined;
    hudCache[id] = text;
    const el = hud.querySelector("#" + id);
    if (!el) return;
    el.textContent = text;
    if (id === "ai-hud-answer-text" && !first) {
      el.classList.remove("swap");
      void el.offsetWidth; // restart the CSS animation
      el.classList.add("swap");
    }
  }

  function buildHud() {
    hud = document.createElement("div");
    hud.id = HUD_ID;
    hud.innerHTML = `
      <div class="ai-hud-header" id="ai-hud-drag-handle" title="Drag to move · double-click to minimize">
        <div class="ai-hud-title-wrap">
          <span class="ai-hud-dot" id="ai-hud-dot" data-state="idle"></span>
          <span class="ai-hud-title" title="Krillion Bot v${VERSION}">Krillion Bot</span>
          <span class="ai-hud-turn" id="ai-hud-turn">waiting</span>
        </div>
        <div class="ai-hud-header-actions">
          <button class="ai-hud-icon-btn" id="ai-hud-debug-btn" title="Copy diagnostics to clipboard" aria-label="Copy diagnostics"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M6.58 2.69 L6.90 1.09 L9.10 1.09 L9.42 2.69 L10.75 3.24 L12.11 2.34 L13.66 3.89 L12.76 5.25 L13.31 6.58 L14.91 6.90 L14.91 9.10 L13.31 9.42 L12.76 10.75 L13.66 12.11 L12.11 13.66 L10.75 12.76 L9.42 13.31 L9.10 14.91 L6.90 14.91 L6.58 13.31 L5.25 12.76 L3.89 13.66 L2.34 12.11 L3.24 10.75 L2.69 9.42 L1.09 9.10 L1.09 6.90 L2.69 6.58 L3.24 5.25 L2.34 3.89 L3.89 2.34 L5.25 3.24Z M5.70 8.00a2.3 2.3 0 1 0 4.60 0a2.3 2.3 0 1 0 -4.60 0Z"/></svg></button>
          <button class="ai-hud-icon-btn ai-hud-min-btn" id="ai-hud-min-btn" title="Minimize" aria-label="Minimize"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7.2" width="10" height="1.6" rx="0.8"/></svg></button>
          <button class="ai-hud-icon-btn ai-hud-close-btn" id="ai-hud-close-btn" title="Close on this tab (reopen from the extension popup)" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg></button>
        </div>
      </div>
      <div class="ai-hud-body">
        <div class="ai-hud-prompt-row">
          <span class="ai-hud-label">Category</span>
          <span class="ai-hud-prompt-text" id="ai-hud-question-display">Detecting…</span>
        </div>
        <div class="ai-hud-answer-card">
          <div class="ai-hud-answer-header">
            <span class="ai-hud-answer-label">Next answer</span>
            <span class="ai-hud-avoid-count" id="ai-hud-avoid-count">0 ready</span>
          </div>
          <div class="ai-hud-answer-display" id="ai-hud-answer-text">Waiting for category…</div>
          <div class="ai-hud-why" id="ai-hud-why"></div>
        </div>
        <div class="ai-hud-button-grid">
          <button class="ai-hud-btn ai-btn-secondary" id="ai-btn-next" title="Skip this answer"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5v9l6-4.5-6-4.5zm7 0v9h1.8v-9H10z"/></svg>Skip</button>
          <button class="ai-hud-btn ai-btn-secondary" id="ai-btn-copy" title="Copy answer to clipboard"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2A1.5 1.5 0 0 0 4 3.5V4h-.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h5a1.5 1.5 0 0 0 1.5-1.5V12h.5a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 10.5 2h-5zM5 3.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-7z"/></svg>Copy</button>
          <button class="ai-hud-btn ai-btn-primary" id="ai-btn-type" title="Type and submit now (your turn only)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.5 3 9h4l-.7 5.5L13 7H9l.2-5.5z"/></svg>Type now</button>
        </div>
        <div class="ai-hud-toggle-row">
          <div class="ai-hud-toggle-label">
            <span>Auto-write</span>
            <span class="ai-hud-toggle-sub">Types &amp; submits on your turn</span>
          </div>
          <label class="ai-hud-switch">
            <input type="checkbox" id="ai-hud-auto-write-toggle" role="switch" aria-label="Auto-write">
            <span class="ai-hud-switch-slider"></span>
          </label>
        </div>
        <div class="ai-hud-footer-row">
          <span class="ai-hud-status-badge" id="ai-hud-status">Ready</span>
        </div>
      </div>`;
    document.body.appendChild(hud);
    for (const k of Object.keys(hudCache)) delete hudCache[k];
    setupDraggable();
    bindHudEvents();
  }

  function hudShouldShow() {
    if (hudMode === "on") return true;
    if (hudMode === "off") return false;
    return S.showHud && !hudDismissed && isGameDetected();
  }

  function isHudVisible() {
    return !!hud && hud.isConnected && hud.style.display !== "none";
  }

  // Build lazily, then keep display in sync (so the HUD disappears if the SPA navigates off the game page).
  function ensureHud() {
    const show = hudShouldShow();
    if (!hud || !hud.isConnected) {
      if (!show) return;
      buildHud();
    }
    const display = show ? "block" : "none";
    if (hud.style.display !== display) hud.style.display = display;
  }

  function clampHud() {
    if (!hud || !hud.style.left) return;
    const left = Math.max(10, Math.min(window.innerWidth - hud.offsetWidth - 10, parseFloat(hud.style.left) || 10));
    const top = Math.max(10, Math.min(window.innerHeight - hud.offsetHeight - 10, parseFloat(hud.style.top) || 10));
    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }
  window.addEventListener("resize", clampHud);
  cleanups.push(() => window.removeEventListener("resize", clampHud));

  function setupDraggable() {
    const handle = hud.querySelector("#ai-hud-drag-handle");
    let dragging = false;
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = hud.getBoundingClientRect();
      baseLeft = rect.left;
      baseTop = rect.top;
      hud.style.bottom = "auto";
      hud.style.right = "auto";
      hud.style.left = `${baseLeft}px`;
      hud.style.top = `${baseTop}px`;
      hud.classList.add("dragging");
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      hud.style.left = `${Math.max(10, Math.min(window.innerWidth - hud.offsetWidth - 10, baseLeft + e.clientX - startX))}px`;
      hud.style.top = `${Math.max(10, Math.min(window.innerHeight - hud.offsetHeight - 10, baseTop + e.clientY - startY))}px`;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      hud.classList.remove("dragging");
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { /* blocked */ }
      ta.remove();
      return ok;
    }
  }

  function bindHudEvents() {
    const q = (id) => hud.querySelector("#" + id);

    q("ai-btn-next").addEventListener("click", () => {
      skipCurrent();
      requestRefill(false);
      refreshHud();
    });

    q("ai-btn-copy").addEventListener("click", async () => {
      const a = peek();
      if (!a) { setStatus("No answer to copy yet", COLORS.warn); return; }
      setStatus((await copyToClipboard(a)) ? "Copied to clipboard" : "Copy blocked by the browser", COLORS.act);
    });

    q("ai-btn-type").addEventListener("click", async () => {
      const res = await playTurn({ manual: true });
      if (!res.ok && res.error === "Not your turn") setStatus("Not your turn — nothing to type", COLORS.warn);
    });

    q("ai-hud-auto-write-toggle").addEventListener("change", (e) => {
      S.autoWrite = e.target.checked;
      chrome.storage.local.set({ autoWrite: S.autoWrite, autoPlay: S.autoWrite }).catch(() => {});
      setStatus(S.autoWrite ? "Auto-Write ON" : "Show-only mode", S.autoWrite ? COLORS.ok : COLORS.idle);
      scheduleTick();
    });

    q("ai-hud-debug-btn").addEventListener("click", async () => {
      const ok = await copyToClipboard(JSON.stringify(snapshot(), null, 2));
      setStatus(ok ? "Diagnostics copied — paste them to the developer" : "Copy blocked by the browser", ok ? COLORS.act : COLORS.bad);
    });

    const minBtn = q("ai-hud-min-btn");
    const ICON_MIN = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7.2" width="10" height="1.6" rx="0.8"/></svg>`;
    const ICON_RESTORE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.2 3h1.6v4.2H13v1.6H8.8V13H7.2V8.8H3V7.2h4.2z"/></svg>`;
    minBtn.addEventListener("click", () => {
      const isMin = hud.classList.toggle("minimized");
      minBtn.innerHTML = isMin ? ICON_RESTORE : ICON_MIN;
      minBtn.title = isMin ? "Restore" : "Minimize";
      minBtn.setAttribute("aria-label", minBtn.title);
      minBtn.setAttribute("aria-pressed", String(isMin));
    });

    const handle = hud.querySelector("#ai-hud-drag-handle");
    if (handle) {
      handle.addEventListener("dblclick", (e) => {
        if (e.target.closest("button") || e.target.closest("input")) return;
        minBtn.click();
      });
    }

    q("ai-hud-close-btn").addEventListener("click", () => {
      hud.style.display = "none";
      hudDismissed = true;
      hudMode = "auto";
      try { sessionStorage.setItem("regqube_ai_hud_dismissed", "true"); } catch (e) { /* storage blocked */ }
    });
  }

  function refreshHud() {
    if (!hud || !hud.isConnected) return;
    const input = getGameInput();
    const mine = isMyTurn(input);
    const out = isEliminated(input);

    const qText = S.current ? `${S.current.counter ? `#${S.current.counter} · ` : ""}${S.question}` : "Waiting for the next category…";
    setText("ai-hud-question-display", qText.length > 90 ? `${qText.slice(0, 90)}…` : qText);
    const top = S.current ? peek() : "";
    setText("ai-hud-answer-text", top || (S.current ? (fetchInFlight() ? "Fetching…" : "No answer yet") : "Waiting for category…"));
    setText("ai-hud-avoid-count", `${S.pool.length} ready · ${S.used.size} used`);
    setText("ai-hud-status", S.status);
    setText("ai-hud-why", S.why && now() - S.whyAt < 12000 ? S.why : "");
    setText("ai-hud-turn", out ? "out" : mine ? "YOUR TURN" : "waiting");

    if (hudCache.statusColor !== S.statusColor) {
      hudCache.statusColor = S.statusColor;
      const badge = hud.querySelector("#ai-hud-status");
      if (badge) badge.style.color = S.statusColor;
    }
    const turnEl = hud.querySelector("#ai-hud-turn");
    if (turnEl) {
      turnEl.classList.toggle("on", mine);
      turnEl.classList.toggle("out", out);
    }
    const dotState = S.holdUntil > now() || apiBlocked() ? "warn" : S.autoWrite && S.current ? "armed" : "idle";
    if (hudCache.dotState !== dotState) {
      hudCache.dotState = dotState;
      const dot = hud.querySelector("#ai-hud-dot");
      if (dot) dot.dataset.state = dotState;
    }
    const toggle = hud.querySelector("#ai-hud-auto-write-toggle");
    if (toggle && toggle.checked !== S.autoWrite) toggle.checked = S.autoWrite;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics (HUD gear button): everything needed to debug selectors without a DevTools session
  // ---------------------------------------------------------------------------
  // Every piece of visible text inside the game root with its element path: shows where the category really lives.
  function textMap() {
    const root = getRoot() || document.body;
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && out.length < 80) {
      const text = cleanText(n.nodeValue);
      const el = n.parentElement;
      if (!text || !el || el.closest("#" + HUD_ID) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      const chain = [];
      for (let a = el, i = 0; a && a !== root && i < 4; a = a.parentElement, i++) {
        const cls = typeof a.className === "string" && a.className.trim() ? "." + a.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
        chain.push(a.tagName.toLowerCase() + cls);
      }
      out.push({ text: text.slice(0, 80), path: chain.join(" < ") });
    }
    return out;
  }

  function snapshot() {
    const input = getGameInput();
    const btn = findSendButton(input);
    const snip = (sel, n) => {
      const el = document.querySelector(sel);
      return el ? el.outerHTML.slice(0, n) : null;
    };
    return {
      version: VERSION,
      url: location.href,
      gameStats: { ...gameStats },
      playerCount: getPlayerCount(),
      phase: getPhase(),
      committedQuestion: S.current,
      detectedNow: (() => { const r = readQuestion(); return r ? { text: r.text, counter: r.counter, via: r.via } : null; })(),
      candidates: collectQuestionCandidates().map((c) => ({ via: c.sel, text: c.text, rendered: isRendered(c.el, true) })),
      labels: Array.from(document.querySelectorAll(LABEL_SELECTOR)).map((e) => cleanText(e.textContent)),
      textMap: textMap(),
      shakeSeen: S.shakeSeen,
      hidden: document.hidden,
      holdMsLeft: Math.max(0, Math.round(S.holdUntil - now())),
      input: input ? { disabled: input.disabled, placeholder: input.placeholder, value: input.value, hasForm: !!input.form } : null,
      sendButton: btn ? { text: btn.textContent.trim(), disabled: btn.disabled, type: btn.type } : null,
      myTurn: isMyTurn(input),
      eliminated: isEliminated(input),
      chips: Array.from(document.querySelectorAll(".pf-say")).map((e) => ({ cls: e.className, text: e.textContent })),
      used: Array.from(S.used).slice(0, 60),
      usedSources: Object.fromEntries(S.usedSource),
      why: S.why,
      pool: S.pool.slice(0, 20),
      remembered: { good: S.good.slice(-20), bad: S.bad },
      lastShakeMsAgo: S.lastShakeAt < 0 ? null : Math.round(now() - S.lastShakeAt),
      fetch: { inFlight: fetchInFlight(), failures: S.fetchFailures, nextInMs: Math.max(0, Math.round(S.fetchNextAt - now())), emptyYields: S.emptyYields },
      turn: { ...S.turn },
      autoWrite: S.autoWrite,
      humanTyping: S.humanTyping,
      typingWpm: S.typingWpm,
      status: S.status,
      html: { card: snip(".ds-card", 1500), hudMid: snip(".ds-hud-mid", 800), dock: snip(".ds-dock", 1200) },
      log: logBuf.slice(-200),
    };
  }

  // ---------------------------------------------------------------------------
  // Messaging with popup / background
  // ---------------------------------------------------------------------------
  const onMessage = (msg, sender, sendResponse) => {
    switch (msg && msg.type) {
      case "TOGGLE_HUD_FORCE": {
        const wasVisible = isHudVisible();
        hudDismissed = false;
        try { sessionStorage.removeItem("regqube_ai_hud_dismissed"); } catch (e) { /* storage blocked */ }
        hudMode = wasVisible ? "off" : "on";
        ensureHud();
        sendResponse({ success: true, visible: isHudVisible() });
        return false;
      }
      case "MANUAL_PLAY_TRIGGER":
        playTurn({ manual: true }).then((res) => sendResponse({ success: res.ok, error: res.error }));
        return true;
      case "GET_PAGE_STATE": {
        const input = getGameInput();
        sendResponse({
          success: true,
          isGame: isGameDetected(),
          question: S.question,
          currentAnswer: peek(),
          poolCount: S.pool.length,
          avoidCount: S.used.size,
          hasInput: !!input,
          myTurn: isMyTurn(input),
          status: S.status,
          isAutoWrite: S.autoWrite,
          isHudVisible: isHudVisible(),
        });
        return false;
      }
      case "TRIGGER_NEXT_ANSWER":
        skipCurrent();
        requestRefill(false);
        sendResponse({ success: true, question: S.question, currentAnswer: peek(), poolCount: S.pool.length, avoidCount: S.used.size });
        return false;
      case "TRIGGER_AUTO_TYPE":
        playTurn({ manual: true }).then((res) => sendResponse({ success: res.ok, typed: res.typed, error: res.error }));
        return true;
      default:
        return false;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  cleanups.push(() => chrome.runtime.onMessage.removeListener(onMessage));

  // ---------------------------------------------------------------------------
  // Background-tab resilience. A hidden/occluded tab has its timers throttled, so (1) sleep() above is delegated to
  // the background worker, (2) the worker pushes a tick over a port while we are hidden, (3) we hold a Web Lock,
  // which keeps Chrome from freezing the page. DOM mutations still wake us instantly in all cases.
  // ---------------------------------------------------------------------------
  let tickPort = null;
  function connectTickPort() {
    if (S.tornDown || !extensionAlive()) return;
    try {
      const port = chrome.runtime.connect({ name: "tick" });
      tickPort = port;
      port.onMessage.addListener(() => scheduleTick());
      port.onDisconnect.addListener(() => {
        if (tickPort === port) tickPort = null;
        if (!S.tornDown) setTimeout(connectTickPort, 1000);
      });
      port.postMessage({ hidden: document.hidden });
    } catch (e) {
      tickPort = null;
    }
  }
  const onVisibility = () => {
    jr("visibility", document.visibilityState);
    if (tickPort) {
      try { tickPort.postMessage({ hidden: document.hidden }); } catch (e) { /* port closing */ }
    }
    scheduleTick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  cleanups.push(() => { try { if (tickPort) tickPort.disconnect(); } catch (e) { /* already gone */ } });
  connectTickPort();
  try {
    if (navigator.locks) navigator.locks.request("regqube-ai-keepalive", () => new Promise(() => {})).catch(() => {});
  } catch (e) { /* best effort */ }

  // ---------------------------------------------------------------------------
  // Teardown (extension reloaded/updated while the page stays open)
  // ---------------------------------------------------------------------------
  function teardown(reason) {
    if (S.tornDown) return;
    S.tornDown = true;
    S.epoch++;
    clearInterval(S.heartbeat);
    clearTimeout(S.tickTimer);
    clearTimeout(gameStatsTimer);
    observer.disconnect();
    for (const fn of cleanups) {
      try { fn(); } catch (e) { /* context already gone */ }
    }
    if (hud) hud.remove();
    window.__REGQUBE_AI_LOADED__ = false;
    console.log(`[RegQube AI] stopped: ${reason}`);
  }

  log(`v${VERSION} ready`);
  scheduleTick();
})();
