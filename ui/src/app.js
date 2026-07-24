import { commandRegistry } from "./commands/index.js";
import { createCommandHost } from "./commands/host.js";
import { mountShell } from "./shell/shell.js";
import { createSettingsController } from "./shell/settings.js";
import { createChatRenderer } from "./features/chat/renderer.js";
import { createChatRuntime } from "./features/chat/runtime.js";
import { enhanceCodeBlocks, escapeHtml, renderMarkdown } from "./shared/markdown.js";
import { setupBeepFix } from "./features/fix-beep/index.js";
import { restoreLastConversation } from "./features/session-persistence/index.js";
import { startSTT, checkSTTMode } from "./features/speech-to-text/index.js";
import { detectLocalServices, renderLocalPresets, createProviderFromPreset } from "./features/local-llm/index.js";
import { enhanceTranslatePrompt, hasImageAttachments, imageAttachSummary } from "./commands/translate/image-translate.js";
import {
  defaultEfforts,
  formatProviderFormat,
  headersToText,
  modelLabelOf,
  normalizeProviderConfig,
  parseJsonObject,
  prettyJson,
  textToHeaders,
} from "./shared/provider-utils.js";

const api = window.launcher;
const chatRuntime = createChatRuntime(api);
await mountShell(document.getElementById("app"));
const commandHost = createCommandHost({
  host: document.getElementById("command-view-host"),
  quickActionsHost: document.getElementById("quick-command-actions-host"),
  context: {
    api,
    openConversation,
    startNewConversation,
    getCurrentConversationId: () => currentConversationId,
    clearCurrentConversationId: (id) => {
      if (currentConversationId === id) currentConversationId = null;
    },
  },
});
await commandHost.prepareAll(commandRegistry.listAll());

function openExternalLink(event) {
  const element = event.target instanceof Element ? event.target : null;
  const link = element?.closest("a[href]");
  if (!link) return;
  let url;
  try {
    url = new URL(link.href);
  } catch {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.type === "click" && event.button === 0) {
    api.openExternalUrl(url.href).catch((error) => console.warn("open external link", error));
  }
}

// Markdown references must never replace the launcher WebView.
document.addEventListener("click", openExternalLink, true);
document.addEventListener("auxclick", openExternalLink, true);

const els = {
  q: document.getElementById("q"),
  quickWebButton: document.getElementById("quick-web-button"),
  recent: document.getElementById("recent"),
  recentSection: document.getElementById("recent-section"),
  recentCount: document.getElementById("recent-count"),
  recentContextMenu: document.getElementById("recent-context-menu"),
  btnRemoveRecent: document.getElementById("btn-remove-recent"),
  builtinSection: document.getElementById("builtin-section"),
  btnBuiltinAi: document.getElementById("btn-builtin-ai"),
  btnBuiltinFy: document.getElementById("btn-builtin-fy"),
  btnBuiltinFile: document.getElementById("btn-builtin-file"),
  modePrefix: document.getElementById("mode-prefix"),
  slashMenu: document.getElementById("slash-menu"),
  list: document.getElementById("list"),
  listSection: document.getElementById("list-section"),
  listTitle: document.getElementById("list-title"),
  listCount: document.getElementById("list-count"),
  idleHint: document.getElementById("idle-hint"),
  aiSection: document.getElementById("ai-section"),
  aiThread: document.getElementById("ai-thread"),
  aiStatus: document.getElementById("ai-status"),
  btnAiStop: document.getElementById("btn-ai-stop"),
  aiMoreWrap: document.querySelector(".ai-more-wrap"),
  aiMoreMenu: document.getElementById("ai-more-menu"),
  btnAiMore: document.getElementById("btn-ai-more"),
  aiMenuNew: document.getElementById("ai-menu-new"),
  aiMenuFollowup: document.getElementById("ai-menu-followup"),
  aiMenuHistory: document.getElementById("ai-menu-history"),
  aiMenuMode: document.getElementById("ai-menu-mode"),
  conversationPanel: document.getElementById("conversation-panel"),
  conversationList: document.getElementById("conversation-list"),
  btnCloseConversations: document.getElementById("btn-close-conversations"),
  pageMain: document.getElementById("page-main"),
  pageConversation: document.getElementById("page-conversation"),
  conversationThreadHost: document.getElementById("conversation-thread-host"),
  conversationForm: document.getElementById("conversation-form"),
  conversationInput: document.getElementById("conversation-input"),
  conversationSend: document.getElementById("conversation-send"),
  conversationModelButton: document.getElementById("conversation-model-button"),
  conversationModelName: document.getElementById("conversation-model-name"),
  conversationModelMenu: document.getElementById("conversation-model-menu"),
  btnConversationBack: document.getElementById("btn-conversation-back"),
  btnConversationNew: document.getElementById("btn-conversation-new"),
  btnConversationHistory: document.getElementById("btn-conversation-history"),
  btnConversationPin: document.getElementById("btn-conversation-pin"),
  conversationHistoryDrawer: document.getElementById("conversation-history-drawer"),
  conversationDrawerList: document.getElementById("conversation-drawer-list"),
  btnConversationHistoryClose: document.getElementById("btn-conversation-history-close"),
  conversationAttachments: document.getElementById("conversation-attachments"),
  conversationFileInput: document.getElementById("conversation-file-input"),
  btnConversationAttach: document.getElementById("btn-conversation-attach"),
  conversationFilePrefix: document.getElementById("conversation-file-prefix"),
  conversationWebButton: document.getElementById("conversation-web-button"),
  conversationJumpBottom: document.getElementById("conversation-jump-bottom"),
  pageSettings: document.getElementById("page-settings"),
  pageViewer: document.getElementById("page-viewer"),
  viewerBody: document.getElementById("viewer-body"),
  viewerScroll: document.getElementById("viewer-scroll"),
  btnViewerBack: document.getElementById("btn-viewer-back"),
  btnViewerCopy: document.getElementById("btn-viewer-copy"),
  btnSettings: document.getElementById("btn-settings"),
  btnBack: document.getElementById("btn-back"),
  themeGrid: document.getElementById("theme-grid"),
  providerList: document.getElementById("provider-list"),
  pvName: document.getElementById("pv-name"),
  pvFormat: document.getElementById("pv-format"),
  pvBase: document.getElementById("pv-base"),
  pvKey: document.getElementById("pv-key"),
  pvHeaders: document.getElementById("pv-headers"),
  pvRequestBody: document.getElementById("pv-request-body"),
  pvExtraOptions: document.getElementById("pv-extra-options"),
  pvModel: document.getElementById("pv-model"),
  pvAddModel: document.getElementById("pv-add-model"),
  btnAddProvider: document.getElementById("btn-add-provider"),
  btnDelProvider: document.getElementById("btn-del-provider"),
  btnSaveAi: document.getElementById("btn-save-ai"),
  aiSaveMsg: document.getElementById("ai-save-msg"),
  homeUiGrid: document.getElementById("home-ui-grid"),
  cardsChrome: document.getElementById("cards-chrome"),
  btnCardsMin: document.getElementById("btn-cards-min"),
  btnCardsMax: document.getElementById("btn-cards-max"),
  btnCardsClose: document.getElementById("btn-cards-close"),
  webEngineSelect: document.getElementById("web-engine-select"),
  proxyUrlInput: document.getElementById("proxy-url-input"),
  proxyStatusLabel: document.getElementById("proxy-status-label"),
  translateModelSelect: document.getElementById("translate-model-select"),
  translateNoThinkToggle: document.getElementById("translate-no-think-toggle"),
  settingsNav: document.getElementById("settings-nav"),
  commandSettingsList: document.getElementById("command-settings-list"),
  commandSettingsError: document.getElementById("command-settings-error"),
  btnManageProviders: document.getElementById("btn-manage-providers"),
  providerPanel: document.getElementById("provider-panel"),
  btnSetActiveProvider: document.getElementById("btn-set-active-provider"),
  btnRefreshIndex: document.getElementById("btn-refresh-index"),
  appScanPathList: document.getElementById("app-scan-path-list"),
  appScanPathInput: document.getElementById("app-scan-path-input"),
  btnAddAppScanPath: document.getElementById("btn-add-app-scan-path"),
  appScanDepth: document.getElementById("app-scan-depth"),
  btnOpenDataDir: document.getElementById("btn-open-data-dir"),
  btnOpenDataDir2: document.getElementById("btn-open-data-dir-2"),
  aiCurrentLabel: document.getElementById("ai-current-label"),
  aiKeyWarn: document.getElementById("ai-key-warn"),
  aboutDataDir: document.getElementById("about-data-dir"),
  hotkeyInput: document.getElementById("hotkey-input"),
  btnSaveHotkey: document.getElementById("btn-save-hotkey"),
  settingsToast: document.getElementById("settings-toast"),
  btnPickModel: document.getElementById("btn-pick-model"),
  btnAddModel: document.getElementById("btn-add-model"),
  modelPicker: document.getElementById("model-picker"),
  modelList: document.getElementById("model-list"),
  pvModelLabel: document.getElementById("pv-model-label"),
  btnCloseProvider: document.getElementById("btn-close-provider"),
  btnCancelProvider: document.getElementById("btn-cancel-provider"),
  providerCancelConfirm: document.getElementById("provider-cancel-confirm"),
  btnProviderContinue: document.getElementById("btn-provider-continue"),
  btnProviderConfirmCancel: document.getElementById("btn-provider-confirm-cancel"),
  providerDialogTitle: document.getElementById("provider-dialog-title"),
  conversationRetention: document.getElementById("conversation-retention"),
  btnSttConversation: document.getElementById("btn-stt-conversation"),
  localLlmList: document.getElementById("local-llm-list"),
};

const settingsView = createSettingsController(els.pageSettings, {
  onPanelChange: (name) => {
    settingsPanel = name;
    if (name === "ai") refreshAiOverview();
    if (name === "commands") renderCommandSettings();
    if (name === "about" || name === "general") refreshProxyStatus();
  },
});

/** @type {any[]} */
let apps = [];
/** @type {any[]} */
let recent = [];
/** @type {any[]} */
let filtered = [];
let active = 0;
let iconBatchTimer = 0;
const pendingIconTargets = new Set();
const requestedIconTargets = new Set();
const iconRetryCounts = new Map();
let suppressRecentClick = false;
let recentContextTarget = "";
let launcherResizeFrame = 0;
let launcherViewportWidth = window.innerWidth;
const iconObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) queueIconTarget(entry.target.dataset.iconTarget);
    }
  },
  { rootMargin: "80px" },
);
/** browse | search | command (slash mode active) */
let mode = "browse";
/** null | ai | fy | ... when in slash command mode */
let cmdMode = null;

function commandPreferences(source = settingsSnap) {
  return commandRegistry.normalizePreferences({
    commandOrder: source?.commandOrder,
    disabledCommands: source?.disabledCommands,
  });
}

function syncCommandPreferences(source = settingsSnap) {
  const normalized = commandPreferences(source);
  settingsSnap.commandOrder = normalized.commandOrder;
  settingsSnap.disabledCommands = normalized.disabledCommands;
  return normalized;
}

function isCommandEnabled(id) {
  const command = commandRegistry.get(id);
  if (!command) return false;
  return commandRegistry
    .list(commandPreferences())
    .some((item) => item.id === command.id);
}

function resolveSlashMode(token) {
  return commandRegistry.resolve(token);
}

function currentModeDef() {
  const command = cmdMode ? commandRegistry.get(cmdMode) : null;
  return command && isCommandEnabled(command.id) ? command : null;
}
/** main | settings | viewer | conversation */
let page = "main";
let settingsReturnPage = "main";
let settingsReturnFocus = null;
let settingsWindowPromise = Promise.resolve();
let viewerWindowPromise = Promise.resolve();
let theme = "white";
let viewerOpen = false;
let conversationModeOpen = false;
let conversationSelectedModel = "";
let conversationSelectedEffort = "";
let conversationRequestBody = {};
let conversationMenuView = "main";
let pendingAttachments = [];
/** @type {any} */
let settingsSnap = {
  theme: "white",
  homeUi: "classic",
  appScanPaths: [],
  appScanDepth: 2,
  webSearch: true,
  webSearchEngine: "auto",
  proxyUrl: "http://127.0.0.1:10808",
  proxyEnabledForGoogle: true,
  translateModel: "",
  translateNoThink: true,
  aiProviders: [],
  activeProviderId: "",
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  conversationPinned: false,
  commandOrder: [],
  disabledCommands: [],
};
/** currently edited provider id in settings UI */
let editingProviderId = "";
/** classic | cards — launcher skin */
let homeUi = "classic";
/** @type {{id:string,kind:string,status:string,title:string,detail?:string,url?:string}[]} */
let toolRows = [];
/** settings left nav panel */
let settingsPanel = "general";
let commandSettingsBusy = false;
let commandSettingsError = "";
let settingsSub = "overview"; // overview | providers
let providerSessionBackup = null;
const newProviderIds = new Set();
/** last fetched remote model ids (not yet all added) */
let lastFetchedModels = [];
let hotkeyCapturing = false;
let hotkeyFeedbackTimer = 0;
let settingsToastTimer = 0;

/** @type {{role:string, content:string, attachments?:any[]}[]} */
let chatHistory = [];
let aiBusy = false;
let aiStopping = false;
let streamingAssistant = "";
let streamRenderFrame = 0;
let conversations = [];
let currentConversationId = null;
let viewerMarkdown = "";

// 功能10：修复系统提示音 — 拦截失焦输入，重定向到正确输入框
setupBeepFix(() => ({ page, viewerOpen, conversationModeOpen }));

function subseq(hay, needle) {
  if (!hay || !needle) return false;
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i >= needle.length) return true;
  }
  return false;
}

function isClutter(app) {
  return !!(app && app.clutter);
}

function visibleApps() {
  return apps.filter((a) => !isClutter(a));
}

function launcherGridColumnCount() {
  const width = Math.max(0, (els.pageMain?.clientWidth || window.innerWidth) - 28);
  const minimum = Math.min(88, Math.max(1, (width - 16) / 5));
  return Math.max(5, Math.floor((width + 4) / (minimum + 4)));
}

function visibleRecent() {
  const list = recent.filter((a) => !isClutter(a));
  return list.slice(0, launcherGridColumnCount() * 2);
}

/** Slash command mode: fixed visual prefix /ai|/fy; input holds body only */
function isCommandMode() {
  return mode === "command" || !!cmdMode || chatHistory.length > 0 || aiBusy;
}

/**
 * Parse leading slash command.
 * "/ai hello" | "/ ai hello" | "/fy" | legacy "ai: hello"
 * @returns {{ kind:'mode'|'disabled', def:object, body:string } | { kind:'menu', filter:string } | { kind:'unknown', token:string, body:string } | null}
 */
function parseSlashInput(raw) {
  const s = String(raw || "");
  // legacy ai:
  const legacy = s.match(/^\s*ai\s*:\s*(.*)$/is);
  if (legacy) {
    const def = resolveSlashMode("ai");
    if (!def) return null;
    return {
      kind: isCommandEnabled(def.id) ? "mode" : "disabled",
      def,
      body: legacy[1] ?? "",
    };
  }
  // "/ai hello" or "/ai" (exact known mode)
  const m = s.match(/^\s*\/\s*([a-zA-Z]+)(?:\s+|$)([\s\S]*)$/);
  if (m) {
    const token = m[1].toLowerCase();
    const body = m[2] ?? "";
    const def = resolveSlashMode(token);
    if (def) {
      return {
        kind: isCommandEnabled(def.id) ? "mode" : "disabled",
        def,
        body,
      };
    }
    // unknown token but still typing → menu filter
    if (!String(body).trim()) {
      return { kind: "menu", filter: token };
    }
    return { kind: "unknown", token, body };
  }
  // bare "/" → menu
  if (/^\s*\/\s*$/.test(s)) {
    return { kind: "menu", filter: "" };
  }
  return null;
}

function getCommandBody() {
  if (conversationModeOpen) {
    return String(els.conversationInput?.value || "");
  }
  if (els.modePrefix && !els.modePrefix.classList.contains("hidden")) {
    return String(els.q?.value || "");
  }
  const p = parseSlashInput(els.q?.value || "");
  if (p && p.kind === "mode") return p.body;
  return "";
}

function hideSlashMenu() {
  els.slashMenu?.classList.add("hidden");
  if (els.slashMenu) els.slashMenu.innerHTML = "";
}

function showSlashMenu(filter = "") {
  if (!els.slashMenu) return;
  const f = String(filter || "").toLowerCase();
  const items = commandRegistry.list(commandPreferences()).filter(
    (m) => !f || m.id.startsWith(f) || m.aliases.some((a) => a.startsWith(f)) || m.title.includes(f)
  );
  if (!items.length) {
    hideSlashMenu();
    return;
  }
  els.slashMenu.innerHTML = "";
  els.slashMenu.classList.remove("hidden");
  items.forEach((m, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slash-item" + (i === 0 ? " active" : "");
    btn.innerHTML = `<span class="slash-cmd">${escapeHtml(m.label)}</span><span class="slash-title">${escapeHtml(m.title)}</span>`;
    btn.addEventListener("click", () => {
      enterCommandMode(m.id, { clearBody: true, keepHistory: false });
    });
    els.slashMenu.appendChild(btn);
  });
}

function enterCommandMode(modeId, opts = {}) {
  const def = commandRegistry.get(modeId) || resolveSlashMode(modeId);
  if (!def || !isCommandEnabled(def.id)) return false;

  // 功能1：/config → 打开设置页（通用面板）
  if (def.resultKind === "settings") {
    hideSlashMenu();
    settingsPanel = "general";
    enterSettingsPage();
    return true;
  }
  // 功能1：/model → 打开 AI 设置面板（模型选择）
  if (def.resultKind === "model") {
    hideSlashMenu();
    settingsPanel = "ai";
    enterSettingsPage();
    return true;
  }

  const shouldResize = mode !== "command";
  const { clearBody = true, keepHistory = false } = opts;
  // switching mode resets chat unless keepHistory
  if (!keepHistory || cmdMode !== def.id) {
    if (!keepHistory) resetChat();
  }
  cmdMode = def.id;
  mode = "command";
  hideSlashMenu();
  els.modePrefix?.classList.remove("hidden");
  if (els.modePrefix) {
    els.modePrefix.textContent = def.displayPrefix || def.label;
    els.modePrefix.classList.toggle("is-translate", def.resultKind === "translate");
    els.modePrefix.classList.toggle("is-ai", def.id === "ai");
  }
  if (els.q) {
    if (clearBody) els.q.value = "";
    else {
      const p = parseSlashInput(els.q.value);
      if (p && p.kind === "mode") els.q.value = p.body;
    }
    els.q.placeholder = def.placeholder || "Enter 发送 · Esc 返回";
    els.q.focus();
  }
  if (els.aiStatus) els.aiStatus.textContent = "";
  const st = document.querySelector("#ai-section .section-title > span:first-child");
  if (st) st.textContent = def.title;
  render();
  if (shouldResize) scheduleFit();
  return true;
}

/** @deprecated use enterCommandMode('ai') */
function enterAiInputMode(opts = {}) {
  enterCommandMode("ai", opts);
}

function exitCommandMode() {
  const shouldResize = mode === "command" || !!cmdMode;
  hideSlashMenu();
  els.modePrefix?.classList.add("hidden");
  if (els.modePrefix) {
    els.modePrefix.textContent = "AI:";
    els.modePrefix.classList.remove("is-translate", "is-ai");
  }
  if (els.q) {
    els.q.value = "";
    els.q.placeholder = "搜索应用…  输入 / 选择模式";
  }
  resetChat();
  cmdMode = null;
  mode = "browse";
  updateQuickWebButton();
  const st = document.querySelector("#ai-section .section-title > span:first-child");
  if (st) st.textContent = "AI 对话";
  if (shouldResize) scheduleFit();
}

function exitAiInputMode() {
  exitCommandMode();
}

function score(query, app) {
  const qRaw = query.toLowerCase().trim();
  if (!qRaw) return 0;
  const q = qRaw.replace(/\s+/g, "");
  const qWords = qRaw.split(/\s+/).filter(Boolean);
  const n = (app.name || "").toLowerCase();
  const py = (app.py || "").toLowerCase();
  const ini = (app.pyInitials || "").toLowerCase();
  const pyWords = (app.pyWords || "").toLowerCase();

  if (n.startsWith(qRaw) || n.startsWith(q)) return 1000 - n.length;
  const idx = n.indexOf(qRaw);
  if (idx >= 0) return 500 - idx - Math.floor(n.length / 10);

  if (ini) {
    if (ini.startsWith(q)) return 920 - ini.length;
    if (ini.includes(q)) return 820 - ini.indexOf(q);
    if (subseq(ini, q) && q.length >= 2) return 720 - ini.length;
  }

  if (py) {
    if (py.startsWith(q)) return 900 - Math.min(py.length, 80);
    if (py.includes(q)) return 780 - py.indexOf(q);
    if (subseq(py, q) && q.length >= 3) return 640 - Math.min(py.length, 80);
  }

  if (pyWords && qWords.length) {
    if (qWords.every((t) => pyWords.includes(t) || py.includes(t) || n.includes(t))) {
      return 760 - pyWords.length;
    }
  }

  if (qWords.length > 1 && qWords.every((t) => n.includes(t))) return 400 - n.length;
  if (subseq(n, q) && q.length >= 2) return 100 - n.length;
  return null;
}

function iconEl(app) {
  if (app.icon) {
    const img = document.createElement("img");
    img.className = "icon";
    img.src = app.icon;
    img.alt = "";
    img.draggable = false;
    img.onload = () => iconRetryCounts.delete(app.target);
    img.onerror = () => {
      app.icon = "";
      requestedIconTargets.delete(app.target);
      const fallback = fallbackIcon(app.name);
      if (app.target) fallback.dataset.iconTarget = app.target;
      img.replaceWith(fallback);
      const retries = iconRetryCounts.get(app.target) || 0;
      if (app.target && retries < 2) {
        iconRetryCounts.set(app.target, retries + 1);
        queueIconTarget(app.target);
      }
    };
    return img;
  }
  const fallback = fallbackIcon(app.name);
  if (app.target) fallback.dataset.iconTarget = app.target;
  return fallback;
}

function fallbackIcon(name) {
  const d = document.createElement("div");
  d.className = "icon fallback";
  d.textContent = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return d;
}

function observeLazyIcons() {
  iconObserver.disconnect();
  document.querySelectorAll("[data-icon-target]").forEach((node) => iconObserver.observe(node));
}

function queueIconTarget(target) {
  if (!target || requestedIconTargets.has(target)) return;
  pendingIconTargets.add(target);
  if (iconBatchTimer) return;
  iconBatchTimer = window.setTimeout(flushIconBatch, 24);
}

async function flushIconBatch() {
  iconBatchTimer = 0;
  const targets = [...pendingIconTargets].slice(0, 64);
  targets.forEach((target) => {
    pendingIconTargets.delete(target);
    requestedIconTargets.add(target);
  });
  if (!targets.length) return;
  try {
    const loaded = await api.getAppIcons(targets);
    if (loaded && typeof loaded === "object") {
      for (const item of [...apps, ...recent]) {
        if (loaded[item.target]) item.icon = loaded[item.target];
      }
      render();
    }
  } catch (error) {
    targets.forEach((target) => requestedIconTargets.delete(target));
    console.warn("lazy icons", error);
  }
  if (pendingIconTargets.size) {
    iconBatchTimer = window.setTimeout(flushIconBatch, 24);
  }
}

function mergeIndexedData(nextApps, nextRecent) {
  const savedIcons = new Map(
    [...apps, ...recent]
      .filter((item) => item?.target && item?.icon)
      .map((item) => [item.target, item.icon]),
  );
  apps = (nextApps || []).map((item) => ({
    ...item,
    icon: item.icon || savedIcons.get(item.target) || "",
  }));
  recent = (nextRecent || []).map((item) => ({
    ...item,
    icon: item.icon || savedIcons.get(item.target) || "",
  }));
}

async function persistRecentOrder() {
  const targets = [...els.recent.querySelectorAll(".recent-card[data-target]")]
    .map((card) => card.dataset.target)
    .filter(Boolean);
  if (!targets.length) return;
  const byTarget = new Map(recent.map((item) => [item.target, item]));
  const ordered = targets.map((target) => byTarget.get(target)).filter(Boolean);
  const seen = new Set(targets);
  recent = [...ordered, ...recent.filter((item) => !seen.has(item.target))];
  try {
    const saved = await api.reorderRecent(targets);
    if (Array.isArray(saved)) mergeIndexedData(apps, saved);
  } catch (error) {
    console.warn("reorder recent", error);
  }
  render();
}

function setupRecentDrag() {
  if (!els.recent) return;
  let pointerId = null;
  let dragging = null;
  let startX = 0;
  let startY = 0;
  let moved = false;

  const finish = async (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    try {
      dragging?.releasePointerCapture(pointerId);
    } catch {}
    dragging?.classList.remove("is-dragging");
    pointerId = null;
    dragging = null;
    suppressRecentClick = moved;
    if (moved) await persistRecentOrder();
    moved = false;
    window.setTimeout(() => {
      suppressRecentClick = false;
    }, 0);
  };

  els.recent.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    const card = event.target.closest(".recent-card[data-target]");
    if (!card) return;
    pointerId = event.pointerId;
    dragging = card;
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    card.setPointerCapture(pointerId);
  });

  els.recent.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId || !dragging) return;
    if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
    event.preventDefault();
    if (!moved) dragging.classList.add("is-dragging");
    moved = true;

    const bounds = els.recent.getBoundingClientRect();
    if (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    ) return;
    const candidates = [...els.recent.querySelectorAll(".recent-card[data-target]")]
      .filter((card) => card !== dragging);
    const target = candidates.reduce((closest, card) => {
      const box = card.getBoundingClientRect();
      const distance = (event.clientX - (box.left + box.width / 2)) ** 2 +
        (event.clientY - (box.top + box.height / 2)) ** 2;
      return !closest || distance < closest.distance ? { card, distance } : closest;
    }, null)?.card;
    if (!target) return;
    const box = target.getBoundingClientRect();
    const sameRow = event.clientY >= box.top && event.clientY <= box.bottom;
    const after = sameRow
      ? event.clientX > box.left + box.width / 2
      : event.clientY > box.top + box.height / 2;
    els.recent.insertBefore(dragging, after ? target.nextSibling : target);
  });
  els.recent.addEventListener("pointerup", finish);
  els.recent.addEventListener("pointercancel", finish);
}

function closeRecentContextMenu() {
  recentContextTarget = "";
  els.recentContextMenu?.classList.add("hidden");
}

function openRecentContextMenu(event, app) {
  if (!els.recentContextMenu || !app?.target) return;
  event.preventDefault();
  event.stopPropagation();
  recentContextTarget = app.target;
  els.recentContextMenu.classList.remove("hidden");
  const shellRect = document.querySelector(".shell")?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const menuRect = els.recentContextMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX - shellRect.left, shellRect.width - menuRect.width - 8));
  const top = Math.max(8, Math.min(event.clientY - shellRect.top, shellRect.height - menuRect.height - 8));
  els.recentContextMenu.style.left = `${left}px`;
  els.recentContextMenu.style.top = `${top}px`;
  requestAnimationFrame(() => els.btnRemoveRecent?.focus());
}

async function removeRecentTarget() {
  const target = recentContextTarget;
  if (!target) return;
  closeRecentContextMenu();
  try {
    const saved = await api.removeRecent(target);
    if (Array.isArray(saved)) mergeIndexedData(apps, saved);
    else recent = recent.filter((item) => item.target !== target);
    active = 0;
    render();
    scheduleFit();
  } catch (error) {
    console.warn("remove recent", error);
  }
}

function setupLauncherResizeRendering() {
  window.addEventListener("resize", () => {
    if (window.innerWidth === launcherViewportWidth) return;
    launcherViewportWidth = window.innerWidth;
    if (launcherResizeFrame) cancelAnimationFrame(launcherResizeFrame);
    launcherResizeFrame = requestAnimationFrame(() => {
      launcherResizeFrame = 0;
      if (page === "main" && mode === "browse") render();
    });
  });
}

function visibleItems() {
  if (mode === "command" || cmdMode) return [];
  const rec = mode === "browse" ? visibleRecent() : [];
  const items = [];
  for (const app of rec) items.push({ zone: "recent", app });
  for (const app of filtered) items.push({ zone: "list", app });
  return items;
}

function updateConversationJumpBottom() {
  if (!els.conversationJumpBottom || !els.aiThread) return;
  const distance = els.aiThread.scrollHeight - els.aiThread.scrollTop - els.aiThread.clientHeight;
  els.conversationJumpBottom.hidden = !conversationModeOpen || distance < 90;
}

const chatRenderer = createChatRenderer({
  els,
  getState: () => ({ aiBusy, aiStopping, chatHistory, conversationModeOpen, streamingAssistant, toolRows }),
  getStreamRenderFrame: () => streamRenderFrame,
  setStreamRenderFrame: (value) => { streamRenderFrame = value; },
  currentModeDef,
  openViewer,
  updateConversationJumpBottom,
  renderMarkdown,
  enhanceCodeBlocks,
  escapeHtml,
});
const { renderThread, scheduleStreamingRender, updateAiStopControls, upsertToolRow } = chatRenderer;

function render() {
  const q = els.q.value;
  const fixedCmd = els.modePrefix && !els.modePrefix.classList.contains("hidden");
  const parsed = parseSlashInput(q);

  // typing / shows mode menu; /ai body enters command mode
  if (!fixedCmd && parsed) {
    if (parsed.kind === "menu") {
      showSlashMenu(parsed.filter);
      mode = q.trim() ? "search" : "browse"; // still allow empty browse under
      // don't treat as app search while composing slash
      document.body.classList.toggle("ai-open", false);
      // short-circuit list rendering for slash compose
      const showRecent = !q.trim() || q.trim() === "/";
      els.recentSection?.classList.toggle("hidden", true);
      els.builtinSection?.classList.toggle("hidden", true);
      els.listSection?.classList.toggle("hidden", true);
      els.idleHint?.classList.toggle("hidden", true);
      els.aiSection?.classList.toggle("hidden", true);
      commandHost.activate(null);
      return;
    }
    if (parsed.kind === "mode") {
      hideSlashMenu();
      enterCommandMode(parsed.def.id, { clearBody: false, keepHistory: false });
      if (els.q) {
        els.q.value = parsed.body;
        els.q.placeholder = parsed.def.placeholder;
      }
      // fall through after enterCommandMode called render — avoid double
      return;
    }
    if (parsed.kind === "unknown" || parsed.kind === "disabled") {
      hideSlashMenu();
    }
  } else {
    hideSlashMenu();
  }

  const inCmd =
    fixedCmd ||
    !!cmdMode ||
    chatHistory.length > 0 ||
    aiBusy;

  if (inCmd && cmdMode) {
    mode = "command";
  } else if (q.trim()) {
    mode = "search";
    cmdMode = null;
  } else {
    mode = "browse";
    cmdMode = null;
  }
  updateQuickWebButton();
  document.body.classList.toggle("ai-open", mode === "command" && page === "main");

  const pool = visibleApps();
  if (mode === "search") {
    const scored = [];
    for (const app of pool) {
      const s = score(q, app);
      if (s != null) scored.push([s, app]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, "zh"));
    filtered = scored.slice(0, 60).map((x) => x[1]);
    if (els.listTitle) els.listTitle.textContent = "搜索结果";
  } else {
    filtered = [];
  }

  const rec = mode === "browse" ? visibleRecent() : [];
  const def = currentModeDef();
  const showRecent = mode === "browse" && rec.length > 0;
  const showBuiltin = mode === "browse" && ["ai", "fy", "file"].some(isCommandEnabled);
  const showList = mode === "search";
  const showCustom = mode === "command" && def?.surface === "custom";
  const showAi = mode === "command" && !showCustom;
  updateAiOnlyControls(showAi ? def : null);

  els.recentSection?.classList.toggle("hidden", !showRecent);
  els.builtinSection?.classList.toggle("hidden", !showBuiltin);
  els.btnBuiltinAi?.classList.toggle("hidden", !isCommandEnabled("ai"));
  els.btnBuiltinFy?.classList.toggle("hidden", !isCommandEnabled("fy"));
  els.btnBuiltinFile?.classList.toggle("hidden", !isCommandEnabled("file"));
  els.listSection?.classList.toggle("hidden", !showList);
  els.idleHint?.classList.toggle("hidden", true);
  els.aiSection?.classList.toggle("hidden", !showAi);
  const commandController = commandHost.activate(def);
  if (showCustom) commandController?.render?.();

  if (els.q) {
    if ((showAi || showCustom) && def) {
      els.modePrefix?.classList.remove("hidden");
      if (els.modePrefix) {
        els.modePrefix.textContent = def.displayPrefix || def.label;
        els.modePrefix.classList.toggle("is-translate", def.resultKind === "translate");
        els.modePrefix.classList.toggle("is-ai", def.id === "ai");
      }
      if (!els.q.value) els.q.placeholder = def.placeholder;
    } else if (!showAi) {
      els.q.placeholder = "搜索应用…  输入 / 选择模式";
      els.modePrefix?.classList.add("hidden");
      els.modePrefix?.classList.remove("is-translate", "is-ai");
    }
  }

  if (els.recentCount) {
    els.recentCount.textContent = String(recent.filter((app) => !isClutter(app)).length);
  }
  if (els.recent) {
    els.recent.innerHTML = "";
    if (showRecent) {
      rec.forEach((app, i) => {
        const card = document.createElement("div");
        card.className = "recent-card";
        card.dataset.index = String(i);
        card.dataset.target = app.target;
        card.draggable = false;
        card.title = `${app.name} · 拖拽排序 · 右键移除`;
        card.appendChild(iconEl(app));
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = app.name;
        card.appendChild(name);
        card.addEventListener("mouseenter", () => {
          active = i;
          paintActive();
        });
        card.addEventListener("click", () => {
          if (!suppressRecentClick) launch(app);
        });
        card.addEventListener("contextmenu", (event) => openRecentContextMenu(event, app));
        els.recent.appendChild(card);
      });
    }
  }

  if (els.listCount) els.listCount.textContent = String(filtered.length);
  if (els.list) {
    els.list.innerHTML = "";
    if (showList) {
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "没有匹配的应用";
        els.list.appendChild(empty);
      } else {
        filtered.forEach((app, i) => {
          const row = document.createElement("div");
          row.className = "row no-sub";
          row.dataset.index = String(i);
          row.appendChild(iconEl(app));
          const meta = document.createElement("div");
          meta.className = "meta";
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = app.name;
          meta.appendChild(name);
          row.appendChild(meta);
          const badge = document.createElement("div");
          badge.className = "badge";
          badge.textContent = "Enter";
          row.appendChild(badge);
          row.addEventListener("mouseenter", () => {
            active = i;
            paintActive();
          });
          row.addEventListener("click", () => launch(app));
          els.list.appendChild(row);
        });
      }
    }
  }

  if (showAi) {
    renderThread({ streaming: aiBusy });
  }

  const items = visibleItems();
  if (active >= items.length) active = Math.max(0, items.length - 1);
  paintActive();
  requestAnimationFrame(observeLazyIcons);
}

let fitTimer = 0;
let fitEpoch = 0;
let windowResizePromise = Promise.resolve();
const launcherWindowSize = { width: 720, height: 420 };

function launcherContentHeight() {
  const shellRect = document.querySelector(".shell")?.getBoundingClientRect();
  if (!shellRect) return launcherWindowSize.height;
  const sections = [els.recentSection, els.builtinSection].filter(
    (section) => section && !section.classList.contains("hidden"),
  );
  const last = sections.at(-1) || document.querySelector(".search-bar");
  if (!last) return launcherWindowSize.height;
  return Math.max(300, Math.ceil(last.getBoundingClientRect().bottom - shellRect.top + 24));
}

function cancelScheduledFit() {
  fitEpoch += 1;
  if (fitTimer) cancelAnimationFrame(fitTimer);
  fitTimer = 0;
}

function queueWindowResize(width, height) {
  windowResizePromise = windowResizePromise
    .catch(() => {})
    .then(() => api.resize?.(width, height));
  return windowResizePromise;
}

function scheduleFit() {
  const epoch = ++fitEpoch;
  if (fitTimer) cancelAnimationFrame(fitTimer);
  fitTimer = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitTimer = 0;
      if (epoch === fitEpoch) fitWindow(epoch);
    });
  });
}

async function fitWindow(epoch) {
  if (!api.resize) return;
  if (epoch !== fitEpoch) return;
  if (viewerOpen || conversationModeOpen) return;
  if (page === "settings") return;
  const shell = document.querySelector(".shell");
  if (!shell) return;
  // command mode: fixed tall window so thread scrolls and actions stay at bottom
  if (mode === "command" || document.body.classList.contains("ai-open")) {
    try {
      if (epoch === fitEpoch) await queueWindowResize(720, 560);
    } catch (e) {
      console.warn("resize", e);
    }
    return;
  }
  try {
    if (epoch === fitEpoch) {
      await queueWindowResize(launcherWindowSize.width, launcherContentHeight());
    }
  } catch (e) {
    console.warn("resize", e);
  }
}

function latestAssistantText() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].role === "assistant" && chatHistory[i].content) {
      return chatHistory[i].content;
    }
  }
  return streamingAssistant || "";
}

async function openViewer(content = "") {
  const md = String(content || latestAssistantText());
  if (!md.trim()) return;
  viewerMarkdown = md;
  viewerOpen = true;
  cancelScheduledFit();
  page = "viewer";
  document.documentElement.classList.add("shell-viewer");
  document.body.classList.add("shell-viewer");
  document.body.classList.remove("ai-open");
  els.pageMain?.classList.add("hidden");
  els.pageSettings?.classList.add("hidden");
  els.pageViewer?.classList.remove("hidden");
  if (els.viewerBody) {
    els.viewerBody.innerHTML = renderMarkdown(md);
    enhanceCodeBlocks(els.viewerBody);
  }
  if (els.viewerScroll) els.viewerScroll.scrollTop = 0;
  // in-app only: keep current window chrome (−□×). enlarge if still small.
  if (homeUi === "cards") {
    viewerWindowPromise = Promise.resolve(api.enterCardsMode?.());
  } else {
    viewerWindowPromise = windowResizePromise
      .catch(() => {})
      .then(() => api.enterViewerMode?.());
  }
  try {
    await viewerWindowPromise;
  } catch (e) {
    console.warn("enterViewerMode", e);
  }
  requestAnimationFrame(() => {
    if (els.viewerScroll) {
      els.viewerScroll.style.overflowY = "auto";
      els.viewerScroll.scrollTop = 0;
    }
  });
}

async function closeViewer() {
  if (!viewerOpen) return;
  viewerOpen = false;
  document.documentElement.classList.remove("shell-viewer");
  document.body.classList.remove("shell-viewer");
  els.pageViewer?.classList.add("hidden");
  page = "main";
  els.pageMain?.classList.remove("hidden");
  els.pageSettings?.classList.add("hidden");
  await viewerWindowPromise.catch(() => {});
  if (homeUi === "cards") {
    try {
      await api.enterCardsMode();
    } catch {}
  } else {
    try {
      await api.leaveViewerMode();
    } catch (e) {
      console.warn("leaveViewerMode", e);
    }
  }
  setTimeout(() => {
    document.body.classList.toggle("ai-open", mode === "command");
    render();
    els.q?.focus();
  }, 40);
}

async function copyViewerAll() {
  const text = viewerMarkdown || latestAssistantText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (els.btnViewerCopy) {
      const old = els.btnViewerCopy.textContent;
      els.btnViewerCopy.textContent = "已复制";
      setTimeout(() => {
        if (els.btnViewerCopy) els.btnViewerCopy.textContent = old || "复制";
      }, 1200);
    }
  } catch {}
}

function paintActive() {
  document.querySelectorAll(".recent-card, .row").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.index) === active);
  });
  const cur = document.querySelector(`.recent-card.active, .row.active`);
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

async function launch(app) {
  if (!app) return;
  try {
    const res = await api.launch(app);
    if (res?.recent) mergeIndexedData(apps, res.recent);
  } catch (e) {
    console.warn("launch", e);
  }
}

function launchActive() {
  const items = visibleItems();
  if (!items.length) return;
  launch(items[active].app);
}

function applyTheme(name) {
  const t = ["white", "transparent", "black", "gradient"].includes(name) ? name : "white";
  theme = t;
  settingsSnap.theme = t;
  document.body.classList.remove("theme-white", "theme-transparent", "theme-black", "theme-gradient");
  document.body.classList.add(`theme-${t}`);
  document.querySelectorAll(".theme-card").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-theme") === t);
  });
}

function ensureProviders() {
  if (!Array.isArray(settingsSnap.aiProviders) || !settingsSnap.aiProviders.length) {
    const id = `p${Date.now().toString(16)}`;
    settingsSnap.aiProviders = [
      {
        id,
        name: "默认",
        format: "openai_compatible",
        baseUrl: "",
        apiKey: "",
        headers: {},
        models: ["gpt-4o-mini"],
        selectedModel: "gpt-4o-mini",
        requestBody: {},
        extraOptions: {},
        modelConfigs: {},
      },
    ];
    settingsSnap.activeProviderId = id;
  }
  for (const provider of settingsSnap.aiProviders) normalizeProviderConfig(provider);
  if (
    !settingsSnap.activeProviderId ||
    !settingsSnap.aiProviders.some((p) => p.id === settingsSnap.activeProviderId)
  ) {
    settingsSnap.activeProviderId = settingsSnap.aiProviders[0].id;
  }
  if (
    !editingProviderId ||
    !settingsSnap.aiProviders.some((p) => p.id === editingProviderId)
  ) {
    editingProviderId = settingsSnap.activeProviderId;
  }
}

function getEditingProvider() {
  ensureProviders();
  return (
    settingsSnap.aiProviders.find((p) => p.id === editingProviderId) ||
    settingsSnap.aiProviders[0]
  );
}

function fillModelSelect(provider) {
  // keep hidden <select> in sync for legacy paths
  if (els.pvModel) {
    const models = Array.isArray(provider.models) ? provider.models.slice() : [];
    const sel = provider.selectedModel || models[0] || "";
    if (sel && !models.includes(sel)) models.unshift(sel);
    els.pvModel.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = modelLabelOf(provider, m);
      if (m === sel) opt.selected = true;
      els.pvModel.appendChild(opt);
    }
  }
  renderModelList(provider);
  updateUseProviderBtn();
}

function renderModelList(provider) {
  if (!els.modelList || !provider) return;
  const models = Array.isArray(provider.models) ? provider.models.slice() : [];
  const sel = provider.selectedModel || models[0] || "";
  if (!provider.modelLabels) provider.modelLabels = {};
  normalizeProviderConfig(provider);
  els.modelList.innerHTML = "";
  for (const id of models) {
    const item = document.createElement("div");
    item.className = "model-config-item";
    const row = document.createElement("div");
    row.className = "model-row" + (id === sel ? " active" : "");
    row.title = "点击选用此模型";
    const idEl = document.createElement("div");
    idEl.className = "m-id";
    const savedLab = provider.modelLabels[id];
    idEl.textContent = (savedLab && savedLab.trim()) ? savedLab : id;
    idEl.title = id;
    const lab = document.createElement("input");
    lab.className = "m-label-input";
    lab.type = "text";
    lab.placeholder = "显示名";
    lab.value = provider.modelLabels[id] || "";
    lab.spellcheck = false;
    lab.addEventListener("click", (e) => e.stopPropagation());
    lab.addEventListener("change", () => {
      const v = lab.value.trim();
      if (!provider.modelLabels) provider.modelLabels = {};
      if (v) provider.modelLabels[id] = v;
      else delete provider.modelLabels[id];
      if (provider.modelConfigs?.[id]) provider.modelConfigs[id].label = v;
      if (els.aiSaveMsg) els.aiSaveMsg.textContent = "映射已改，请点「保存配置」";
    });
    lab.addEventListener("input", () => {
      const v = lab.value.trim();
      if (!provider.modelLabels) provider.modelLabels = {};
      if (v) provider.modelLabels[id] = v;
      else delete provider.modelLabels[id];
      if (provider.modelConfigs?.[id]) provider.modelConfigs[id].label = v;
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "m-del";
    del.title = "移除模型";
    del.textContent = "×";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      provider.models = (provider.models || []).filter((m) => m !== id);
      if (provider.modelLabels) delete provider.modelLabels[id];
      if (provider.modelConfigs) delete provider.modelConfigs[id];
      if (provider.selectedModel === id) {
        provider.selectedModel = provider.models[0] || "";
      }
      fillModelSelect(provider);
      if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已移除（未保存，请点「保存配置」）";
    });
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "m-expand";
    expand.title = "模型高级设置";
    expand.setAttribute("aria-label", "模型高级设置");
    expand.setAttribute("aria-expanded", "false");
    expand.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
    const advanced = document.createElement("div");
    advanced.className = "model-config-advanced";
    const config = provider.modelConfigs[id];
    advanced.innerHTML = `
      <label><span>上下文长度</span><input type="number" min="1" class="m-context" placeholder="可选"></label>
      <label><span>最大输出</span><input type="number" min="1" class="m-output" placeholder="可选"></label>
      <label><span>默认思考强度</span><select class="m-effort"></select></label>
      <label class="m-request-field"><span>模型请求体</span><textarea class="m-request" rows="4" spellcheck="false" placeholder='{"temperature": 0.2}'></textarea></label>`;
    const contextInput = advanced.querySelector(".m-context");
    const outputInput = advanced.querySelector(".m-output");
    const effortSelect = advanced.querySelector(".m-effort");
    const requestInput = advanced.querySelector(".m-request");
    contextInput.value = config.contextWindow || "";
    outputInput.value = config.maxOutputTokens || "";
    for (const effort of config.efforts) {
      const option = document.createElement("option");
      option.value = effort.id;
      option.textContent = effort.label || effort.id;
      option.selected = effort.id === config.defaultEffort;
      effortSelect.appendChild(option);
    }
    requestInput.value = prettyJson(config.requestBody);
    contextInput.addEventListener("input", () => { config.contextWindow = Number(contextInput.value) || null; });
    outputInput.addEventListener("input", () => { config.maxOutputTokens = Number(outputInput.value) || null; });
    effortSelect.addEventListener("change", () => { config.defaultEffort = effortSelect.value || "medium"; });
    requestInput.addEventListener("change", () => {
      try {
        config.requestBody = parseJsonObject(requestInput.value, "模型请求体");
        requestInput.value = prettyJson(config.requestBody);
      } catch (error) {
        if (els.aiSaveMsg) els.aiSaveMsg.textContent = error.message;
      }
    });
    advanced.addEventListener("click", (event) => event.stopPropagation());
    expand.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = !item.classList.contains("is-expanded");
      item.classList.toggle("is-expanded", open);
      expand.setAttribute("aria-expanded", String(open));
    });
    row.addEventListener("click", () => {
      if (provider.selectedModel === id) return;
      provider.selectedModel = id;
      if (els.pvModel) els.pvModel.value = id;
      fillModelSelect(provider);
      if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已选用（未保存，请点「保存配置」）";
    });
    row.appendChild(idEl);
    row.appendChild(lab);
    row.appendChild(expand);
    row.appendChild(del);
    item.append(row, advanced);
    els.modelList.appendChild(item);
  }
}

function updateUseProviderBtn() {
  const p = getEditingProvider();
  if (!els.btnSetActiveProvider || !p) return;
  const isCur = p.id === settingsSnap.activeProviderId;
  els.btnSetActiveProvider.textContent = isCur ? "当前使用中" : "使用此供应商";
  els.btnSetActiveProvider.classList.toggle("is-current", isCur);
  els.btnSetActiveProvider.disabled = isCur;
}

function snapshotProviderState() {
  return JSON.parse(
    JSON.stringify({
      aiProviders: settingsSnap.aiProviders,
      activeProviderId: settingsSnap.activeProviderId,
      aiBaseUrl: settingsSnap.aiBaseUrl,
      aiApiKey: settingsSnap.aiApiKey,
      aiModel: settingsSnap.aiModel,
    }),
  );
}

function updateProviderDialog() {
  const isNew = newProviderIds.has(editingProviderId);
  if (els.providerDialogTitle) {
    els.providerDialogTitle.textContent = isNew ? "添加新供应商" : "管理 AI 供应商";
  }
  if (els.btnSaveAi) els.btnSaveAi.textContent = isNew ? "添加" : "保存";
  if (els.btnDelProvider) els.btnDelProvider.hidden = isNew;
}

function openProviderManager({ create = false } = {}) {
  ensureProviders();
  if (!providerSessionBackup) providerSessionBackup = snapshotProviderState();
  setProviderCancelConfirm(false);
  if (els.providerPanel) els.providerPanel.hidden = false;
  const settingsLayout = document.querySelector(".settings-layout");
  if (settingsLayout) {
    settingsLayout.inert = true;
    settingsLayout.setAttribute("aria-hidden", "true");
  }
  settingsSub = "providers";
  if (create) addProvider();
  else {
    editingProviderId = settingsSnap.activeProviderId || settingsSnap.aiProviders[0]?.id || "";
    fillSettingsForm();
    updateProviderDialog();
  }
  // 功能5：检测并渲染本地 LLM 预设
  detectLocalServices().then(() => {
    if (els.localLlmList) {
      renderLocalPresets(els.localLlmList, (id) => {
        const provider = createProviderFromPreset(id);
        if (provider) {
          settingsSnap.aiProviders.push(provider);
          editingProviderId = provider.id;
          fillSettingsForm();
          updateProviderDialog();
        }
      });
    }
  });
  requestAnimationFrame(() => els.pvName?.focus());
}

function closeProviderManager({ discard = true } = {}) {
  if (discard && providerSessionBackup) {
    settingsSnap.aiProviders = providerSessionBackup.aiProviders;
    settingsSnap.activeProviderId = providerSessionBackup.activeProviderId;
    settingsSnap.aiBaseUrl = providerSessionBackup.aiBaseUrl;
    settingsSnap.aiApiKey = providerSessionBackup.aiApiKey;
    settingsSnap.aiModel = providerSessionBackup.aiModel;
    editingProviderId = settingsSnap.activeProviderId;
  }
  providerSessionBackup = null;
  newProviderIds.clear();
  setProviderCancelConfirm(false);
  if (els.providerPanel) els.providerPanel.hidden = true;
  const settingsLayout = document.querySelector(".settings-layout");
  if (settingsLayout) {
    settingsLayout.inert = false;
    settingsLayout.removeAttribute("aria-hidden");
  }
  settingsSub = "overview";
  requestAnimationFrame(() => {
    fillSettingsForm();
    refreshAiOverview();
  });
}

function setProviderCancelConfirm(open) {
  const visible = !!open;
  if (els.providerCancelConfirm) els.providerCancelConfirm.hidden = !visible;
  if (visible) requestAnimationFrame(() => els.btnProviderConfirmCancel?.focus());
}

function requestCloseProviderManager() {
  if (!els.providerPanel || els.providerPanel.hidden) return;
  if (els.providerCancelConfirm && !els.providerCancelConfirm.hidden) {
    setProviderCancelConfirm(false);
    requestAnimationFrame(() => els.btnCancelProvider?.focus());
    return;
  }
  setProviderCancelConfirm(true);
}


function renderProviderList() {
  ensureProviders();
  if (!els.providerList) return;
  els.providerList.innerHTML = "";
  for (const p of settingsSnap.aiProviders) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "provider-chip";
    if (p.id === editingProviderId) row.classList.add("active");
    if (p.id === settingsSnap.activeProviderId) row.classList.add("current");
    row.innerHTML = `<span class="pc-name">${escapeHtml(p.name || "未命名")}</span>
      <span class="pc-meta">${escapeHtml(formatProviderFormat(p.format))}${
      p.id === settingsSnap.activeProviderId ? " · 使用中" : ""
    }</span>`;
    row.addEventListener("click", () => {
      commitEditorToSnap();
      editingProviderId = p.id;
      fillSettingsForm();
      updateProviderDialog();
    });
    row.addEventListener("dblclick", () => {
      commitEditorToSnap();
      settingsSnap.activeProviderId = p.id;
      editingProviderId = p.id;
      fillSettingsForm();
      if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已设为当前供应商，保存后生效";
    });
    els.providerList.appendChild(row);
  }
}

function fillSettingsForm() {
  ensureProviders();
  renderProviderList();
  if (els.hotkeyInput) els.hotkeyInput.value = settingsSnap.hotkey || "Alt+Q";
  if (els.appScanDepth) els.appScanDepth.value = String(normalizeAppScanDepth(settingsSnap.appScanDepth));
  renderAppScanPaths();
  const p = getEditingProvider();
  if (!p) return;
  if (els.pvName) els.pvName.value = p.name || "";
  if (els.pvFormat) els.pvFormat.value = p.format || "openai_compatible";
  if (els.pvBase) els.pvBase.value = p.baseUrl || "";
  if (els.pvKey) els.pvKey.value = p.apiKey || "";
  if (els.pvHeaders) els.pvHeaders.value = headersToText(p.headers);
  if (els.pvRequestBody) els.pvRequestBody.value = prettyJson(p.requestBody);
  if (els.pvExtraOptions) els.pvExtraOptions.value = prettyJson(p.extraOptions);
  fillModelSelect(p);
  updateProviderDialog();
  // refresh custom dropdowns after option changes
  if (window.CustomDropdown) requestAnimationFrame(() => window.CustomDropdown.mountAll());
}

function commitEditorToSnap() {
  ensureProviders();
  const p = getEditingProvider();
  if (!p) return;
  p.name = (els.pvName?.value || "").trim() || "未命名";
  p.format = els.pvFormat?.value || "openai_compatible";
  p.baseUrl = (els.pvBase?.value || "").trim();
  p.apiKey = (els.pvKey?.value || "").trim();
  p.headers = textToHeaders(els.pvHeaders?.value || "");
  p.requestBody = parseJsonObject(els.pvRequestBody?.value, "自定义请求体");
  p.extraOptions = parseJsonObject(els.pvExtraOptions?.value, "额外选项");
  // selected model from hidden select / list clicks (already on p)
  const model = (p.selectedModel || els.pvModel?.value || "").trim();
  if (model) {
    p.selectedModel = model;
    if (!Array.isArray(p.models)) p.models = [];
    if (!p.models.includes(model)) p.models.push(model);
  }
  // IMPORTANT: do NOT touch modelLabels from add-bar empty field (would wipe mappings)
  if (!p.modelLabels || typeof p.modelLabels !== "object") p.modelLabels = {};
  // sync labels currently shown in model-list inputs
  if (els.modelList) {
    els.modelList.querySelectorAll(".model-row").forEach((row) => {
      const idEl = row.querySelector(".m-id");
      const lab = row.querySelector(".m-label-input");
      if (!idEl || !lab) return;
      const id = (idEl.title || idEl.textContent).trim();
      const v = lab.value.trim();
      if (!id) return;
      if (v) p.modelLabels[id] = v;
      else delete p.modelLabels[id];
      if (p.modelConfigs?.[id]) p.modelConfigs[id].label = v;
    });
  }
  // mirror legacy
  const active =
    settingsSnap.aiProviders.find((x) => x.id === settingsSnap.activeProviderId) || p;
  settingsSnap.aiBaseUrl = active.baseUrl || "";
  settingsSnap.aiApiKey = active.apiKey || "";
  settingsSnap.aiModel = active.selectedModel || "";
}

function normalizeHomeUi(v) {
  if (v === "cards" || v === "studio") return "cards";
  return "classic";
}

function markHomeUiCards() {
  document.querySelectorAll("[data-home-ui]").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-home-ui") === homeUi);
  });
}

function applyHomeUi(name, { persist = false, preview = false } = {}) {
  const next = normalizeHomeUi(name);
  homeUi = next;
  settingsSnap.homeUi = next;
  document.documentElement.setAttribute("data-launcher-ui", next);
  document.body.setAttribute("data-launcher-ui", next);
  document.body.classList.remove("ui-cards", "ui-classic");
  document.body.classList.add(next === "cards" ? "ui-cards" : "ui-classic");
  markHomeUiCards();
  // appearance changes stay in settings — do NOT kick back to main
  if (preview && page === "settings") {
    // no-op: keep settings open
  } else if (page !== "settings") {
    render();
    if (next === "cards") {
      api.enterCardsMode?.().catch(() => {});
    } else {
      api.enterLauncherMode?.().catch(() => {});
    }
    scheduleFit();
  }
  if (persist) {
    api.setSettings(settingsPayload({ homeUi: next })).catch((e) => console.warn(e));
  }
}

function renderCommandSettings() {
  if (!els.commandSettingsList) return;
  const preferences = syncCommandPreferences();
  const commands = commandRegistry.listAll(preferences);
  els.commandSettingsList.innerHTML = "";

  const header = document.createElement("div");
  header.className = "command-settings-header";
  for (const label of ["功能", "命令", "启用", "排序"]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    header.appendChild(cell);
  }
  els.commandSettingsList.appendChild(header);

  commands.forEach((command, index) => {
    const row = document.createElement("div");
    row.className = "command-settings-row";

    const title = document.createElement("div");
    title.className = "command-settings-title";
    title.textContent = command.title;
    const slash = document.createElement("code");
    slash.className = "command-settings-slash";
    slash.textContent = command.label;

    const state = document.createElement("div");
    state.className = "command-settings-state";
    const enabled = document.createElement("label");
    enabled.className = "pill-switch";
    enabled.title = command.enabled ? "禁用命令" : "启用命令";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = command.enabled;
    checkbox.disabled = commandSettingsBusy;
    checkbox.setAttribute("aria-label", `${command.enabled ? "禁用" : "启用"}${command.title}`);
    const slider = document.createElement("span");
    slider.className = "slider";
    enabled.append(checkbox, slider);
    checkbox.addEventListener("change", () => {
      persistCommandPreferenceChange(() => {
        const normalized = syncCommandPreferences();
        const disabled = normalized.disabledCommands.filter(
          (id) => id.toLowerCase() !== command.id,
        );
        if (!checkbox.checked) disabled.push(command.id);
        settingsSnap.disabledCommands = disabled;
      });
    });
    state.appendChild(enabled);

    const move = document.createElement("div");
    move.className = "command-order-buttons";
    const makeMoveButton = (direction) => {
      const up = direction < 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-order-button";
      button.title = up ? "上移" : "下移";
      button.setAttribute("aria-label", `${command.title}${up ? "上移" : "下移"}`);
      button.disabled = commandSettingsBusy || (up ? index === 0 : index === commands.length - 1);
      button.innerHTML = up
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
      button.addEventListener("click", () => {
        persistCommandPreferenceChange(() => {
          const normalized = syncCommandPreferences();
          const other = commands[index + direction];
          if (!other) return;
          const order = normalized.commandOrder.slice();
          const first = order.findIndex((id) => id.toLowerCase() === command.id);
          const second = order.findIndex((id) => id.toLowerCase() === other.id);
          if (first < 0 || second < 0) return;
          [order[first], order[second]] = [order[second], order[first]];
          settingsSnap.commandOrder = order;
        });
      });
      return button;
    };
    move.append(makeMoveButton(-1), makeMoveButton(1));
    row.append(title, slash, state, move);
    els.commandSettingsList.appendChild(row);
  });

  if (els.commandSettingsError) {
    els.commandSettingsError.textContent = commandSettingsError;
    els.commandSettingsError.hidden = !commandSettingsError;
  }
}

function refreshCommandSurfaces() {
  renderConversations();
  if (els.aiMenuMode) els.aiMenuMode.disabled = !isCommandEnabled("ai");
  const parsed = parseSlashInput(els.q?.value || "");
  if (parsed?.kind === "menu" && !els.slashMenu?.classList.contains("hidden")) {
    showSlashMenu(parsed.filter);
  }
  if (page !== "settings") render();
}

async function persistCommandPreferenceChange(change) {
  if (commandSettingsBusy) return;
  const previous = commandPreferences();
  change();
  syncCommandPreferences();
  commandSettingsBusy = true;
  commandSettingsError = "";
  renderCommandSettings();
  refreshCommandSurfaces();
  try {
    const result = await api.setSettings(settingsPayload({
      commandOrder: settingsSnap.commandOrder,
      disabledCommands: settingsSnap.disabledCommands,
    }));
    if (result?.settings) applySettingsSnap(result.settings);
    if (conversationModeOpen && !isCommandEnabled("ai")) exitConversationMode();
    if (cmdMode && !isCommandEnabled(cmdMode)) {
      exitCommandMode();
    }
  } catch (error) {
    settingsSnap.commandOrder = previous.commandOrder;
    settingsSnap.disabledCommands = previous.disabledCommands;
    commandSettingsError = `保存失败：${error?.message || error}`;
    refreshCommandSurfaces();
  } finally {
    commandSettingsBusy = false;
    renderCommandSettings();
  }
}

function showSettingsPanel(name) {
  settingsView.showPanel(name);
}

function modelDisplayName(provider, id) {
  if (!id) return "—";
  const lab = provider?.modelLabels?.[id];
  return lab && lab.trim() ? lab : id;
}

function fillTranslateModelSelect() {
  if (!els.translateModelSelect) return;
  ensureProviders();
  const p =
    settingsSnap.aiProviders.find((x) => x.id === settingsSnap.activeProviderId) ||
    settingsSnap.aiProviders[0];
  const models = Array.isArray(p?.models) ? p.models.slice() : [];
  const cur = settingsSnap.translateModel || "";
  els.translateModelSelect.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "与对话相同";
  els.translateModelSelect.appendChild(opt0);
  for (const id of models) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = modelDisplayName(p, id);
    if (id === cur) opt.selected = true;
    els.translateModelSelect.appendChild(opt);
  }
  if (cur && !models.includes(cur)) {
    const opt = document.createElement("option");
    opt.value = cur;
    opt.textContent = cur + "（未在列表）";
    opt.selected = true;
    els.translateModelSelect.appendChild(opt);
  }
  if (!cur) els.translateModelSelect.value = "";
  if (window.CustomDropdown) requestAnimationFrame(() => window.CustomDropdown.mountAll());
}

function refreshAiOverview() {
  ensureProviders();
  const p =
    settingsSnap.aiProviders.find((x) => x.id === settingsSnap.activeProviderId) ||
    settingsSnap.aiProviders[0];
  const label = p
    ? `${p.name || "未命名"} · ${modelDisplayName(p, p.selectedModel)}`
    : "未配置";
  if (els.aiCurrentLabel) {
    els.aiCurrentLabel.textContent = label;
  }
  const info = document.querySelector('[data-tooltip-source="ai-current-label"]');
  if (info) {
    info.dataset.tooltip = label;
    info.setAttribute("aria-label", label);
  }
  if (els.aiKeyWarn) {
    const missing = !p?.apiKey;
    els.aiKeyWarn.hidden = !missing;
  }
  if (els.webEngineSelect) els.webEngineSelect.value = settingsSnap.webSearchEngine || "auto";
  if (els.proxyUrlInput) els.proxyUrlInput.value = settingsSnap.proxyUrl || "http://127.0.0.1:10808";
  if (els.translateNoThinkToggle) {
    els.translateNoThinkToggle.checked = settingsSnap.translateNoThink !== false;
  }
  fillTranslateModelSelect();
  refreshProxyStatus();
}

async function refreshProxyStatus() {
  if (!els.proxyStatusLabel && !els.aboutDataDir) return;
  try {
    const st = await api.proxyStatus?.();
    if (els.proxyStatusLabel) {
      els.proxyStatusLabel.textContent = st?.available ? "代理可用" : "代理不可用";
      els.proxyStatusLabel.style.color = st?.available ? "#3a9a5a" : "#c0392b";
    }
  } catch {
    if (els.proxyStatusLabel) els.proxyStatusLabel.textContent = "检测失败";
  }
}

function enterSettingsPage() {
  if (page === "settings") return;
  cancelScheduledFit();
  settingsReturnPage = page;
  settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  page = "settings";
  document.documentElement.classList.remove("shell-viewer", "conversation-open");
  document.body.classList.remove("shell-viewer", "conversation-open", "ai-open");
  document.documentElement.classList.add("shell-settings");
  document.body.classList.add("shell-settings");
  els.pageMain?.classList.add("hidden");
  els.pageConversation?.classList.add("hidden");
  els.pageViewer?.classList.add("hidden");
  els.pageSettings?.classList.remove("hidden");
  settingsSub = "overview";
  if (els.providerPanel && !els.providerPanel.hidden) closeProviderManager({ discard: true });
  fillSettingsForm();
  markHomeUiCards();
  showSettingsPanel(settingsPanel || "general");
  settingsWindowPromise = windowResizePromise
    .catch(() => {})
    .then(async () => {
      if (settingsReturnPage === "conversation") await api.setConversationActive?.(false);
      return api.enterSettingsMode?.();
    })
    .catch((error) => {
      console.warn("enter settings", error);
    });
}

async function leaveSettingsPage() {
  if (page !== "settings") return;
  const target = settingsReturnPage || "main";
  page = target;
  document.documentElement.classList.remove("shell-settings");
  document.body.classList.remove("shell-settings");
  els.pageSettings?.classList.add("hidden");
  els.pageMain?.classList.toggle("hidden", target !== "main");
  els.pageConversation?.classList.toggle("hidden", target !== "conversation");
  els.pageViewer?.classList.toggle("hidden", target !== "viewer");

  if (target === "viewer" && viewerOpen) {
    document.documentElement.classList.add("shell-viewer");
    document.body.classList.add("shell-viewer");
  } else if (target === "conversation" && conversationModeOpen) {
    document.documentElement.classList.add("conversation-open");
    document.body.classList.add("conversation-open");
    renderThread({ streaming: aiBusy });
  } else {
    page = "main";
    els.pageMain?.classList.remove("hidden");
    els.pageConversation?.classList.add("hidden");
    els.pageViewer?.classList.add("hidden");
    document.body.classList.toggle("ai-open", mode === "command");
    render();
  }

  try {
    await settingsWindowPromise;
    const restoreMode = target === "viewer" || homeUi === "cards" ? "windowed" : "launcher";
    await api.leaveSettingsMode?.(restoreMode);
    if (target === "conversation") await api.setConversationActive?.(true);
  } catch (error) {
    console.warn("leave settings", error);
  }

  requestAnimationFrame(() => {
    if (target === "conversation") els.conversationInput?.focus();
    else if (target === "viewer") els.btnViewerBack?.focus();
    else if (settingsReturnFocus?.isConnected) settingsReturnFocus.focus();
    else els.q?.focus();
  });
}

function backFromSettings() {
  if (settingsSub === "providers" && els.providerPanel && !els.providerPanel.hidden) {
    requestCloseProviderManager();
    return;
  }
  leaveSettingsPage();
}

function showPage(name) {
  if (name === "settings") {
    enterSettingsPage();
    return;
  }
  if (page === "settings") {
    leaveSettingsPage();
    return;
  }
  page = "main";
  els.pageMain?.classList.remove("hidden");
  els.pageSettings?.classList.add("hidden");
  els.pageViewer?.classList.add("hidden");
  els.q?.focus();
}

function settingsPayload(extra = {}) {
  if (els.providerPanel && !els.providerPanel.hidden) {
    commitEditorToSnap();
  }
  ensureProviders();
  syncCommandPreferences();
  return {
    theme: settingsSnap.theme || theme || "white",
    homeUi: normalizeHomeUi(settingsSnap.homeUi || homeUi || "classic"),
    appScanPaths: Array.isArray(settingsSnap.appScanPaths) ? settingsSnap.appScanPaths : [],
    appScanDepth: normalizeAppScanDepth(settingsSnap.appScanDepth),
    webSearch: settingsSnap.webSearch !== false,
    webSearchEngine: settingsSnap.webSearchEngine || "auto",
    proxyUrl: settingsSnap.proxyUrl || "http://127.0.0.1:10808",
    proxyEnabledForGoogle: settingsSnap.proxyEnabledForGoogle !== false,
    hotkey: settingsSnap.hotkey || "Alt+Q",
    translateModel: settingsSnap.translateModel || "",
    translateNoThink: settingsSnap.translateNoThink !== false,
    aiProviders: settingsSnap.aiProviders,
    activeProviderId: settingsSnap.activeProviderId,
    aiBaseUrl: settingsSnap.aiBaseUrl || "",
    aiApiKey: settingsSnap.aiApiKey || "",
    aiModel: settingsSnap.aiModel || "",
    conversationPinned: settingsSnap.conversationPinned === true,
    conversationRetentionHours: settingsSnap.conversationRetentionHours ?? 0,
    sttMode: settingsSnap.sttMode || "browser",
    sttLocalBinPath: settingsSnap.sttLocalBinPath || "",
    sttLocalModelPath: settingsSnap.sttLocalModelPath || "",
    sttProviderId: settingsSnap.sttProviderId || "",
    sttModel: settingsSnap.sttModel || "whisper-1",
    sttLanguage: settingsSnap.sttLanguage || "auto",
    commandOrder: settingsSnap.commandOrder,
    disabledCommands: settingsSnap.disabledCommands,
    ...extra,
  };
}

async function persistProviders(okMsg) {
  try {
    const res = await api.setSettings(settingsPayload());
    if (res?.settings) applySettingsSnap(res.settings);
    if (els.aiSaveMsg) {
      els.aiSaveMsg.textContent = okMsg || "已保存";
      setTimeout(() => {
        if (els.aiSaveMsg) els.aiSaveMsg.textContent = "切换 / 修改后自动保存到本地";
      }, 1600);
    }
    return true;
  } catch (e) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = `保存失败: ${e?.message || e}`;
    return false;
  }
}

async function saveTheme(name) {
  applyTheme(name);
  try {
    const res = await api.setSettings(settingsPayload({ theme: name }));
    if (res?.settings) applySettingsSnap(res.settings);
  } catch (e) {
    console.warn("save theme", e);
  }
}

function normalizeAppScanDepth(value) {
  const depth = Number.parseInt(value, 10);
  if (!Number.isFinite(depth)) return 2;
  return Math.max(0, Math.min(5, depth));
}

function normalizeAppScanPath(value) {
  return String(value || "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/\//g, "\\");
}

function appScanPaths() {
  return Array.isArray(settingsSnap.appScanPaths) ? settingsSnap.appScanPaths : [];
}

function renderAppScanPaths() {
  if (!els.appScanPathList) return;
  els.appScanPathList.replaceChildren();
  const paths = appScanPaths();
  if (!paths.length) {
    const empty = document.createElement("div");
    empty.className = "scan-folder-empty";
    empty.textContent = "尚未添加目录";
    els.appScanPathList.appendChild(empty);
    return;
  }
  for (const path of paths) {
    const item = document.createElement("div");
    item.className = "scan-folder-item";
    const icon = document.createElement("span");
    icon.className = "scan-folder-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/></svg>';
    const label = document.createElement("span");
    label.className = "scan-folder-path";
    label.textContent = path;
    label.title = path;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "scan-folder-remove";
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
    remove.title = `移除 ${path}`;
    remove.setAttribute("aria-label", `移除 ${path}`);
    remove.addEventListener("click", () => removeAppScanPath(path));
    item.append(icon, label, remove);
    els.appScanPathList.appendChild(item);
  }
}

async function persistAppScanSettings(previous) {
  try {
    const result = await api.setSettings(settingsPayload());
    if (result?.settings) applySettingsSnap(result.settings);
    else renderAppScanPaths();
    return true;
  } catch (error) {
    settingsSnap.appScanPaths = previous.paths;
    settingsSnap.appScanDepth = previous.depth;
    if (els.appScanDepth) els.appScanDepth.value = String(previous.depth);
    renderAppScanPaths();
    console.warn("save app scan settings", error);
    window.alert(`保存软件目录失败: ${error?.message || error}`);
    return false;
  }
}

async function addAppScanPath(value = els.appScanPathInput?.value) {
  const path = normalizeAppScanPath(value);
  if (!path) {
    els.appScanPathInput?.focus();
    return;
  }
  const paths = appScanPaths();
  const key = path.replace(/\\+$/, "").toLowerCase();
  if (paths.some((item) => item.replace(/\\+$/, "").toLowerCase() === key)) {
    els.appScanPathInput?.select();
    return;
  }
  const previous = { paths: [...paths], depth: normalizeAppScanDepth(settingsSnap.appScanDepth) };
  settingsSnap.appScanPaths = [...paths, path];
  if (els.appScanPathInput) els.appScanPathInput.value = "";
  renderAppScanPaths();
  await persistAppScanSettings(previous);
}

async function pickAppScanPath() {
  try {
    const path = await api.pickAppScanFolder();
    if (path) await addAppScanPath(path);
  } catch (error) {
    console.warn("pick app scan folder", error);
    window.alert(`选择软件目录失败: ${error?.message || error}`);
  }
}

async function removeAppScanPath(path) {
  const paths = appScanPaths();
  const previous = { paths: [...paths], depth: normalizeAppScanDepth(settingsSnap.appScanDepth) };
  settingsSnap.appScanPaths = paths.filter((item) => item !== path);
  renderAppScanPaths();
  await persistAppScanSettings(previous);
}

async function saveAppScanDepth() {
  const previous = {
    paths: [...appScanPaths()],
    depth: normalizeAppScanDepth(settingsSnap.appScanDepth),
  };
  const depth = normalizeAppScanDepth(els.appScanDepth?.value);
  settingsSnap.appScanDepth = depth;
  if (els.appScanDepth) els.appScanDepth.value = String(depth);
  await persistAppScanSettings(previous);
}

function addProvider() {
  if (!els.providerPanel || els.providerPanel.hidden) {
    openProviderManager({ create: true });
    return;
  }
  if (editingProviderId) commitEditorToSnap();
  const id = `p${Date.now().toString(16)}`;
  const p = {
    id,
    name: "",
    format: "openai_compatible",
    baseUrl: "",
    apiKey: "",
    headers: {},
    models: ["gpt-4o-mini"],
    selectedModel: "gpt-4o-mini",
    requestBody: {},
    extraOptions: {},
    modelConfigs: {},
  };
  settingsSnap.aiProviders.push(p);
  newProviderIds.add(id);
  editingProviderId = id;
  fillSettingsForm();
  updateProviderDialog();
  requestAnimationFrame(() => els.pvName?.focus());
}

function deleteProvider() {
  commitEditorToSnap();
  ensureProviders();
  if (settingsSnap.aiProviders.length <= 1) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = "至少保留一个供应商";
    return;
  }
  const id = editingProviderId;
  settingsSnap.aiProviders = settingsSnap.aiProviders.filter((p) => p.id !== id);
  newProviderIds.delete(id);
  if (settingsSnap.activeProviderId === id) {
    settingsSnap.activeProviderId = settingsSnap.aiProviders[0].id;
  }
  editingProviderId = settingsSnap.activeProviderId;
  fillSettingsForm();
  updateProviderDialog();
  if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已移除，保存后生效";
}

async function fetchAndPickModels() {
  commitEditorToSnap();
  const p = getEditingProvider();
  if (!p) return;
  // toggle close if already open with data
  if (
    els.modelPicker &&
    !els.modelPicker.classList.contains("hidden") &&
    lastFetchedModels.length
  ) {
    els.modelPicker.classList.add("hidden");
    return;
  }
  if (els.aiSaveMsg) els.aiSaveMsg.textContent = "正在拉取模型…";
  try {
    const list = await api.aiFetchModels(p);
    if (!Array.isArray(list) || !list.length) {
      lastFetchedModels = [];
      if (els.aiSaveMsg) els.aiSaveMsg.textContent = "未获取到模型，可手动输入 id 后回车";
      return;
    }
    lastFetchedModels = list.slice();
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = `共 ${list.length} 个，点击加入`;
    openModelPicker();
  } catch (e) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = `拉取失败: ${e?.message || e}`;
  }
}

function openModelPicker() {
  if (!els.modelPicker) return;
  if (!lastFetchedModels.length) return;
  const p = getEditingProvider();
  const existing = new Set(p?.models || []);
  els.modelPicker.innerHTML = "";
  els.modelPicker.classList.remove("hidden");
  for (const id of lastFetchedModels) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-pick-item";
    btn.innerHTML = `${escapeHtml(id)}${
      existing.has(id) ? '<span class="mid">已有</span>' : '<span class="mid">点击加入</span>'
    }`;
    btn.addEventListener("click", () => {
      if (!p) return;
      if (!Array.isArray(p.models)) p.models = [];
      if (!p.models.includes(id)) p.models.push(id);
      p.selectedModel = id;
      const label = (els.pvModelLabel?.value || "").trim();
      if (!p.modelLabels) p.modelLabels = {};
      if (label) p.modelLabels[id] = label;
      if (els.pvAddModel) els.pvAddModel.value = "";
      if (els.pvModelLabel) els.pvModelLabel.value = "";
      els.modelPicker.classList.add("hidden");
      fillModelSelect(p);
      if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已加入列表，请点「保存配置」";
    });
    els.modelPicker.appendChild(btn);
  }
}

function addModelManual() {
  const p = getEditingProvider();
  if (!p) return;
  const name = (els.pvAddModel?.value || "").trim();
  if (!name) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = "请输入模型 id，或点 ↓ 拉取";
    return;
  }
  if (!Array.isArray(p.models)) p.models = [];
  if (!p.models.includes(name)) p.models.push(name);
  p.selectedModel = name;
  if (!p.modelLabels) p.modelLabels = {};
  const label = (els.pvModelLabel?.value || "").trim();
  if (label) p.modelLabels[name] = label;
  else delete p.modelLabels[name];
  if (els.pvAddModel) els.pvAddModel.value = "";
  if (els.pvModelLabel) els.pvModelLabel.value = "";
  fillModelSelect(p);
  if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已加入列表，请点「保存配置」";
}

async function saveProviderManual() {
  if (!(els.pvName?.value || "").trim()) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = "请填写供应商名称";
    els.pvName?.focus();
    return;
  }
  try {
    commitEditorToSnap();
  } catch (error) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = error.message || String(error);
    return;
  }
  const p = getEditingProvider();
  if (!p?.selectedModel?.trim()) {
    if (els.aiSaveMsg) els.aiSaveMsg.textContent = "请至少添加一个模型";
    els.pvAddModel?.focus();
    return;
  }
  const successMessage = newProviderIds.has(p.id) ? "供应商添加成功" : "供应商保存成功";
  const saved = await persistProviders(successMessage);
  if (!saved) return;
  providerSessionBackup = null;
  newProviderIds.clear();
  updateUseProviderBtn();
  refreshAiOverview();
  closeProviderManager({ discard: false });
  showSettingsToast(successMessage);
}

function applySettingsSnap(s) {
  if (!s) return;
  settingsSnap = {
    theme: s.theme || "white",
    homeUi: normalizeHomeUi(s.homeUi || "classic"),
    appScanPaths: Array.isArray(s.appScanPaths) ? s.appScanPaths : [],
    appScanDepth: normalizeAppScanDepth(s.appScanDepth),
    webSearch: s.webSearch !== false,
    webSearchEngine: s.webSearchEngine || "auto",
    proxyUrl: s.proxyUrl || "http://127.0.0.1:10808",
    proxyEnabledForGoogle: s.proxyEnabledForGoogle !== false,
    hotkey: s.hotkey || "Alt+Q",
    translateModel: s.translateModel || "",
    translateNoThink: s.translateNoThink !== false,
    aiProviders: Array.isArray(s.aiProviders) ? s.aiProviders : [],
    activeProviderId: s.activeProviderId || "",
    aiBaseUrl: s.aiBaseUrl || "",
    aiApiKey: s.aiApiKey || "",
    aiModel: s.aiModel || "gpt-4o-mini",
    conversationPinned: s.conversationPinned === true,
    conversationRetentionHours: s.conversationRetentionHours ?? 0,
    sttMode: s.sttMode || "browser",
    sttLocalBinPath: s.sttLocalBinPath || "",
    sttLocalModelPath: s.sttLocalModelPath || "",
    sttProviderId: s.sttProviderId || "",
    sttModel: s.sttModel || "whisper-1",
    sttLanguage: s.sttLanguage || "auto",
    commandOrder: Array.isArray(s.commandOrder) ? s.commandOrder : [],
    disabledCommands: Array.isArray(s.disabledCommands) ? s.disabledCommands : [],
  };
  syncCommandPreferences();
  // normalize modelLabels on providers
  for (const p of settingsSnap.aiProviders) {
    // serde may return modelLabels; keep both keys synced
    const labels = p.modelLabels || p.model_labels || {};
    p.modelLabels = { ...labels };
    delete p.model_labels;
    normalizeProviderConfig(p);
  }
  updateConversationPinButton();
  updateConversationWebButton();
  if (els.hotkeyInput) els.hotkeyInput.value = settingsSnap.hotkey || "Alt+Q";
  if (els.translateNoThinkToggle) {
    els.translateNoThinkToggle.checked = settingsSnap.translateNoThink !== false;
  }
  fillTranslateModelSelect();
  ensureProviders();
  if (s.theme) applyTheme(s.theme);
  // don't force window mode when applying snap inside settings
  homeUi = settingsSnap.homeUi;
  document.body.classList.toggle("ui-cards", homeUi === "cards");
  document.body.classList.toggle("ui-classic", homeUi !== "cards");
  markHomeUiCards();
  if (els.webEngineSelect) els.webEngineSelect.value = settingsSnap.webSearchEngine || "auto";
  if (els.conversationRetention) els.conversationRetention.value = String(settingsSnap.conversationRetentionHours ?? 0);
  if (els.proxyUrlInput) els.proxyUrlInput.value = settingsSnap.proxyUrl || "";
  if (page === "settings") {
    fillSettingsForm();
    refreshAiOverview();
    if (settingsPanel === "commands") renderCommandSettings();
  }
}

function resetChat() {
  chatHistory = [];
  streamingAssistant = "";
  toolRows = [];
  aiBusy = false;
  aiStopping = false;
  currentConversationId = null;
  pendingAttachments = [];
  renderPendingAttachments();
  if (els.aiStatus) els.aiStatus.textContent = "Enter 发送";
  renderThread();
}

function createConversationId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function conversationTitle(messages) {
  const first = messages.find((message) => message.role === "user")?.content || "新对话";
  return String(first).replace(/\s+/g, " ").trim().slice(0, 48) || "新对话";
}

async function persistCurrentConversation() {
  if (!chatHistory.some((message) => message.role === "assistant")) return;
  if (!currentConversationId) currentConversationId = createConversationId();
  const modeId = currentModeDef()?.id || "ai";
  const saveConversation = modeId === "fy"
    ? api.saveTranslationConversation
    : modeId === "ai"
      ? api.saveConversation
      : null;
  if (!saveConversation) return;
  const saved = await saveConversation({
    id: currentConversationId,
    title: conversationTitle(chatHistory),
    mode: modeId,
    updatedAt: Date.now(),
    messages: chatHistory.map((message) => ({
      role: message.role,
      content: message.content,
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
    })),
  });
  if (modeId === "ai") {
    conversations = saved;
    renderConversations();
  }
}

function setConversationPanel(open) {
  const visible = !!open;
  if (visible) setAiMoreMenu(false);
  els.conversationPanel?.classList.toggle("hidden", !visible);
  els.aiMenuHistory?.setAttribute("aria-expanded", String(visible));
  if (visible) renderConversations();
}

function setAiMoreMenu(open) {
  const visible = !!open && currentModeDef()?.id === "ai";
  els.aiMoreMenu?.classList.toggle("is-open", visible);
  els.aiMoreMenu?.setAttribute("aria-hidden", String(!visible));
  els.btnAiMore?.setAttribute("aria-expanded", String(visible));
}

function updateAiOnlyControls(command) {
  const visible = command?.id === "ai";
  els.aiMoreWrap?.classList.toggle("hidden", !visible);
  if (!visible) {
    setAiMoreMenu(false);
    setConversationPanel(false);
  }
}

function renderConversationList(container) {
  if (!container) return;
  container.innerHTML = "";
  if (!conversations.length) {
    const empty = document.createElement("div");
    empty.className = "conversation-empty";
    empty.textContent = "暂无历史会话";
    container.appendChild(empty);
    return;
  }
  for (const conversation of conversations) {
    const conversationCommand = commandRegistry.get(conversation.mode || "ai");
    const commandAvailable = !!conversationCommand && isCommandEnabled(conversationCommand.id);
    const row = document.createElement("div");
    row.className = `conversation-row${conversation.id === currentConversationId ? " is-active" : ""}${commandAvailable ? "" : " is-command-disabled"}`;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "conversation-open";
    const title = document.createElement("div");
    title.className = "conversation-title";
    title.textContent = conversation.title || "新对话";
    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    const date = new Date(Number(conversation.updatedAt) || Date.now());
    meta.textContent = `${conversationCommand?.title || conversation.mode || "AI"} · ${date.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    open.append(title, meta);
    open.disabled = !commandAvailable;
    if (!commandAvailable) open.title = "该命令已禁用";
    open.addEventListener("click", () => openConversation(conversation));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "conversation-delete";
    remove.textContent = "×";
    remove.title = "删除会话";
    remove.setAttribute("aria-label", "删除会话");
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        conversations = await api.deleteConversation(conversation.id);
        if (currentConversationId === conversation.id) currentConversationId = null;
        renderConversations();
      } catch (error) {
        console.warn("delete conversation", error);
      }
    });

    row.append(open, remove);
    container.appendChild(row);
  }
}

function renderConversations() {
  renderConversationList(els.conversationList);
  renderConversationList(els.conversationDrawerList);
}

function setConversationDrawer(open) {
  const visible = !!open;
  els.conversationHistoryDrawer?.classList.toggle("is-open", visible);
  els.conversationHistoryDrawer?.setAttribute("aria-hidden", String(!visible));
  els.btnConversationHistory?.setAttribute("aria-expanded", String(visible));
  if (visible) renderConversations();
}

function openConversation(conversation) {
  if (aiBusy || !conversation) return;
  const command = commandRegistry.get(conversation.mode || "ai");
  if (!command || !isCommandEnabled(command.id)) return;
  resetChat();
  chatHistory = Array.isArray(conversation.messages)
    ? conversation.messages
        .filter((message) => message?.role === "user" || message?.role === "assistant")
        .map((message) => ({
          role: message.role,
          content: String(message.content || ""),
          attachments: Array.isArray(message.attachments) ? message.attachments : [],
        }))
    : [];
  currentConversationId = conversation.id;
  enterCommandMode(command.id, {
    clearBody: true,
    keepHistory: true,
  });
  setConversationPanel(false);
  setConversationDrawer(false);
  render();
}

function startNewConversation() {
  if (aiBusy) return;
  setConversationPanel(false);
  setConversationDrawer(false);
  const commandId = cmdMode && isCommandEnabled(cmdMode) ? cmdMode : "ai";
  if (!enterCommandMode(commandId, { clearBody: true, keepHistory: false })) return;
  if (conversationModeOpen) {
    updateConversationComposer();
    els.conversationInput?.focus();
  }
}

function activeConversationProvider() {
  ensureProviders();
  return (
    settingsSnap.aiProviders.find((provider) => provider.id === settingsSnap.activeProviderId) ||
    settingsSnap.aiProviders[0]
  );
}

function activeConversationModelConfig() {
  const provider = activeConversationProvider();
  normalizeProviderConfig(provider);
  return provider?.modelConfigs?.[conversationSelectedModel] || null;
}

function selectedEffortOption() {
  const config = activeConversationModelConfig();
  return config?.efforts?.find((effort) => effort.id === conversationSelectedEffort) || null;
}

function conversationMenuButton(label, value, target) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "conversation-menu-row";
  button.innerHTML = `<span>${escapeHtml(label)}</span><span class="conversation-menu-value">${escapeHtml(value)} <b>›</b></span>`;
  button.addEventListener("click", () => {
    conversationMenuView = target;
    renderConversationModels();
  });
  return button;
}

function renderConversationModels() {
  const provider = activeConversationProvider();
  normalizeProviderConfig(provider);
  const models = Array.isArray(provider?.models) ? provider.models.filter(Boolean) : [];
  const fallback = provider?.selectedModel || settingsSnap.aiModel || "默认模型";
  if (!conversationSelectedModel || !models.includes(conversationSelectedModel)) {
    conversationSelectedModel = models.includes(fallback) ? fallback : models[0] || fallback;
  }
  const config = activeConversationModelConfig();
  const efforts = Array.isArray(config?.efforts) && config.efforts.length ? config.efforts : defaultEfforts();
  if (!conversationSelectedEffort || !efforts.some((effort) => effort.id === conversationSelectedEffort)) {
    conversationSelectedEffort = config?.defaultEffort || efforts[0]?.id || "medium";
  }
  const effort = efforts.find((item) => item.id === conversationSelectedEffort);
  const modelName = modelDisplayName(provider, conversationSelectedModel);
  const effortName = effort?.label || effort?.id || "中";
  if (els.conversationModelName) {
    els.conversationModelName.textContent = `${modelName} · ${effortName}`;
  }
  if (!els.conversationModelMenu) return;
  els.conversationModelMenu.innerHTML = "";
  if (conversationMenuView === "main") {
    els.conversationModelMenu.append(
      conversationMenuButton("模型", modelName, "models"),
      conversationMenuButton("思考强度", effortName, "efforts"),
    );
    const advanced = document.createElement("button");
    advanced.type = "button";
    advanced.className = "conversation-menu-row conversation-advanced-row";
    advanced.innerHTML = '<span>高级</span><span class="conversation-menu-value">请求体 <b>›</b></span>';
    advanced.addEventListener("click", () => {
      conversationMenuView = "advanced";
      renderConversationModels();
    });
    els.conversationModelMenu.appendChild(advanced);
    return;
  }

  const head = document.createElement("button");
  head.type = "button";
  head.className = "conversation-menu-back";
  head.innerHTML = `<span>‹</span>${conversationMenuView === "models" ? "模型" : conversationMenuView === "efforts" ? "思考强度" : "单次请求体"}`;
  head.addEventListener("click", () => {
    conversationMenuView = "main";
    renderConversationModels();
  });
  els.conversationModelMenu.appendChild(head);

  if (conversationMenuView === "models") for (const model of models) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `conversation-model-option${model === conversationSelectedModel ? " is-selected" : ""}`;
    option.setAttribute("role", "menuitem");
    option.innerHTML = `<span>${escapeHtml(modelDisplayName(provider, model))}</span><span class="conversation-model-check">✓</span>`;
    option.addEventListener("click", () => {
      conversationSelectedModel = model;
      conversationSelectedEffort = "";
      conversationMenuView = "main";
      renderConversationModels();
    });
    els.conversationModelMenu.appendChild(option);
  }
  if (conversationMenuView === "efforts") for (const item of efforts) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `conversation-model-option${item.id === conversationSelectedEffort ? " is-selected" : ""}`;
    option.innerHTML = `<span>${escapeHtml(item.label || item.id)}</span><span class="conversation-model-check">✓</span>`;
    option.addEventListener("click", () => {
      conversationSelectedEffort = item.id;
      conversationMenuView = "main";
      renderConversationModels();
    });
    els.conversationModelMenu.appendChild(option);
  }
  if (conversationMenuView === "advanced") {
    const editor = document.createElement("div");
    editor.className = "conversation-request-editor";
    editor.innerHTML = `<textarea rows="7" spellcheck="false" aria-label="单次请求体">${escapeHtml(prettyJson(conversationRequestBody))}</textarea><div><button type="button" data-action="clear">清空</button><button type="button" data-action="apply">应用</button></div>`;
    editor.querySelector('[data-action="clear"]').addEventListener("click", () => {
      conversationRequestBody = {};
      editor.querySelector("textarea").value = "{}";
    });
    editor.querySelector('[data-action="apply"]').addEventListener("click", () => {
      try {
        conversationRequestBody = parseJsonObject(editor.querySelector("textarea").value, "单次请求体");
        conversationMenuView = "main";
        renderConversationModels();
      } catch (error) {
        editor.querySelector("textarea").setCustomValidity(error.message);
        editor.querySelector("textarea").reportValidity();
      }
    });
    els.conversationModelMenu.appendChild(editor);
  }
}

function setConversationModelMenu(open) {
  const visible = !!open;
  if (visible && !conversationMenuView) conversationMenuView = "main";
  els.conversationModelMenu?.classList.toggle("is-open", visible);
  els.conversationModelButton?.setAttribute("aria-expanded", String(visible));
}

function updateConversationComposer() {
  if (!els.conversationInput || !els.conversationSend) return;
  els.conversationInput.style.height = "auto";
  els.conversationInput.style.height = `${Math.min(els.conversationInput.scrollHeight, 140)}px`;
  const hasText = !!els.conversationInput.value.trim() || pendingAttachments.length > 0;
  els.conversationSend.classList.toggle("has-text", hasText && !aiBusy);
  els.conversationSend.classList.toggle("is-stopping", aiBusy);
  els.conversationSend.disabled = aiBusy ? aiStopping : !hasText;
  els.conversationSend.setAttribute("aria-label", aiBusy ? "停止生成" : "发送");
  els.conversationSend.title = aiBusy ? "停止生成" : "发送";
  if (els.conversationFilePrefix) {
    const inputPrefix = currentModeDef()?.inputPrefix || "";
    els.conversationFilePrefix.textContent = inputPrefix;
    els.conversationFilePrefix.hidden = !inputPrefix;
  }
}

function renderPendingAttachments() {
  if (!els.conversationAttachments) return;
  els.conversationAttachments.innerHTML = "";
  els.conversationAttachments.hidden = pendingAttachments.length === 0;
  for (const attachment of pendingAttachments) {
    const chip = document.createElement("div");
    chip.className = "conversation-attachment-chip";
    const size = attachment.size < 1024 * 1024
      ? `${Math.max(1, Math.round(attachment.size / 1024))} KB`
      : `${(attachment.size / 1024 / 1024).toFixed(1)} MB`;
    chip.innerHTML = `<span title="${escapeHtml(attachment.name)}">${escapeHtml(attachment.name)}</span><small>${size}</small>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "移除附件";
    remove.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((item) => item.id !== attachment.id);
      renderPendingAttachments();
      updateConversationComposer();
    });
    chip.appendChild(remove);
    els.conversationAttachments.appendChild(chip);
  }
}

function fileToBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

async function addConversationAttachments(files) {
  const incoming = [...(files || [])];
  if (!incoming.length) return;
  if (pendingAttachments.length + incoming.length > 5) {
    window.alert("一次最多添加 5 个附件");
    return;
  }
  const total = incoming.reduce((sum, file) => sum + file.size, 0) + pendingAttachments.reduce((sum, item) => sum + item.size, 0);
  if (total > 25 * 1024 * 1024) {
    window.alert("附件总大小不能超过 25 MB");
    return;
  }
  els.btnConversationAttach?.classList.add("is-loading");
  try {
    for (const file of incoming) {
      const attachment = await api.saveAttachment({
        name: file.name,
        mime: file.type || "application/octet-stream",
        dataBase64: await fileToBase64(file),
      });
      pendingAttachments.push(attachment);
    }
  } catch (error) {
    window.alert(error?.message || String(error));
  } finally {
    if (els.conversationFileInput) els.conversationFileInput.value = "";
    els.btnConversationAttach?.classList.remove("is-loading");
    renderPendingAttachments();
    updateConversationComposer();
  }
}

/** 功能4：AI 输入框粘贴图片 — 从剪贴板提取图片文件并转为附件 */
function setupPasteImage() {
  const inputs = [els.conversationInput].filter(Boolean);
  for (const input of inputs) {
    input.addEventListener("paste", async (event) => {
      const files = event.clipboardData?.files;
      if (!files || !files.length) return;
      const images = [...files].filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      event.preventDefault();
      await addConversationAttachments(images);
      renderPendingAttachments();
    });
  }
}

/** @type {{ stop: () => void } | null} */
let sttController = null;

/**
 * 功能3：初始化语音输入按钮（仅对话模式）
 * 点击麦克风按钮开始/停止录音
 */
function setupSTT() {
  const btn = els.btnSttConversation;
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (sttController) {
      sttController.stop();
      sttController = null;
      btn.classList.remove("is-recording");
      btn.title = "\u8BED\u97F3\u8F93\u5165";
      return;
    }
    const mode = settingsSnap.sttMode || "browser";
    const check = checkSTTMode(mode, settingsSnap);
    if (!check.ok) {
      console.warn("STT check failed:", check.reason);
      return;
    }
    btn.classList.add("is-recording");
    btn.title = "\u70B9\u51FB\u505C\u6B62\u5F55\u97F3";
    try {
      sttController = await startSTT(mode, settingsSnap, {
        onResult: (text) => {
          const input = els.conversationInput;
          if (input) {
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            input.value = input.value.slice(0, start) + text + input.value.slice(end);
            const pos = start + text.length;
            input.setSelectionRange(pos, pos);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
        onError: (error) => {
          console.warn("STT error:", error);
        },
      });
    } catch (e) {
      btn.classList.remove("is-recording");
      btn.title = "\u8BED\u97F3\u8F93\u5165";
      sttController = null;
    }
  });
}

function updateConversationPinButton() {
  const pinned = settingsSnap.conversationPinned === true;
  els.btnConversationPin?.classList.toggle("is-active", pinned);
  els.btnConversationPin?.setAttribute("aria-pressed", String(pinned));
  if (els.btnConversationPin) els.btnConversationPin.title = pinned ? "取消置顶" : "置顶窗口";
}

function updateConversationWebButton() {
  const enabled = settingsSnap.webSearch !== false;
  els.conversationWebButton?.classList.toggle("is-active", enabled);
  els.conversationWebButton?.setAttribute("aria-pressed", String(enabled));
  if (els.conversationWebButton) {
    els.conversationWebButton.title = enabled ? "联网搜索已开启" : "联网搜索已关闭";
    els.conversationWebButton.setAttribute("aria-label", enabled ? "关闭联网搜索" : "开启联网搜索");
  }
  updateQuickWebButton();
}

function updateQuickWebButton() {
  const enabled = settingsSnap.webSearch !== false;
  const visible = !conversationModeOpen && mode === "command" && cmdMode === "ai";
  els.quickWebButton?.classList.toggle("hidden", !visible);
  els.quickWebButton?.classList.toggle("is-active", enabled);
  els.quickWebButton?.setAttribute("aria-pressed", String(enabled));
  if (els.quickWebButton) {
    els.quickWebButton.title = enabled ? "联网搜索已开启" : "联网搜索已关闭";
    els.quickWebButton.setAttribute("aria-label", enabled ? "关闭联网搜索" : "开启联网搜索");
  }
}

async function toggleWebSearch() {
  const previous = settingsSnap.webSearch !== false;
  settingsSnap.webSearch = !previous;
  updateConversationWebButton();
  try {
    const result = await api.setSettings(settingsPayload({ webSearch: settingsSnap.webSearch }));
    if (result?.settings) applySettingsSnap(result.settings);
  } catch (error) {
    settingsSnap.webSearch = previous;
    updateConversationWebButton();
    console.warn("save web search", error);
  }
}

function enhanceSettingsDescriptions() {
  settingsView.enhanceDescriptions();
}

async function toggleConversationPin() {
  const next = settingsSnap.conversationPinned !== true;
  try {
    settingsSnap.conversationPinned = await api.setConversationPin(next);
    updateConversationPinButton();
  } catch (error) {
    console.warn("pin window", error);
  }
}

function enterConversationMode() {
  if (!isCommandEnabled("ai")) return false;
  if (cmdMode !== "ai") {
    resetChat();
    cmdMode = "ai";
    mode = "command";
  }
  conversationModeOpen = true;
  cancelScheduledFit();
  page = "conversation";
  setAiMoreMenu(false);
  setConversationPanel(false);
  setConversationDrawer(false);
  document.documentElement.classList.add("conversation-open");
  document.body.classList.add("conversation-open");
  els.pageMain?.classList.add("hidden");
  els.pageSettings?.classList.add("hidden");
  els.pageViewer?.classList.add("hidden");
  els.pageConversation?.classList.remove("hidden");
  if (els.aiThread && els.conversationThreadHost && els.aiThread.parentElement !== els.conversationThreadHost) {
    els.conversationThreadHost.appendChild(els.aiThread);
  }
  renderConversationModels();
  renderPendingAttachments();
  updateConversationPinButton();
  updateConversationWebButton();
  api.setConversationActive?.(true).catch(() => {});
  renderThread({ streaming: aiBusy });
  updateConversationComposer();
  requestAnimationFrame(() => els.conversationInput?.focus());
  return true;
}

function exitConversationMode() {
  if (!conversationModeOpen) return;
  conversationModeOpen = false;
  api.setConversationActive?.(false).catch(() => {});
  page = "main";
  setConversationModelMenu(false);
  setConversationDrawer(false);
  document.documentElement.classList.remove("conversation-open");
  document.body.classList.remove("conversation-open");
  els.pageConversation?.classList.add("hidden");
  els.pageMain?.classList.remove("hidden");
  if (els.aiThread && els.aiSection && els.aiThread.parentElement !== els.aiSection) {
    els.aiSection.append(els.aiThread);
  }
  render();
  if (homeUi === "cards") api.enterCardsMode?.().catch(() => {});
  else api.enterLauncherMode?.().catch(() => {});
  requestAnimationFrame(() => els.q?.focus());
}

function enterStandaloneModeFromConversation(command, body = "") {
  if (conversationModeOpen) exitConversationMode();
  if (!enterCommandMode(command.id, { clearBody: true, keepHistory: false })) return;
  if (els.q) {
    els.q.value = body;
    els.q.focus();
  }
  render();
}

function startFollowup() {
  const id = cmdMode || "ai";
  enterCommandMode(id, { clearBody: true, keepHistory: true });
  const def = currentModeDef();
  if (els.q) {
    els.q.value = "";
    els.q.placeholder = def?.followPlaceholder || "输入追问后 Enter";
    els.q.focus();
  }
  if (els.aiStatus) els.aiStatus.textContent = "";
}

async function sendAi() {
  if (conversationModeOpen && !cmdMode) {
    if (!isCommandEnabled("ai")) return;
    cmdMode = "ai";
    mode = "command";
  }
  if (!cmdMode) {
    const p = parseSlashInput(els.q?.value || "");
    if (p?.kind === "mode") {
      enterCommandMode(p.def.id, { clearBody: false, keepHistory: false });
      if (els.q) els.q.value = p.body;
    } else {
      return;
    }
  }
  if (conversationModeOpen) {
    const parsed = parseSlashInput(els.conversationInput?.value || "");
    if (parsed?.kind === "disabled") return;
    if (parsed?.kind === "mode") {
      cmdMode = parsed.def.id;
      mode = "command";
      if (els.conversationInput) els.conversationInput.value = parsed.body;
    }
  }
  const def = currentModeDef();
  if (!def) return;
  let prompt = getCommandBody();
  if (conversationModeOpen && def.surface === "custom") {
    enterStandaloneModeFromConversation(def, prompt);
    return;
  }
  if (mode !== "command" && !cmdMode) return;
  if (aiBusy) return;
  if (!String(prompt).trim() && pendingAttachments.length === 0) {
    if (conversationModeOpen) {
      els.conversationInput?.focus();
      return;
    }
    renderThread({ errorText: "请输入内容" });
    return;
  }

  if (typeof def?.run === "function") {
    const controller = commandHost.getController(def.id);
    try {
      await def.run(String(prompt).trim(), api, controller?.getRunOptions?.() || {});
      if (els.q) els.q.value = "";
      if (conversationModeOpen && els.conversationInput) {
        els.conversationInput.value = "";
        updateConversationComposer();
      }
      if (controller?.onRunSuccess) {
        controller.onRunSuccess();
      } else if (els.aiStatus) {
        els.aiStatus.textContent = "已完成";
      }
    } catch (error) {
      if (controller?.onRunError) {
        controller.onRunError(error);
      } else {
        renderThread({ errorText: error?.message || String(error) });
      }
    }
    return;
  }

  let userText = String(prompt).trim();
  if (typeof def?.preprocessInput === "function") {
    try {
      userText = def.preprocessInput(userText);
    } catch (error) {
      els.conversationInput?.setCustomValidity(error.message || String(error));
      els.conversationInput?.reportValidity();
      return;
    }
  }
  els.conversationInput?.setCustomValidity("");
  const messageAttachments = pendingAttachments.slice();
  chatHistory.push({ role: "user", content: userText, attachments: messageAttachments });
  pendingAttachments = [];
  renderPendingAttachments();
  streamingAssistant = "";
  toolRows = [];
  aiBusy = true;
  aiStopping = false;
  aiErrorFlag = false;
  if (els.aiStatus) els.aiStatus.textContent = "";
  els.modePrefix?.classList.remove("hidden");
  if (els.modePrefix && def) {
    els.modePrefix.textContent = def.displayPrefix || def.label;
    els.modePrefix.classList.toggle("is-translate", def.resultKind === "translate");
    els.modePrefix.classList.toggle("is-ai", def.id === "ai");
  }
  if (els.q) {
    els.q.value = "";
    els.q.placeholder = def?.followPlaceholder || def?.placeholder || "继续输入…";
  }
  if (conversationModeOpen && els.conversationInput) {
    els.conversationInput.value = "";
    updateConversationComposer();
  }
  mode = "command";
  render();
  renderThread({ streaming: true });
  updateConversationComposer();

  const messages = [];
  if (def?.system) {
    // 功能6：图片翻译 — 动态增强 system prompt
    let systemContent = def.system;
    if (def.resultKind === "translate") {
      const hasImages = chatHistory.some((m) =>
        Array.isArray(m.attachments) &&
        m.attachments.some((a) => {
          const t = (a.type || "").toLowerCase();
          return t.startsWith("image/") || t === "image";
        }),
      );
      if (hasImages) {
        systemContent = enhanceTranslatePrompt(def.system, true);
      }
    }
    messages.push({ role: "system", content: systemContent });
  }
  for (const m of chatHistory) {
    messages.push({
      role: m.role,
      content: m.content,
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
    });
  }
  const hasDedicatedResult = def?.resultKind === "translate";
  const chatOpts = {
    mode: def?.id || cmdMode || "ai",
    enableTools: hasDedicatedResult ? false : settingsSnap.webSearch !== false,
  };
  if (!hasDedicatedResult && conversationModeOpen && conversationSelectedModel) {
    chatOpts.model = conversationSelectedModel;
    chatOpts.effort = conversationSelectedEffort || undefined;
    if (conversationRequestBody && Object.keys(conversationRequestBody).length) {
      chatOpts.requestBody = conversationRequestBody;
    }
  }
  if (hasDedicatedResult && settingsSnap.translateModel) {
    chatOpts.model = settingsSnap.translateModel;
  }
  try {
    await chatRuntime.send(messages, chatOpts);
  } catch (e) {
    aiBusy = false;
    if (els.aiStatus) els.aiStatus.textContent = "失败";
    renderThread({ errorText: String(e?.message || e) });
  }
}

async function stopAi() {
  if (!aiBusy || aiStopping) return;
  aiStopping = true;
  if (els.aiStatus) els.aiStatus.textContent = "正在停止…";
  updateAiStopControls();
  updateConversationComposer();
  try {
    const stopped = await chatRuntime.stop();
    if (!stopped) {
      aiStopping = false;
      updateAiStopControls();
      updateConversationComposer();
    }
  } catch (error) {
    aiStopping = false;
    if (els.aiStatus) els.aiStatus.textContent = "停止失败";
    updateAiStopControls();
    updateConversationComposer();
    console.warn("stop ai", error);
  }
}

function onKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    if (els.recentContextMenu && !els.recentContextMenu.classList.contains("hidden")) {
      closeRecentContextMenu();
      els.q?.focus();
      return;
    }
    if (page === "settings") {
      backFromSettings();
      return;
    }
    if (commandHost.handleEscape()) return;
    if (els.aiMoreMenu?.classList.contains("is-open")) {
      setAiMoreMenu(false);
      els.btnAiMore?.focus();
      return;
    }
    if (!els.conversationPanel?.classList.contains("hidden")) {
      setConversationPanel(false);
      return;
    }
    if (conversationModeOpen) {
      exitConversationMode();
      return;
    }
    if (viewerOpen) {
      closeViewer();
      return;
    }
    if (mode === "command" || cmdMode) {
      exitCommandMode();
      render();
      return;
    }
    if (!els.slashMenu?.classList.contains("hidden")) {
      hideSlashMenu();
      if (els.q) els.q.value = "";
      render();
      return;
    }
    api.hide();
    return;
  }
  if (page === "settings" || viewerOpen) return;

  // slash menu keyboard
  if (els.slashMenu && !els.slashMenu.classList.contains("hidden")) {
    const items = [...els.slashMenu.querySelectorAll(".slash-item")];
    const idx = items.findIndex((el) => el.classList.contains("active"));
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      const n = items[(idx + 1) % items.length];
      items.forEach((el) => el.classList.remove("active"));
      n?.classList.add("active");
      return;
    }
    if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      const n = items[(idx - 1 + items.length) % items.length];
      items.forEach((el) => el.classList.remove("active"));
      n?.classList.add("active");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      items[idx >= 0 ? idx : 0]?.click();
      return;
    }
  }

  if (mode === "command" || cmdMode) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendAi();
    }
    return;
  }

  const items = visibleItems();
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!items.length) return;
    active = (active + 1) % items.length;
    paintActive();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!items.length) return;
    active = (active - 1 + items.length) % items.length;
    paintActive();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    launchActive();
  }
}

async function boot() {
  applyTheme("white");
  try {
    const conversationsPromise = api.getConversations().catch((error) => {
      console.warn("load conversations", error);
      return [];
    });
    const data = await api.getApps();
    mergeIndexedData(data.apps || [], data.recent || []);
    conversations = await conversationsPromise;
    renderConversations();
    // apply settings WITHOUT triggering window mode changes (deferred)
    if (data.settings) {
      const s = data.settings;
      settingsSnap = {
        theme: s.theme || "white",
        homeUi: normalizeHomeUi(s.homeUi || "classic"),
        webSearch: s.webSearch !== false,
        webSearchEngine: s.webSearchEngine || "auto",
        proxyUrl: s.proxyUrl || "http://127.0.0.1:10808",
        proxyEnabledForGoogle: s.proxyEnabledForGoogle !== false,
        hotkey: s.hotkey || "Alt+Q",
        translateModel: s.translateModel || "",
        translateNoThink: s.translateNoThink !== false,
        aiProviders: Array.isArray(s.aiProviders) ? s.aiProviders : [],
        activeProviderId: s.activeProviderId || "",
        aiBaseUrl: s.aiBaseUrl || "",
        aiApiKey: s.aiApiKey || "",
        aiModel: s.aiModel || "gpt-4o-mini",
        conversationPinned: s.conversationPinned === true,
        conversationRetentionHours: s.conversationRetentionHours ?? 0,
        sttMode: s.sttMode || "browser",
        sttLocalBinPath: s.sttLocalBinPath || "",
        sttLocalModelPath: s.sttLocalModelPath || "",
        sttProviderId: s.sttProviderId || "",
        sttModel: s.sttModel || "whisper-1",
        sttLanguage: s.sttLanguage || "auto",
        commandOrder: Array.isArray(s.commandOrder) ? s.commandOrder : [],
        disabledCommands: Array.isArray(s.disabledCommands) ? s.disabledCommands : [],
      };
      syncCommandPreferences();
      ensureProviders();
      for (const p of settingsSnap.aiProviders) {
        const labels = p.modelLabels || p.model_labels || {};
        p.modelLabels = { ...labels };
        delete p.model_labels;
        normalizeProviderConfig(p);
      }
      updateConversationPinButton();
      updateConversationWebButton();
      homeUi = settingsSnap.homeUi;
      document.body.classList.toggle("ui-cards", homeUi === "cards");
      document.body.classList.toggle("ui-classic", homeUi !== "cards");
      if (s.theme) applyTheme(s.theme);
      markHomeUiCards();
      if (els.hotkeyInput) els.hotkeyInput.value = settingsSnap.hotkey || "Alt+Q";
    }
    active = 0;
    render();
    setupPasteImage();
    setupSTT();
    // 功能7：会话保留时间变更 → 持久化
    if (els.conversationRetention) {
      els.conversationRetention.addEventListener("change", async () => {
        settingsSnap.conversationRetentionHours = Number(els.conversationRetention.value) || 0;
        await api.setSettings(settingsPayload());
      });
    }
    // defer window mode + dropdown init to next tick so render is not blocked
    requestAnimationFrame(() => {
      if (homeUi === "cards") {
        api.enterCardsMode?.().catch(() => {});
      } else {
        api.enterLauncherMode?.().catch(() => {});
      }
      scheduleFit();
      if (window.CustomDropdown) window.CustomDropdown.mountAll();
      els.q?.focus();
      // 功能7：自动恢复最近的有效会话
      if (conversations.length > 0) {
        restoreLastConversation(conversations, settingsSnap, openConversation);
      }
    });
  } catch (e) {
    console.warn("boot", e);
  }
}

function setupDrag() {
  document
    .querySelectorAll(".drag-bar, .cards-chrome-left, .settings-sidebar-header, .settings-main-drag-region, .provider-dialog-header, .conversation-topbar")
    .forEach((region) => {
      region.addEventListener("mousedown", async (event) => {
        if (event.button !== 0) return;
        if (event.target.closest("button, input, select, textarea, a, [data-no-drag]")) return;
        try {
          await api.startWindowDrag?.();
        } catch (error) {
          console.warn("drag", error);
        }
      });
    });
}

els.q.addEventListener("input", () => {
  active = 0;
  render();
});

els.btnSettings?.addEventListener("click", () => showPage("settings"));
els.btnBack?.addEventListener("click", backFromSettings);
els.btnAiStop?.addEventListener("click", stopAi);
els.btnViewerBack?.addEventListener("click", () => closeViewer());
els.btnViewerCopy?.addEventListener("click", () => copyViewerAll());
els.btnAiMore?.addEventListener("click", () => {
  setAiMoreMenu(!els.aiMoreMenu?.classList.contains("is-open"));
});
els.aiMenuNew?.addEventListener("click", () => {
  setAiMoreMenu(false);
  startNewConversation();
});
els.aiMenuFollowup?.addEventListener("click", () => {
  setAiMoreMenu(false);
  startFollowup();
});
els.aiMenuHistory?.addEventListener("click", () => {
  setAiMoreMenu(false);
  setConversationPanel(true);
});
els.aiMenuMode?.addEventListener("click", () => {
  enterConversationMode();
});
els.btnConversationBack?.addEventListener("click", exitConversationMode);
els.btnConversationPin?.addEventListener("click", toggleConversationPin);
els.btnConversationNew?.addEventListener("click", startNewConversation);
els.btnConversationHistory?.addEventListener("click", () => {
  setConversationDrawer(!els.conversationHistoryDrawer?.classList.contains("is-open"));
});
els.btnConversationHistoryClose?.addEventListener("click", () => setConversationDrawer(false));
els.conversationModelButton?.addEventListener("click", () => {
  conversationMenuView = "main";
  renderConversationModels();
  setConversationModelMenu(!els.conversationModelMenu?.classList.contains("is-open"));
});
els.conversationWebButton?.addEventListener("click", toggleWebSearch);
els.quickWebButton?.addEventListener("click", toggleWebSearch);
els.conversationJumpBottom?.addEventListener("click", () => {
  if (!els.aiThread) return;
  els.aiThread.scrollTop = els.aiThread.scrollHeight;
  updateConversationJumpBottom();
});
els.aiThread?.addEventListener("scroll", updateConversationJumpBottom, { passive: true });
els.btnConversationAttach?.addEventListener("click", () => els.conversationFileInput?.click());
els.conversationFileInput?.addEventListener("change", () => addConversationAttachments(els.conversationFileInput.files));
els.conversationInput?.addEventListener("input", () => {
  const parsed = parseSlashInput(els.conversationInput.value);
  if (parsed?.kind === "mode") {
    if (parsed.def.surface === "custom") {
      enterStandaloneModeFromConversation(parsed.def, parsed.body);
      return;
    }
    cmdMode = parsed.def.id;
    mode = "command";
    els.conversationInput.value = parsed.body;
  }
  updateConversationComposer();
});
els.conversationInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    els.conversationForm?.requestSubmit();
  }
});
els.conversationForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (aiBusy) {
    stopAi();
    return;
  }
  if (!els.conversationInput?.value.trim() && pendingAttachments.length === 0) return;
  sendAi();
});
els.btnCloseConversations?.addEventListener("click", () => setConversationPanel(false));
document.addEventListener("mousedown", (event) => {
  if (!event.target.closest(".conversation-model-picker")) setConversationModelMenu(false);
  if (els.aiMoreMenu?.classList.contains("is-open") && !els.aiMoreWrap?.contains(event.target)) {
    setAiMoreMenu(false);
  }
  if (els.conversationPanel?.classList.contains("hidden")) return;
  if (event.target.closest(".conversation-dialog")) return;
  setConversationPanel(false);
});
els.btnBuiltinAi?.addEventListener("click", () => {
  enterCommandMode("ai", { clearBody: true, keepHistory: false });
});
els.btnBuiltinFy?.addEventListener("click", () => {
  enterCommandMode("fy", { clearBody: true, keepHistory: false });
});
els.btnBuiltinFile?.addEventListener("click", () => {
  enterCommandMode("file", { clearBody: true, keepHistory: false });
});
els.btnRemoveRecent?.addEventListener("click", removeRecentTarget);
document.addEventListener("pointerdown", (event) => {
  if (!els.recentContextMenu?.contains(event.target)) closeRecentContextMenu();
});
els.themeGrid?.addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-card");
  if (!btn) return;
  const t = btn.getAttribute("data-theme");
  if (t) saveTheme(t);
});
els.homeUiGrid?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const btn = e.target.closest("[data-home-ui]");
  if (!btn) return;
  const ui = btn.getAttribute("data-home-ui");
  if (ui) applyHomeUi(ui, { persist: true, preview: true });
});
els.translateModelSelect?.addEventListener("change", async () => {
  settingsSnap.translateModel = els.translateModelSelect.value || "";
  try {
    await api.setSettings(
      settingsPayload({ translateModel: settingsSnap.translateModel })
    );
  } catch (e) {
    console.warn(e);
  }
});
els.translateNoThinkToggle?.addEventListener("change", async () => {
  settingsSnap.translateNoThink = !!els.translateNoThinkToggle.checked;
  try {
    await api.setSettings(
      settingsPayload({ translateNoThink: settingsSnap.translateNoThink })
    );
  } catch (e) {
    console.warn(e);
  }
});
els.webEngineSelect?.addEventListener("change", async () => {
  settingsSnap.webSearchEngine = els.webEngineSelect.value || "auto";
  try {
    await api.setSettings(settingsPayload({ webSearchEngine: settingsSnap.webSearchEngine }));
  } catch (e) {
    console.warn(e);
  }
});
els.proxyUrlInput?.addEventListener("change", async () => {
  let v = (els.proxyUrlInput.value || "").trim() || "http://127.0.0.1:10808";
  if (!/^https?:\/\//i.test(v) && !/^socks5:\/\//i.test(v)) v = `http://${v}`;
  settingsSnap.proxyUrl = v;
  els.proxyUrlInput.value = v;
  try {
    await api.setSettings(settingsPayload({ proxyUrl: v }));
    refreshProxyStatus();
  } catch (e) {
    console.warn(e);
  }
});
els.btnAddAppScanPath?.addEventListener("click", pickAppScanPath);
els.appScanPathInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addAppScanPath();
});
els.appScanDepth?.addEventListener("change", saveAppScanDepth);
els.btnManageProviders?.addEventListener("click", () => openProviderManager());
els.btnSetActiveProvider?.addEventListener("click", () => {
  commitEditorToSnap();
  settingsSnap.activeProviderId = editingProviderId;
  updateUseProviderBtn();
  fillSettingsForm();
  if (els.aiSaveMsg) els.aiSaveMsg.textContent = "已设为当前供应商，保存后生效";
});
els.btnRefreshIndex?.addEventListener("click", async () => {
  const oldText = els.btnRefreshIndex.textContent;
  els.btnRefreshIndex.disabled = true;
  els.btnRefreshIndex.textContent = "同步中…";
  try {
    await api.refreshIndex?.();
    const data = await api.getApps();
    mergeIndexedData(data.apps || apps, data.recent || recent);
    render();
  } catch (e) {
    console.warn(e);
  } finally {
    window.setTimeout(() => {
      els.btnRefreshIndex.disabled = false;
      els.btnRefreshIndex.textContent = oldText || "同步";
    }, 600);
  }
});
const openDir = () => api.openDataDir?.().catch((e) => console.warn(e));
els.btnOpenDataDir?.addEventListener("click", openDir);
els.btnOpenDataDir2?.addEventListener("click", openDir);
els.btnCardsMin?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  api.minimize?.();
});
els.btnCardsMax?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  api.toggleMaximizeWindow?.();
});
els.btnCardsClose?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (viewerOpen) {
    closeViewer();
    return;
  }
  api.hide?.();
});
els.btnAddProvider?.addEventListener("click", () => addProvider());
els.btnDelProvider?.addEventListener("click", () => deleteProvider());
els.btnPickModel?.addEventListener("click", () => fetchAndPickModels());
els.btnSaveAi?.addEventListener("click", () => saveProviderManual());
els.btnAddModel?.addEventListener("click", () => addModelManual());
els.btnCloseProvider?.addEventListener("click", requestCloseProviderManager);
els.btnCancelProvider?.addEventListener("click", requestCloseProviderManager);
els.btnProviderContinue?.addEventListener("click", () => setProviderCancelConfirm(false));
els.btnProviderConfirmCancel?.addEventListener("click", () => closeProviderManager({ discard: true }));
els.providerCancelConfirm?.addEventListener("mousedown", (event) => {
  if (event.target === els.providerCancelConfirm) setProviderCancelConfirm(false);
});
els.pvAddModel?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addModelManual();
  }
});
els.pvModelLabel?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addModelManual();
  }
});

// hotkey capture
function eventToHotkey(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Win");
  const k = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(k)) return null;
  let key = k;
  if (k === " ") key = "Space";
  else if (k.length === 1) key = k.toUpperCase();
  else if (k.startsWith("F") && k.length <= 3) key = k.toUpperCase();
  else key = k;
  parts.push(key);
  if (parts.length < 2 && !/^F\d+$/i.test(key)) {
    // require modifier except bare F-keys
    return null;
  }
  return parts.join("+");
}

function showSettingsToast(message, kind = "success") {
  if (!els.settingsToast) return;
  if (settingsToastTimer) window.clearTimeout(settingsToastTimer);
  els.settingsToast.textContent = message;
  els.settingsToast.dataset.kind = kind;
  els.settingsToast.hidden = false;
  requestAnimationFrame(() => els.settingsToast?.classList.add("is-visible"));
  settingsToastTimer = window.setTimeout(() => {
    els.settingsToast?.classList.remove("is-visible");
    window.setTimeout(() => {
      if (els.settingsToast && !els.settingsToast.classList.contains("is-visible")) {
        els.settingsToast.hidden = true;
      }
    }, 180);
  }, 1800);
}

function setHotkeySaveState(state) {
  if (!els.btnSaveHotkey) return;
  if (hotkeyFeedbackTimer) window.clearTimeout(hotkeyFeedbackTimer);
  els.btnSaveHotkey.classList.remove("is-saving", "is-saved", "is-error");
  els.btnSaveHotkey.disabled = state === "saving";
  if (state === "saving") {
    els.btnSaveHotkey.classList.add("is-saving");
    els.btnSaveHotkey.textContent = "保存中…";
    return;
  }
  if (state === "saved") {
    els.btnSaveHotkey.classList.add("is-saved");
    els.btnSaveHotkey.textContent = "已保存";
  } else if (state === "error") {
    els.btnSaveHotkey.classList.add("is-error");
    els.btnSaveHotkey.textContent = "保存失败";
  } else {
    els.btnSaveHotkey.textContent = "保存";
    return;
  }
  hotkeyFeedbackTimer = window.setTimeout(() => setHotkeySaveState("idle"), 1400);
}

async function saveHotkey(val) {
  const v = (val || "").trim();
  if (!v) {
    setHotkeySaveState("error");
    showSettingsToast("请输入有效的组合键", "error");
    els.hotkeyInput?.focus();
    return;
  }
  setHotkeySaveState("saving");
  try {
    const res = await api.setHotkey(v);
    const hk = res?.hotkey || v;
    settingsSnap.hotkey = hk;
    if (els.hotkeyInput) {
      els.hotkeyInput.value = hk;
      els.hotkeyInput.classList.remove("capturing");
    }
    hotkeyCapturing = false;
    setHotkeySaveState("saved");
    showSettingsToast(`全局热键已保存：${hk}`);
  } catch (e) {
    setHotkeySaveState("error");
    showSettingsToast(`热键设置失败：${e?.message || e}`, "error");
    els.hotkeyInput?.focus();
  }
}

els.hotkeyInput?.addEventListener("focus", () => {
  hotkeyCapturing = true;
  els.hotkeyInput.classList.add("capturing");
  els.hotkeyInput.placeholder = "按下组合键…";
  els.hotkeyInput.select();
});
els.hotkeyInput?.addEventListener("blur", () => {
  hotkeyCapturing = false;
  els.hotkeyInput?.classList.remove("capturing");
  els.hotkeyInput.placeholder = "Alt+Q";
});
els.hotkeyInput?.addEventListener("keydown", (e) => {
  if (!hotkeyCapturing && e.target !== els.hotkeyInput) return;
  if (e.key === "Enter") {
    e.preventDefault();
    saveHotkey(els.hotkeyInput.value);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    els.hotkeyInput.blur();
    return;
  }
  const hk = eventToHotkey(e);
  if (!hk) return;
  e.preventDefault();
  e.stopPropagation();
  els.hotkeyInput.value = hk;
});
els.btnSaveHotkey?.addEventListener("click", () => saveHotkey(els.hotkeyInput?.value));
els.pvFormat?.addEventListener("change", () => {
  commitEditorToSnap();
  if (els.aiSaveMsg) els.aiSaveMsg.textContent = "接口格式已修改，保存后生效";
});

window.addEventListener("keydown", onKey);

api.onShow?.(() => {
  active = 0;
  setAiMoreMenu(false);
  setConversationPanel(false);
  if (page === "settings") {
    els.pageSettings?.classList.remove("hidden");
    return;
  }
  if (conversationModeOpen) {
    els.pageConversation?.classList.remove("hidden");
    api.setConversationActive?.(true).catch(() => {});
    renderThread({ streaming: aiBusy });
    requestAnimationFrame(() => els.conversationInput?.focus());
    return;
  }
  if (els.providerPanel && !els.providerPanel.hidden) {
    closeProviderManager({ discard: true });
  }
  if (viewerOpen) closeViewer();
  exitCommandMode();
  showPage("main");
  requestAnimationFrame(() => {
    render();
    scheduleFit();
    els.q?.focus();
  });
});

api.onAppsUpdated?.(async () => {
  // backend finished indexing — pull fresh data (non-blocking now)
  try {
    const data = await api.getApps();
    mergeIndexedData(data?.apps || apps, data?.recent || recent);
    if (data?.settings) applySettingsSnap(data.settings);
    pendingIconTargets.clear();
    for (const target of [...requestedIconTargets]) {
      const item = [...apps, ...recent].find((entry) => entry.target === target);
      if (!item?.icon) requestedIconTargets.delete(target);
    }
    render();
  } catch (e) {
    console.warn("apps-updated refresh", e);
  }
});

chatRuntime.on("tool", (payload) => {
  upsertToolRow(typeof payload === "object" ? payload : {});
});

chatRuntime.on("chunk", (payload) => {
  const text =
    typeof payload === "string"
      ? payload
      : payload?.text || payload?.delta || "";
  streamingAssistant += text;
  if (els.aiStatus) els.aiStatus.textContent = "";
  const hasDedicatedResult = typeof currentModeDef()?.renderResult === "function";
  if (!hasDedicatedResult) {
    scheduleStreamingRender();
  } else {
    renderThread({ streaming: true });
  }
});

chatRuntime.on("done", () => {
  if (aiErrorFlag) {
    aiErrorFlag = false;
    return;
  }
  const wasStopped = aiStopping;
  aiBusy = false;
  aiStopping = false;
  if (streamRenderFrame) {
    cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = 0;
  }
  const content = streamingAssistant || (wasStopped ? "" : "(空回复)");
  if (content) chatHistory.push({ role: "assistant", content });
  streamingAssistant = "";
  persistCurrentConversation().catch((error) => console.warn("save conversation", error));
  if (els.aiStatus) els.aiStatus.textContent = "";
  renderThread({ streaming: false });
  render();
  updateConversationComposer();
});

let aiErrorFlag = false;
chatRuntime.on("error", (payload) => {
  aiBusy = false;
  aiStopping = false;
  if (streamRenderFrame) {
    cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = 0;
  }
  aiErrorFlag = true;
  streamingAssistant = "";
  const msg =
    typeof payload === "string"
      ? payload
      : payload?.message || payload?.error || "未知错误";
  if (els.aiStatus) els.aiStatus.textContent = "失败";
  renderThread({ streaming: false, errorText: msg });
  render();
  updateConversationComposer();
});

setupDrag();
setupRecentDrag();
setupLauncherResizeRendering();
enhanceSettingsDescriptions();
boot();
