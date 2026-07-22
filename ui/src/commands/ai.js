(function (commands) {
  "use strict";

  commands.register({
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
})(window.FluxCommands);
