import { commandRegistry } from "../registry.js";
import { createLifecycle, listen } from "../../shared/dom.js";
import { loadStyle, mountTemplate } from "../../shared/template.js";

await loadStyle(new URL("./styles.css", import.meta.url));

const FILE_OPEN_MODE_KEY = "flux.file-open-mode";
const FILE_ALLOW_ACCESS_KEY = "flux.file-allow-access";

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

export const fileCommand = commandRegistry.register({
  id: "file",
  aliases: [],
  label: "/file",
  title: "文件路径",
  displayPrefix: "File:",
  placeholder: "输入本地文件路径后 Enter",
  followPlaceholder: "继续输入文件路径…",
  inputPrefix: "File:",
  resultKind: "file",
  surface: "custom",
  run(value, api, options) {
    return api.openFileUrl(toFileUrl(value), options);
  },
  async mount(host) {
    await mountTemplate(host, new URL("./view.html", import.meta.url));
    const root = host.querySelector(".file-section");
    const modeAuto = host.querySelector('[data-file-mode="auto"]');
    const modeBrowser = host.querySelector('[data-file-mode="browser"]');
    const allowAccess = host.querySelector("[data-file-allow-access]");
    const accessOption = host.querySelector("[data-file-access-option]");
    const status = host.querySelector("[data-file-status]");
    const lifecycle = createLifecycle();
    let openMode = localStorage.getItem(FILE_OPEN_MODE_KEY) === "browser" ? "browser" : "auto";
    let allowFileAccess = localStorage.getItem(FILE_ALLOW_ACCESS_KEY) === "true";

    function render() {
      const browserMode = openMode === "browser";
      modeAuto?.setAttribute("aria-pressed", String(!browserMode));
      modeBrowser?.setAttribute("aria-pressed", String(browserMode));
      if (allowAccess) {
        allowAccess.checked = allowFileAccess;
        allowAccess.disabled = !browserMode;
      }
      accessOption?.classList.toggle("is-disabled", !browserMode);
    }

    function setOpenMode(nextMode) {
      openMode = nextMode === "browser" ? "browser" : "auto";
      localStorage.setItem(FILE_OPEN_MODE_KEY, openMode);
      render();
    }

    function setAllowFileAccess(enabled) {
      allowFileAccess = !!enabled;
      localStorage.setItem(FILE_ALLOW_ACCESS_KEY, String(allowFileAccess));
      render();
    }

    listen(modeAuto, "click", () => setOpenMode("auto"), undefined, lifecycle.signal);
    listen(modeBrowser, "click", () => setOpenMode("browser"), undefined, lifecycle.signal);
    listen(allowAccess, "change", () => setAllowFileAccess(allowAccess.checked), undefined, lifecycle.signal);
    render();

    return {
      root,
      get openMode() {
        return openMode;
      },
      get allowFileAccess() {
        return allowFileAccess;
      },
      render,
      setVisible(visible) {
        root?.classList.toggle("hidden", !visible);
      },
      setStatus(message) {
        if (status) status.textContent = message || "";
      },
      getRunOptions() {
        return { mode: openMode, allowFileAccess };
      },
      onRunSuccess() {
        if (status) status.textContent = openMode === "browser" ? "已在浏览器打开" : "已打开";
      },
      onRunError(error) {
        if (status) status.textContent = error?.message || String(error);
      },
      unmount() {
        lifecycle.dispose();
        host.replaceChildren();
      },
    };
  },
  defaultOrder: 30,
});
