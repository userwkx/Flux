/**
 * 功能10：修复打开窗口后直接输入触发系统提示音
 *
 * 原理：拦截全局 keydown 事件，当焦点不在任何可输入元素上时，
 * 阻止默认行为（系统 Beep），将焦点重定向到正确的输入框，
 * 并将按键字符填入。
 *
 * 三种场景：
 * 1. Launcher 主页 → 聚焦 #q 搜索框
 * 2. Conversation 模式 → 聚焦 #conversation-input
 * 3. Settings/Viewer → 不拦截（这些页面有独立的键盘操作）
 */

export function setupBeepFix(getState) {
  if (typeof document === "undefined") return;

  document.addEventListener("keydown", (event) => {
    // 只处理可打印字符（字母、数字、符号），排除功能键
    if (event.key.length !== 1) return;
    // 排除组合键
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    const tag = target?.tagName;

    // 焦点已经在可输入元素上 → 不拦截
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    // 焦点在 contentEditable 元素上 → 不拦截
    if (target?.isContentEditable) return;
    // 焦点在选择框或按钮上 → 不拦截
    if (tag === "SELECT" || tag === "BUTTON") return;

    const state = getState();
    // Settings 页面和 Viewer 不拦截
    if (state.page === "settings" || state.viewerOpen) return;

    event.preventDefault();

    // 决定聚焦哪个输入框
    const input = state.conversationModeOpen
      ? document.getElementById("conversation-input")
      : document.getElementById("q");

    if (input) {
      input.focus();
      // 插入键入的字符
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value =
        input.value.slice(0, start) + event.key + input.value.slice(end);
      // 更新光标位置
      const pos = start + 1;
      input.setSelectionRange(pos, pos);
      // 触发 input 事件（让 app.js 的输入监听器响应）
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
