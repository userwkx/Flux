const FILE_OPEN_MODE_KEY = "flux.file-open-mode";
const FILE_ALLOW_ACCESS_KEY = "flux.file-allow-access";

export function createFileModeController(els) {
  let openMode = localStorage.getItem(FILE_OPEN_MODE_KEY) === "browser" ? "browser" : "auto";
  let allowFileAccess = localStorage.getItem(FILE_ALLOW_ACCESS_KEY) === "true";

  function render() {
    const browserMode = openMode === "browser";
    els.fileModeAuto?.setAttribute("aria-pressed", String(!browserMode));
    els.fileModeBrowser?.setAttribute("aria-pressed", String(browserMode));
    if (els.fileAllowFileAccess) {
      els.fileAllowFileAccess.checked = allowFileAccess;
      els.fileAllowFileAccess.disabled = !browserMode;
    }
    els.fileAccessOption?.classList.toggle("is-disabled", !browserMode);
    if (els.fileModeNote) {
      els.fileModeNote.textContent = browserMode
        ? "浏览器模式会使用 Chromium 打开本地文件。"
        : "自动模式会交给 Windows 的默认关联程序打开。";
    }
  }

  return {
    get openMode() { return openMode; },
    get allowFileAccess() { return allowFileAccess; },
    render,
    setOpenMode(nextMode) {
      openMode = nextMode === "browser" ? "browser" : "auto";
      localStorage.setItem(FILE_OPEN_MODE_KEY, openMode);
      render();
    },
    setAllowFileAccess(enabled) {
      allowFileAccess = !!enabled;
      localStorage.setItem(FILE_ALLOW_ACCESS_KEY, String(allowFileAccess));
      render();
    },
  };
}
