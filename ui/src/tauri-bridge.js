/** Small facade over the Tauri global API used by the UI. */
(function () {
  function getTauri() {
    return window.__TAURI__ || null;
  }

  async function invoke(cmd, args) {
    const t = getTauri();
    if (!t || !t.core || !t.core.invoke) {
      throw new Error("Tauri API not available");
    }
    return t.core.invoke(cmd, args || {});
  }

  function listen(event, cb) {
    const t = getTauri();
    if (!t || !t.event) return () => {};
    let unlisten = null;
    t.event.listen(event, (e) => cb(e.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }

  async function win() {
    const t = getTauri();
    if (t?.window?.getCurrentWindow) return t.window.getCurrentWindow();
    return null;
  }

  window.launcher = {
    getApps: () => invoke("get_apps"),
    getAppIcons: (targets) => invoke("get_app_icons", { targets }),
    reorderRecent: (targets) => invoke("reorder_recent", { targets }),
    getConversations: () => invoke("get_conversations"),
    saveConversation: (conversation) =>
      invoke("save_conversation", { conversation }),
    deleteConversation: (id) => invoke("delete_conversation", { id }),
    saveAttachment: (upload) => invoke("save_attachment", { upload }),
    setConversationPin: (pinned) => invoke("set_conversation_pin", { pinned }),
    setSettings: (patch) => invoke("set_settings", { patch }),
    launch: (app) => invoke("launch_app", { item: app }),
    hide: () => invoke("hide_window"),
    startWindowDrag: () => invoke("start_window_drag"),
    resize: (width, height) => invoke("resize_window", { width, height }),
    enterViewerMode: () => invoke("enter_viewer_mode"),
    leaveViewerMode: () => invoke("leave_viewer_mode"),
    enterCardsMode: () => invoke("enter_cards_mode"),
    enterLauncherMode: () => invoke("enter_launcher_mode"),
    enterSettingsMode: () => invoke("enter_settings_mode"),
    toggleMaximizeWindow: () => invoke("toggle_maximize_window"),
    openDataDir: () => invoke("open_data_dir"),
    proxyStatus: () => invoke("proxy_status"),
    refreshIndex: () => invoke("refresh_app_index"),
    setHotkey: (hotkey) => invoke("set_hotkey", { hotkey }),
    aiChat: (messages, options) =>
      invoke("ai_chat", { messages, options: options || null }),
    stopAi: () => invoke("stop_ai"),
    aiFetchModels: (provider) =>
      invoke("ai_fetch_models", provider ? { provider } : {}),
    minimize: async () => {
      const w = await win();
      if (w?.minimize) return w.minimize();
    },
    onShow: (cb) => listen("window-shown", cb),
    onAppsUpdated: (cb) => listen("apps-updated", cb),
    onAiChunk: (cb) => listen("ai-chunk", cb),
    onAiDone: (cb) => listen("ai-done", cb),
    onAiError: (cb) => listen("ai-error", cb),
    onAiTool: (cb) => listen("ai-tool", cb),
  };
})();
