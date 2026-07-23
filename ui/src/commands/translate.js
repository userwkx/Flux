import { commandRegistry } from "./registry.js";

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

commandRegistry.register({
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
  defaultOrder: 20,
});
