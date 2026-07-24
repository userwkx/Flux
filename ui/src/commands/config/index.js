import { commandRegistry } from "../registry.js";

/**
 * /config — 打开设置页面
 * resultKind 为 "settings"，enterCommandMode() 检测到后直接跳转设置页
 */
export const configCommand = commandRegistry.register({
  id: "config",
  aliases: ["settings", "prefs"],
  label: "/config",
  title: "打开设置",
  displayPrefix: "设置:",
  placeholder: "按 Enter 打开设置",
  resultKind: "settings",
  surface: "standalone",
  system: null,
  defaultOrder: 30,
});
