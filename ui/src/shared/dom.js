export function byId(root, id) {
  if (!root) return null;
  if (root instanceof Document) return root.getElementById(id);
  return root.querySelector(`#${CSS.escape(id)}`);
}

export function listen(target, type, handler, options, signal) {
  if (!target) return;
  if (!signal) {
    target.addEventListener(type, handler, options);
    return;
  }
  const normalized = typeof options === "boolean" ? { capture: options } : { ...(options || {}) };
  normalized.signal = signal;
  target.addEventListener(type, handler, normalized);
}

export function createLifecycle() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    dispose: () => controller.abort(),
  };
}
