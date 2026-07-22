(function (commands) {
  "use strict";

  function encodePathSegments(path, separator) {
    return path.split(separator).map((segment) => encodeURIComponent(segment)).join("/");
  }

  function toFileUrl(value) {
    let raw = String(value || "").trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1).trim();
    }
    if (!raw) throw new Error("请输入文件路径");
    if (/^file:\/\//i.test(raw)) return raw;
    const drive = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
    if (drive) return `file:///${drive[1].toUpperCase()}:/${encodePathSegments(drive[2], /[\\/]/)}`;
    const unc = raw.match(/^\\\\([^\\/]+)[\\/](.*)$/);
    if (unc) return `file://${encodeURIComponent(unc[1])}/${encodePathSegments(unc[2], /[\\/]/)}`;
    if (raw.startsWith("/")) return `file://${encodePathSegments(raw, "/")}`;
    throw new Error("请输入绝对路径，例如 C:\\Users\\name\\file.txt");
  }

  commands.register({
    id: "file",
    aliases: [],
    label: "/file",
    title: "文件路径",
    displayPrefix: "File:",
    placeholder: "输入本地文件路径后 Enter",
    followPlaceholder: "继续输入文件路径…",
    resultKind: "chat",
    inputPrefix: "File:",
    system: "用户会提供一个本地 file URL。请结合路径信息回答用户问题；不要声称已经读取你无法访问的文件内容。",
    preprocessInput(value) {
      return `File: ${toFileUrl(value)}`;
    },
    defaultOrder: 30,
  });
})(window.FluxCommands);
