export function createCommandHost({ host, context }) {
  let activeId = null;
  const views = new Map();

  async function prepare(command) {
    if (!command || typeof command.mount !== "function" || views.has(command.id)) {
      return views.get(command?.id)?.controller || null;
    }
    const view = document.createElement("div");
    view.className = "command-view hidden";
    view.dataset.commandView = command.id;
    host?.appendChild(view);
    const controller = (await command.mount(view, context)) || null;
    controller?.setVisible?.(false);
    views.set(command.id, { view, controller });
    return controller;
  }

  async function prepareAll(commands) {
    await Promise.all((commands || []).map(prepare));
  }

  function activate(command) {
    const nextId = command?.surface === "custom" ? command.id : null;
    activeId = nextId;
    for (const [id, entry] of views) {
      const visible = id === nextId;
      entry.view.classList.toggle("hidden", !visible);
      entry.controller?.setVisible?.(visible);
    }
    return nextId ? views.get(nextId)?.controller || null : null;
  }

  async function dispose() {
    for (const entry of views.values()) await entry.controller?.unmount?.();
    views.clear();
    host?.replaceChildren();
    activeId = null;
  }

  return {
    prepare,
    prepareAll,
    activate,
    dispose,
    getController(id) {
      return views.get(id)?.controller || null;
    },
    get activeId() {
      return activeId;
    },
    get controller() {
      return activeId ? views.get(activeId)?.controller || null : null;
    },
  };
}
