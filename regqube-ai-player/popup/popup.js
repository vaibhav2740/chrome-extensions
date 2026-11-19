// RegQube AI Player - Popup Script
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const tabStatusEl = $("tabStatus");
  const liveAvoidEl = $("liveAvoid");
  const liveQuestionEl = $("liveQuestion");
  const liveAnswerEl = $("liveAnswer");
  const liveNextBtn = $("liveNextBtn");
  const liveCopyBtn = $("liveCopyBtn");
  const liveTypeBtn = $("liveTypeBtn");
  const toggleHudTabBtn = $("toggleHudTabBtn");

  const autoPlayInput = $("autoPlay");
  const showHudInput = $("showHud");
  const humanTypingInput = $("humanTyping");
  const backgroundPlayInput = $("backgroundPlay");
  const typingWpmInput = $("typingWpm");
  const wpmRow = $("wpmRow");
  const wpmValueSpan = $("wpmValue");
  const wpmHintSpan = $("wpmHint");
  const thinkingDelayInput = $("thinkingDelay");
  const delayValueSpan = $("delayValue");
  const modelSelect = $("model");
  const apiKeyInput = $("apiKey");
  const toggleKeyVisBtn = $("toggleKeyVis");
  const groqApiKeyInput = $("groqApiKey");
  const toggleGroqKeyVisBtn = $("toggleGroqKeyVis");
  const clearMemoryBtn = $("clearMemoryBtn");
  const statusMsg = $("statusMsg");
  const statsLine = $("apiStats");
  const gameStatsEl = $("gameStats");
  const providerRadios = Array.from(document.querySelectorAll('input[name="provider"]'));
  const glassRadios = Array.from(document.querySelectorAll('input[name="glass"]'));

  const MAX_INJECT_ATTEMPTS = 2;
  const REFRESH_MS = 1500;
  let statusTimer = 0;
  let saveTimer = 0;

  // ---------------------------------------------------------------------------
  // Settings: load once, then every change autosaves (no Save button to forget).
  // ---------------------------------------------------------------------------
  const settings = await chrome.storage.local.get(["apiKey", "groqApiKey", "model", "provider", "autoWrite", "autoPlay", "thinkingDelay", "showHud", "humanTyping", "typingWpm", "glassMode", "backgroundPlay"]);

  autoPlayInput.checked = settings.autoWrite !== undefined ? !!settings.autoWrite : !!settings.autoPlay;
  showHudInput.checked = settings.showHud !== undefined ? !!settings.showHud : true;
  humanTypingInput.checked = !!settings.humanTyping;
  backgroundPlayInput.checked = settings.backgroundPlay !== undefined ? !!settings.backgroundPlay : true;
  const updateWpmVisibility = () => {
    if (wpmRow) wpmRow.style.display = humanTypingInput.checked ? "flex" : "none";
  };
  updateWpmVisibility();
  humanTypingInput.addEventListener("change", updateWpmVisibility);
  if (settings.typingWpm !== undefined) typingWpmInput.value = settings.typingWpm;
  const updateWpmLabel = (w) => {
    const n = parseInt(w, 10) || 100;
    wpmValueSpan.textContent = `${n} WPM`;
    const ms = Math.round(12000 / n);
    if (wpmHintSpan) wpmHintSpan.textContent = `~${ms}ms per key with natural human rhythm`;
  };
  updateWpmLabel(typingWpmInput.value);
  if (settings.thinkingDelay !== undefined) thinkingDelayInput.value = settings.thinkingDelay;
  const updateDelayLabel = (v) => { delayValueSpan.textContent = parseInt(v, 10) === 0 ? "0ms (instant)" : `${v}ms`; };
  updateDelayLabel(thinkingDelayInput.value);
  if (settings.model) modelSelect.value = settings.model;
  if (typeof settings.apiKey === "string") apiKeyInput.value = settings.apiKey;
  if (typeof settings.groqApiKey === "string") groqApiKeyInput.value = settings.groqApiKey;
  const provider = ["auto", "groq", "gemini"].includes(settings.provider) ? settings.provider : "auto";
  providerRadios.forEach((r) => { r.checked = r.value === provider; });
  const glassMode = ["auto", "on", "off"].includes(settings.glassMode) ? settings.glassMode : "auto";
  glassRadios.forEach((r) => { r.checked = r.value === glassMode; });

  function showStatus(text, color) {
    statusMsg.textContent = text;
    statusMsg.style.color = color;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusMsg.textContent = ""; }, 2400);
  }

  async function saveSettings() {
    const chosen = providerRadios.find((r) => r.checked);
    const groqKey = groqApiKeyInput.value.trim();
    await chrome.storage.local.set({
      autoWrite: autoPlayInput.checked,
      autoPlay: autoPlayInput.checked,
      showHud: showHudInput.checked,
      humanTyping: humanTypingInput.checked,
      backgroundPlay: backgroundPlayInput.checked,
      typingWpm: parseInt(typingWpmInput.value, 10) || 100,
      thinkingDelay: parseInt(thinkingDelayInput.value, 10) || 0,
      model: modelSelect.value,
      provider: chosen ? chosen.value : "auto",
      glassMode: (glassRadios.find((r) => r.checked) || { value: "auto" }).value,
      apiKey: apiKeyInput.value.trim(),
      groqApiKey: groqKey,
    });
    if (groqKey && !groqKey.startsWith("gsk_")) showStatus("Saved — note: Groq keys normally start with gsk_", "#ffd60a");
    else showStatus("Saved", "#30d158");
    showApiStats();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 250);
  }

  typingWpmInput.addEventListener("input", () => {
    updateWpmLabel(typingWpmInput.value);
  });
  thinkingDelayInput.addEventListener("input", () => {
    updateDelayLabel(thinkingDelayInput.value);
  });
  [autoPlayInput, showHudInput, humanTypingInput, backgroundPlayInput, typingWpmInput, thinkingDelayInput, modelSelect, apiKeyInput, groqApiKeyInput, ...providerRadios, ...glassRadios]
    .forEach((el) => el.addEventListener("change", scheduleSave));

  function bindVisibilityToggle(btn, input) {
    btn.addEventListener("click", () => {
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      btn.textContent = hidden ? "🔒" : "👁";
    });
  }
  bindVisibilityToggle(toggleKeyVisBtn, apiKeyInput);
  bindVisibilityToggle(toggleGroqKeyVisBtn, groqApiKeyInput);

  clearMemoryBtn.addEventListener("click", async () => {
    if (!confirm("Clear everything learned about past categories (accepted and rejected answers)?")) return;
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_ALL_MEMORY" });
    if (response?.success) showStatus(`Memory reset (${response.count} categories cleared)`, "#0a84ff");
    else showStatus(response?.error || "Could not clear memory", "#ff453a");
  });

  // ---------------------------------------------------------------------------
  // Active game tab
  // ---------------------------------------------------------------------------
  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function send(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        void chrome.runtime.lastError; // content script absent: resolve undefined
        resolve(response);
      });
    });
  }

  function setBadge(text, error) {
    tabStatusEl.textContent = text;
    tabStatusEl.classList.toggle("error", !!error);
  }

  function setDisconnectedState(msg) {
    setBadge("Not connected", true);
    liveQuestionEl.textContent = msg;
    liveAnswerEl.textContent = "—";
  }

  async function queryActiveTab(attempt = 0) {
    const tab = await activeTab();
    if (!tab?.id) return setDisconnectedState("No active tab");
    if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
      return setDisconnectedState("Open your game tab (krillion.io/party/…)");
    }

    let response = await send(tab.id, { type: "GET_PAGE_STATE" });
    if (!response && attempt < MAX_INJECT_ATTEMPTS) {
      // Tab was open before the extension loaded: inject on the fly (only allowed on game hosts).
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
        await new Promise((r) => setTimeout(r, 200));
        response = await send(tab.id, { type: "GET_PAGE_STATE" });
      } catch (e) {
        return setDisconnectedState("Not a game tab — open krillion.io/party/… (or refresh it)");
      }
    }
    if (!response) return setDisconnectedState("Refresh the game tab (⌘R)");

    if (!response.isGame) setBadge("Not a game page", false);
    else if (response.myTurn) setBadge("Your turn", false);
    else setBadge("Game active", false);

    liveQuestionEl.textContent = response.question || (response.isGame ? "Waiting for the next category…" : "Not a game page");
    liveAnswerEl.textContent = response.currentAnswer || response.status || "No answer yet";
    liveAvoidEl.textContent = `${response.avoidCount || 0} used · ${response.poolCount || 0} ready`;
  }

  toggleHudTabBtn.addEventListener("click", async () => {
    const tab = await activeTab();
    if (!tab?.id) return;
    const res = await send(tab.id, { type: "TOGGLE_HUD_FORCE" });
    if (res?.success) showStatus(res.visible ? "Widget shown" : "Widget hidden", "#0a84ff");
    else showStatus("Open a game tab first", "#ffd60a");
  });

  liveNextBtn.addEventListener("click", async () => {
    const tab = await activeTab();
    if (!tab?.id) return;
    const res = await send(tab.id, { type: "TRIGGER_NEXT_ANSWER" });
    if (res?.success) {
      liveAnswerEl.textContent = res.currentAnswer || "No answer ready yet";
      if (res.question) liveQuestionEl.textContent = res.question;
      liveAvoidEl.textContent = `${res.avoidCount || 0} used · ${res.poolCount || 0} ready`;
    } else {
      showStatus("Open a game tab first", "#ffd60a");
    }
  });

  liveCopyBtn.addEventListener("click", async () => {
    const text = liveAnswerEl.textContent.trim();
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      showStatus("Copied", "#0a84ff");
    } catch (e) {
      showStatus("Copy blocked by the browser", "#ff453a");
    }
  });

  liveTypeBtn.addEventListener("click", async () => {
    const tab = await activeTab();
    if (!tab?.id) return;
    const res = await send(tab.id, { type: "TRIGGER_AUTO_TYPE" });
    if (res?.success) {
      showStatus(`Typed "${res.typed}"`, "#30d158");
      liveAnswerEl.textContent = res.typed;
    } else {
      showStatus(res?.error || "Open a game tab first", "#ff453a");
    }
  });

  // ---------------------------------------------------------------------------
  // AI provider health
  // ---------------------------------------------------------------------------
  function setChip(id, metaId, state, meta) {
    $(id).dataset.state = state;
    $(metaId).textContent = meta;
  }

  const shortModel = (m) => String(m || "").replace(/^gemini-/, "").replace(/-latest$/, "").replace(/-preview$/, "");

  async function showApiStats() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_API_STATS" });
      if (!res?.stats) return;
      const { stats: st, providers: p } = res;

      if (p) {
        const g = p.groq;
        if (!g.configured) setChip("chipGroq", "groqMeta", "off", "No key");
        else if (g.block) setChip("chipGroq", "groqMeta", "cooling", g.block.daily ? "Daily limit hit" : `Cooling ${g.block.secondsLeft}s`);
        else if (g.limits && g.limits.remaining != null) setChip("chipGroq", "groqMeta", "ready", `${g.limits.remaining}/${g.limits.limit} left today`);
        else setChip("chipGroq", "groqMeta", "ready", g.latencyMs ? `Ready · ${g.latencyMs}ms` : "Ready");

        const m = p.gemini;
        if (!m.configured) setChip("chipGemini", "geminiMeta", "off", "No key");
        else if (m.block) setChip("chipGemini", "geminiMeta", "cooling", m.block.daily ? "Daily limit hit" : `Cooling ${m.block.secondsLeft}s`);
        else setChip("chipGemini", "geminiMeta", "ready", `${shortModel(m.model)}${m.latencyMs ? ` · ${m.latencyMs}ms` : ""}`);
      }

      const limited = res.blocked?.length > 0;
      statsLine.textContent = `Today: ${st.calls || 0} requests · ${st.rateLimited || 0} rate-limited · ${st.cacheHits || 0} from cache`;
      statsLine.classList.toggle("warn", limited);

      try {
        const { gameStats: gs } = await chrome.storage.local.get("gameStats");
        if (gs && (gs.rounds || gs.accepted || gs.rejected)) {
          gameStatsEl.textContent = `Session: ${gs.rounds || 0} rounds · ${gs.accepted || 0} accepted · ${gs.rejected || 0} rejected`;
        } else {
          gameStatsEl.textContent = "";
        }
      } catch (e) {
        gameStatsEl.textContent = "";
      }
    } catch (e) {
      statsLine.textContent = "";
      if (gameStatsEl) gameStatsEl.textContent = "";
    }
  }

  queryActiveTab();
  showApiStats();
  // Keep the panel live while the popup is open (no re-injection on refresh ticks).
  const refresh = setInterval(() => {
    queryActiveTab(MAX_INJECT_ATTEMPTS).catch(() => {});
    showApiStats();
  }, REFRESH_MS);
  window.addEventListener("unload", () => clearInterval(refresh));
});
