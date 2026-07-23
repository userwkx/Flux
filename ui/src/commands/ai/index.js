import { commandRegistry } from "../registry.js";
import { loadStyle } from "../../shared/template.js";

await loadStyle(new URL("./styles.css", import.meta.url));

export const aiCommand = commandRegistry.register({
  id: "ai",
  aliases: ["chat", "ask"],
  label: "/ai",
  title: "AI 对话",
  displayPrefix: "AI:",
  placeholder: "输入问题后 Enter · Esc 返回",
  followPlaceholder: "输入追问后 Enter",
  resultKind: "chat",
  system: null,
  defaultOrder: 10,
});
