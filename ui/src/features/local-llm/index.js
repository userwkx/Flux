/**
 * 功能5：本地 LLM 支持
 *
 * 提供预设管理器 + 服务自动检测。
 * 不修改 Rust 后端 — 通过 openai_compatible 格式直连。
 */

import { LOCAL_PRESETS } from "./presets.js";

/** 检测结果缓存，{ id: "online" | "offline" } */
let detectionCache = {};

/**
 * 检查单个本地服务是否可达
 * @param {string} id  预设 key
 * @returns {Promise<"online" | "offline">}
 */
async function checkService(id) {
  const preset = LOCAL_PRESETS[id];
  if (!preset) return "offline";
  try {
    const resp = await fetch(preset.healthUrl, { method: "GET", signal: AbortSignal.timeout(2000) });
    return resp.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}

/**
 * 检测所有预设的本地服务
 * @returns {Promise<Record<string, "online" | "offline">>}
 */
export async function detectLocalServices() {
  const results = {};
  const checks = Object.keys(LOCAL_PRESETS).map(async (id) => {
    results[id] = await checkService(id);
  });
  await Promise.allSettled(checks);
  detectionCache = results;
  return results;
}

/**
 * 获取最后一次检测结果
 * @returns {Record<string, "online" | "offline">}
 */
export function getDetectionCache() {
  return { ...detectionCache };
}

/**
 * 根据预设 ID 创建一个完整的 AiProvider 对象
 * @param {string} id  预设 key（ollama / lm_studio / llama_cpp）
 * @returns {object | null} 可用于 settingsSnap.aiProviders 的 provider 对象
 */
export function createProviderFromPreset(id) {
  const preset = LOCAL_PRESETS[id];
  if (!preset) return null;

  const providerId = `${id}_${Date.now().toString(16)}`;
  return {
    id: providerId,
    name: preset.label,
    format: preset.format,
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey || "",
    headers: {},
    models: preset.models.length > 0 ? [...preset.models] : [],
    selectedModel: preset.models[0] || "",
    requestBody: {},
    extraOptions: {},
    modelConfigs: {},
  };
}

/**
 * 渲染预设列表 DOM 片段到指定容器
 * @param {HTMLElement} container  要填充的容器元素
 * @param {(id: string) => void} onAdd  点击添加按钮的回调
 */
export function renderLocalPresets(container, onAdd) {
  container.innerHTML = "";
  const title = document.createElement("div");
  title.className = "provider-catalog-title";
  title.textContent = "本地模型";
  container.appendChild(title);

  for (const [id, preset] of Object.entries(LOCAL_PRESETS)) {
    const status = detectionCache[id];
    const chip = document.createElement("div");
    chip.className = "local-llm-chip";
    chip.innerHTML = `
      <div class="local-llm-chip-info">
        <div class="local-llm-chip-name">
          <span class="local-llm-dot ${status === "online" ? "is-online" : ""}"></span>
          ${preset.label}
        </div>
        <div class="local-llm-chip-url">${preset.baseUrl}</div>
      </div>
      <button type="button" class="local-llm-add-btn" data-preset="${id}">添加</button>
    `;
    const btn = chip.querySelector(".local-llm-add-btn");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onAdd(id);
    });
    container.appendChild(chip);
  }
}
