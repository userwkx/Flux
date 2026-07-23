import { commandRegistry } from "./registry.js";

function encodePathSegments(path, separator) {
  return path.split(separator).map((segment) => encodeURIComponent(segment)).join("/");
}

function toFileUrl(value) {
    let raw = String(value || "").trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1).trim();
    }
    if (!raw) throw new Error("请输入文件路径");
    if (/^file:/i.test(raw)) {
      try {
        return new URL(raw).href;
      } catch {
        throw new Error("file URL 格式无效");
      }
    }
    const drive = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
    if (drive) return `file:///${drive[1].toUpperCase()}:/${encodePathSegments(drive[2], /[\\/]/)}`;
    const unc = raw.match(/^\\\\([^\\/]+)[\\/](.*)$/);
    if (unc) return `file://${encodeURIComponent(unc[1])}/${encodePathSegments(unc[2], /[\\/]/)}`;
    if (raw.startsWith("/")) return `file://${encodePathSegments(raw, "/")}`;
    throw new Error("请输入绝对路径，例如 C:\\Users\\name\\file.txt");
}

commandRegistry.register({
  id: "file",
  aliases: [],
  label: "/file",
  title: "文件路径",
  displayPrefix: "File:",
  placeholder: "输入本地文件路径后 Enter",
  followPlaceholder: "继续输入文件路径…",
  inputPrefix: "File:",
  resultKind: "file",
  run(value, api, options) {
    return api.openFileUrl(toFileUrl(value), options);
  },
  defaultOrder: 30,
});
