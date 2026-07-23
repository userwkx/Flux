export function createChatRuntime(api) {
  const listeners = new Map([
    ["chunk", new Set()],
    ["done", new Set()],
    ["error", new Set()],
    ["tool", new Set()],
  ]);

  function emit(type, payload) {
    for (const listener of listeners.get(type) || []) listener(payload);
  }

  const disposeBridgeListeners = [
    api.onAiChunk?.((payload) => emit("chunk", payload)),
    api.onAiDone?.((payload) => emit("done", payload)),
    api.onAiError?.((payload) => emit("error", payload)),
    api.onAiTool?.((payload) => emit("tool", payload)),
  ].filter(Boolean);

  return {
    send(messages, options) {
      return api.aiChat(messages, options);
    },
    stop() {
      return api.stopAi?.();
    },
    on(type, listener) {
      const bucket = listeners.get(type);
      if (!bucket) throw new Error(`未知聊天事件: ${type}`);
      bucket.add(listener);
      return () => bucket.delete(listener);
    },
    dispose() {
      for (const dispose of disposeBridgeListeners) dispose();
      for (const bucket of listeners.values()) bucket.clear();
    },
  };
}
