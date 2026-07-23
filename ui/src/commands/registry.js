const commands = [];
const byId = new Map();

function cleanId(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanPreferenceList(values) {
    const output = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const item = String(value || "").trim();
      const key = item.toLowerCase();
      if (!item || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
}

function register(definition) {
    const id = cleanId(definition?.id);
    if (!id) throw new Error("命令 id 不能为空");
    if (byId.has(id)) throw new Error(`命令已注册: ${id}`);

    const aliases = cleanPreferenceList([id, ...(definition.aliases || [])]).map(cleanId);
    const command = Object.freeze({
      ...definition,
      id,
      aliases,
      label: definition.label || `/${id}`,
      title: definition.title || id,
      displayPrefix: definition.displayPrefix || `/${id}`,
      placeholder: definition.placeholder || "输入内容后 Enter",
      followPlaceholder: definition.followPlaceholder || "继续输入…",
      resultKind: definition.resultKind || "chat",
      surface: definition.surface || "chat",
      system: definition.system || null,
      defaultOrder: Number.isFinite(definition.defaultOrder)
        ? definition.defaultOrder
        : commands.length,
    });
    commands.push(command);
    byId.set(id, command);
    return command;
}

function get(id) {
  return byId.get(cleanId(id)) || null;
}

function resolve(token) {
    const value = cleanId(token);
    if (!value) return null;
    return commands.find((command) => command.id === value || command.aliases.includes(value)) || null;
}

function defaults() {
    return commands
      .slice()
      .sort((a, b) => a.defaultOrder - b.defaultOrder || a.id.localeCompare(b.id));
}

function normalizePreferences(preferences) {
    const commandOrder = cleanPreferenceList(preferences?.commandOrder);
    const present = new Set(commandOrder.map((id) => id.toLowerCase()));
    for (const command of defaults()) {
      if (!present.has(command.id)) {
        commandOrder.push(command.id);
        present.add(command.id);
      }
    }
    return {
      commandOrder,
      disabledCommands: cleanPreferenceList(preferences?.disabledCommands),
    };
}

function listAll(preferences) {
    const normalized = normalizePreferences(preferences);
    const disabled = new Set(normalized.disabledCommands.map((id) => id.toLowerCase()));
    const output = [];
    const included = new Set();
    for (const id of normalized.commandOrder) {
      const command = get(id);
      if (!command || included.has(command.id)) continue;
      included.add(command.id);
      output.push({ ...command, enabled: !disabled.has(command.id) });
    }
    return output;
}

function list(preferences) {
  return listAll(preferences).filter((command) => command.enabled);
}

export const commandRegistry = {
  register,
  get,
  resolve,
  list,
  listAll,
  normalizePreferences,
};
