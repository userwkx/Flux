export function defaultEfforts() {
  return [
    { id: "low", label: "低", requestBody: {} },
    { id: "medium", label: "中", requestBody: {} },
    { id: "high", label: "高", requestBody: {} },
    { id: "xhigh", label: "极高", requestBody: {} },
  ];
}

export function normalizeProviderConfig(provider) {
  if (!provider || typeof provider !== "object") return;
  if (!provider.requestBody || typeof provider.requestBody !== "object" || Array.isArray(provider.requestBody)) provider.requestBody = {};
  if (!provider.extraOptions || typeof provider.extraOptions !== "object" || Array.isArray(provider.extraOptions)) provider.extraOptions = {};
  if (!provider.modelConfigs || typeof provider.modelConfigs !== "object" || Array.isArray(provider.modelConfigs)) provider.modelConfigs = {};
  if (!provider.modelLabels || typeof provider.modelLabels !== "object") provider.modelLabels = {};
  for (const id of provider.models || []) {
    const config = provider.modelConfigs[id] || {};
    config.label = provider.modelLabels[id] || config.label || "";
    config.contextWindow = Number(config.contextWindow) || null;
    config.maxOutputTokens = Number(config.maxOutputTokens) || null;
    config.headers = config.headers && typeof config.headers === "object" ? config.headers : {};
    config.requestBody = config.requestBody && typeof config.requestBody === "object" && !Array.isArray(config.requestBody) ? config.requestBody : {};
    config.efforts = Array.isArray(config.efforts) && config.efforts.length ? config.efforts : defaultEfforts();
    config.defaultEffort = config.defaultEffort || "medium";
    provider.modelConfigs[id] = config;
  }
}

export function parseJsonObject(text, label) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}不是有效 JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return value;
}

export function prettyJson(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {}, null, 2);
}

export function headersToText(headers) {
  if (!headers || typeof headers !== "object") return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export function textToHeaders(text) {
  const headers = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const value = line.trim();
    if (!value) return;
    const separator = value.indexOf(":");
    if (separator <= 0) return;
    const key = value.slice(0, separator).trim();
    if (key) headers[key] = value.slice(separator + 1).trim();
  });
  return headers;
}

export function formatProviderFormat(format) {
  return {
    openai_compatible: "OpenAI Compatible",
    openai_responses: "OpenAI Responses",
    anthropic: "Anthropic",
    google_gemini: "Google Gemini",
  }[format] || format;
}

export function modelLabelOf(provider, id) {
  const labels = provider.modelLabels || provider.model_labels || {};
  const label = labels[id];
  return label && label.trim() ? label : id;
}
