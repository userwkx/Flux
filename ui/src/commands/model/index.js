import { commandRegistry } from "../registry.js";

/**
 * /model — 切换 AI 模型
 * resultKind 为 "model"，enterCommandMode() 检测到后跳转 AI 设置面板
 */
export const modelCommand = commandRegistry.register({
  id: "model",
  aliases: ["switch-model", "ai-model"],
  label: "/model",
  title: "切换 AI 模型",
  displayPrefix: "模型:",
  placeholder: "按 Enter 切换模型",
  resultKind: "model",
  surface: "standalone",
  system: null,
  defaultOrder: 31,
});
