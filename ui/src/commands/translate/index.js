import { commandRegistry } from "../registry.js";
import { createLifecycle, listen } from "../../shared/dom.js";
import { loadStyle, mountTemplate } from "../../shared/template.js";

await loadStyle(new URL("./styles.css", import.meta.url));

function parseResult(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let value = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) value = value.slice(start, end + 1);
  try {
    const payload = JSON.parse(value);
    if (!payload || typeof payload !== "object") return null;
    return {
      q: String(payload.q || ""),
      to: String(payload.to || ""),
      dir: String(payload.dir || ""),
      type: String(payload.type || "").toLowerCase(),
      mean: String(payload.mean || ""),
      from: String(payload.from || ""),
      ex: {
        en: String(payload.ex?.en || payload.ex_en || ""),
        zh: String(payload.ex?.zh || payload.ex_zh || ""),
      },
    };
  } catch {
    return { q: "", to: raw, dir: "", type: "", mean: "", from: "", ex: { en: "", zh: "" } };
  }
}

function renderResult(payload, options = {}) {
  const { streaming = false } = options;
  const isWord = payload.type === "word" || (!payload.type && (payload.q || "").split(/\s+/).filter(Boolean).length <= 8 && (payload.q || "").length <= 30);
  const card = document.createElement("div");
  card.className = "fy-card" + (streaming ? " streaming" : "") + (!isWord ? " fy-sentence" : "");

  const top = document.createElement("div");
  top.className = "fy-row-top";
  const direction = document.createElement("span");
  direction.className = "fy-dir";
  direction.textContent = payload.dir || (streaming ? "…" : "—");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "fy-copy";
  copy.textContent = "复制";
  copy.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(payload.to || "");
      copy.textContent = "已复制";
    } catch {
      copy.textContent = "失败";
    }
    setTimeout(() => (copy.textContent = "复制"), 900);
  });
  top.appendChild(direction);
  if (payload.to && !streaming) top.appendChild(copy);

  const translated = document.createElement("p");
  translated.className = "fy-to";
  translated.textContent = payload.to || (streaming ? "" : "（无译文）");
  card.append(top, translated);

  if (isWord) {
    const appendSection = (label, rows) => {
      const available = rows.filter(([, value]) => value);
      if (!available.length) return;
      const section = document.createElement("div");
      section.className = "fy-sec";
      const heading = document.createElement("div");
      heading.className = "fy-k";
      heading.textContent = label;
      section.appendChild(heading);
      for (const [className, value] of available) {
        const content = document.createElement(className === "fy-v" ? "p" : "div");
        content.className = className;
        content.textContent = value;
        section.appendChild(content);
      }
      card.appendChild(section);
    };
    appendSection("含义", [["fy-v", payload.mean]]);
    appendSection("例句", [
      ["fy-ex-en", payload.ex?.en],
      ["fy-ex-zh", payload.ex?.zh],
    ]);
    appendSection("由来", [["fy-v", payload.from]]);
  }
  return card;
}

function formatHistoryTime(value) {
  return new Date(Number(value) || Date.now()).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHistoryList(container, conversations, currentId, onOpen, onDelete, signal) {
  container.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("div");
    empty.className = "conversation-empty";
    empty.textContent = "暂无翻译历史";
    container.appendChild(empty);
    return;
  }
  for (const conversation of conversations) {
    const row = document.createElement("div");
    row.className = `conversation-row${conversation.id === currentId ? " is-active" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "conversation-open";
    const title = document.createElement("div");
    title.className = "conversation-title";
    title.textContent = conversation.title || "新翻译";
    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    meta.textContent = `翻译 · ${formatHistoryTime(conversation.updatedAt)}`;
    open.append(title, meta);
    listen(open, "click", () => onOpen(conversation), undefined, signal);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "conversation-delete";
    remove.textContent = "×";
    remove.title = "删除翻译";
    remove.setAttribute("aria-label", "删除翻译");
    listen(remove, "click", (event) => {
      event.stopPropagation();
      onDelete(conversation.id);
    }, undefined, signal);
    row.append(open, remove);
    container.appendChild(row);
  }
}

export const translateCommand = commandRegistry.register({
  id: "fy",
  aliases: ["tr", "translate", "fanyi"],
  label: "/fy",
  title: "翻译",
  displayPrefix: "Translate",
  placeholder: "输入词语或句子 · Enter 翻译",
  followPlaceholder: "继续翻译…",
  resultKind: "translate",
  system: '你是词典式翻译助手。根据用户输入自动判断方向（中↔英）。直接输出一个 JSON 对象，不要思考过程，不要 markdown 代码块，不要任何解释说明，只输出 JSON。字段：{"q":"原文","to":"译文（必填）","dir":"en → zh 或 zh → en","type":"word 或 sentence","mean":"含义/释义（type=word时必填，sentence时空字符串）","ex":{"en":"英文例句","zh":"例句中文"},"from":"词源或由来，可空"}。type 为 word 时给出 mean/ex/from；type 为 sentence 时 mean/ex/from 留空，只需 to。',
  parseResult,
  renderResult,
  async mountQuickActions(host, context) {
    await mountTemplate(host, new URL("./quick-actions.html", import.meta.url));
    const lifecycle = createLifecycle();
    const root = host.querySelector(".fy-quick-actions");
    const more = root?.querySelector("[data-fy-more]");
    const menu = root?.querySelector("[data-fy-more-menu]");
    const newTranslation = root?.querySelector("[data-fy-new]");
    const history = root?.querySelector("[data-fy-history]");
    const panel = root?.querySelector("[data-fy-history-panel]");
    const close = root?.querySelector("[data-fy-history-close]");
    const list = root?.querySelector("[data-fy-history-list]");
    let conversations = [];

    function setMenu(open) {
      const visible = !!open;
      menu?.classList.toggle("is-open", visible);
      menu?.setAttribute("aria-hidden", String(!visible));
      more?.setAttribute("aria-expanded", String(visible));
    }

    function setPanel(open) {
      const visible = !!open;
      panel?.classList.toggle("hidden", !visible);
      history?.setAttribute("aria-expanded", String(visible));
      if (visible) renderHistoryList(list, conversations, context.getCurrentConversationId(), openConversation, deleteConversation, lifecycle.signal);
    }

    function openConversation(conversation) {
      setPanel(false);
      context.openConversation(conversation);
    }

    async function deleteConversation(id) {
      try {
        conversations = await context.api.deleteTranslationConversation(id);
        context.clearCurrentConversationId(id);
        renderHistoryList(list, conversations, context.getCurrentConversationId(), openConversation, deleteConversation, lifecycle.signal);
      } catch (error) {
        console.warn("delete translation conversation", error);
      }
    }

    async function openHistory() {
      try {
        conversations = await context.api.getTranslationConversations();
      } catch (error) {
        console.warn("load translation conversations", error);
        conversations = [];
      }
      setMenu(false);
      setPanel(true);
    }

    listen(more, "click", () => setMenu(!menu?.classList.contains("is-open")), undefined, lifecycle.signal);
    listen(newTranslation, "click", () => {
      setMenu(false);
      context.startNewConversation();
    }, undefined, lifecycle.signal);
    listen(history, "click", openHistory, undefined, lifecycle.signal);
    listen(close, "click", () => setPanel(false), undefined, lifecycle.signal);
    listen(document, "mousedown", (event) => {
      if (menu?.classList.contains("is-open") && !root?.contains(event.target)) setMenu(false);
      if (!panel?.classList.contains("hidden") && !panel.querySelector(".conversation-dialog")?.contains(event.target)) {
        setPanel(false);
      }
    }, undefined, lifecycle.signal);

    return {
      setVisible(visible) {
        if (!visible) {
          setMenu(false);
          setPanel(false);
        }
      },
      onEscape() {
        if (!panel?.classList.contains("hidden")) {
          setPanel(false);
          return true;
        }
        if (menu?.classList.contains("is-open")) {
          setMenu(false);
          more?.focus();
          return true;
        }
        return false;
      },
      unmount() {
        lifecycle.dispose();
        host.replaceChildren();
      },
    };
  },
  defaultOrder: 20,
});
