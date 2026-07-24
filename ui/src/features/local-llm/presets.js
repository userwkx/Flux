/**
 * 功能5：本地 LLM 预设配置
 *
 * 定义常见本地推理工具的默认连接参数。
 */

export const LOCAL_PRESETS = {
  ollama: {
    id: "ollama",
    label: "Ollama",
    description: "Ollama 本地推理 (默认 11434 端口)",
    baseUrl: "http://localhost:11434/v1",
    format: "openai_compatible",
    apiKey: "",
    healthUrl: "http://localhost:11434/api/tags",
    models: ["llama3", "qwen2", "deepseek-r1", "mistral", "phi3"],
  },
  lm_studio: {
    id: "lm_studio",
    label: "LM Studio",
    description: "LM Studio 本地推理 (默认 1234 端口)",
    baseUrl: "http://localhost:1234/v1",
    format: "openai_compatible",
    apiKey: "",
    healthUrl: "http://localhost:1234/v1/models",
    models: [],
  },
  llama_cpp: {
    id: "llama_cpp",
    label: "llama.cpp",
    description: "llama.cpp 服务器 (默认 8080 端口)",
    baseUrl: "http://localhost:8080/v1",
    format: "openai_compatible",
    apiKey: "",
    healthUrl: "http://localhost:8080/v1/models",
    models: [],
  },
};
