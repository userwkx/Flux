export function createCommandHost({ host, quickActionsHost, context }) {
  let activeId = null;
  const views = new Map();
  const quickActions = new Map();

  async function prepareQuickActions(command) {
    if (!command || typeof command.mountQuickActions !== "function" || quickActions.has(command.id)) {
      return quickActions.get(command?.id)?.controller || null;
    }
    const view = document.createElement("div");
    view.className = "command-quick-action hidden";
    view.dataset.commandQuickAction = command.id;
    quickActionsHost?.appendChild(view);
    const controller = (await command.mountQuickActions(view, context)) || null;
    controller?.setVisible?.(false);
    quickActions.set(command.id, { view, controller });
    return controller;
  }

  async function prepare(command) {
    const controller = await prepareCustomView(command);
    await prepareQuickActions(command);
    return controller;
  }

  async function prepareCustomView(command) {
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
    for (const [id, entry] of quickActions) {
      const visible = id === command?.id;
      entry.view.classList.toggle("hidden", !visible);
      entry.controller?.setVisible?.(visible);
    }
    return nextId ? views.get(nextId)?.controller || null : null;
  }

  async function dispose() {
    for (const entry of views.values()) await entry.controller?.unmount?.();
    for (const entry of quickActions.values()) await entry.controller?.unmount?.();
    views.clear();
    quickActions.clear();
    host?.replaceChildren();
    quickActionsHost?.replaceChildren();
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
    handleEscape() {
      const entry = [...quickActions.values()].find(
        (item) => !item.view.classList.contains("hidden"),
      );
      return entry?.controller?.onEscape?.() === true;
    },
    get activeId() {
      return activeId;
    },
    get controller() {
      return activeId ? views.get(activeId)?.controller || null : null;
    },
  };
}
