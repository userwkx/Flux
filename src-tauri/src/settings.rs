use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// openai_compatible | openai_responses | anthropic | google_gemini
pub const FMT_OPENAI_COMPAT: &str = "openai_compatible";
pub const FMT_OPENAI_RESPONSES: &str = "openai_responses";
pub const FMT_ANTHROPIC: &str = "anthropic";
pub const FMT_GEMINI: &str = "google_gemini";
const PROVIDER_CATALOG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEffortOption {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "empty_object")]
    pub request_body: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfig {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub context_window: Option<u64>,
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default = "empty_object")]
    pub request_body: Value,
    #[serde(default = "default_efforts")]
    pub efforts: Vec<AiEffortOption>,
    #[serde(default = "default_effort")]
    pub default_effort: String,
}

fn empty_object() -> Value {
    json!({})
}

fn default_effort() -> String {
    "medium".into()
}

fn default_efforts() -> Vec<AiEffortOption> {
    [
        ("low", "低"),
        ("medium", "中"),
        ("high", "高"),
        ("xhigh", "极高"),
    ]
    .into_iter()
    .map(|(id, label)| AiEffortOption {
        id: id.into(),
        label: label.into(),
        request_body: empty_object(),
    })
    .collect()
}

impl Default for AiModelConfig {
    fn default() -> Self {
        Self {
            label: String::new(),
            context_window: None,
            max_output_tokens: None,
            headers: HashMap::new(),
            request_body: empty_object(),
            efforts: default_efforts(),
            default_effort: default_effort(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// interface format
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    /// extra request headers
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub models: Vec<String>,
    /// API model id -> display label (name mapping)
    #[serde(default)]
    pub model_labels: HashMap<String, String>,
    #[serde(default)]
    pub selected_model: String,
    #[serde(default = "empty_object")]
    pub request_body: Value,
    #[serde(default)]
    pub extra_options: HashMap<String, Value>,
    #[serde(default)]
    pub model_configs: HashMap<String, AiModelConfig>,
}

fn default_format() -> String {
    FMT_OPENAI_COMPAT.into()
}

impl Default for AiProvider {
    fn default() -> Self {
        Self {
            id: new_id(),
            name: "默认".into(),
            format: default_format(),
            base_url: String::new(),
            api_key: String::new(),
            headers: HashMap::new(),
            models: vec!["gpt-4o-mini".into()],
            model_labels: HashMap::new(),
            selected_model: "gpt-4o-mini".into(),
            request_body: empty_object(),
            extra_options: HashMap::new(),
            model_configs: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCatalog {
    version: u32,
    providers: Vec<AiProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    /// classic | cards  (launcher skins; legacy: launcher/studio mapped)
    #[serde(default = "default_home_ui")]
    pub home_ui: String,
    /// User-selected folders containing portable applications.
    #[serde(default)]
    pub app_scan_paths: Vec<String>,
    /// Number of subdirectory levels to include for user-selected folders.
    #[serde(default = "default_app_scan_depth")]
    pub app_scan_depth: u8,
    /// legacy single-provider fields (migrated on load)
    #[serde(default)]
    pub ai_base_url: String,
    #[serde(default)]
    pub ai_api_key: String,
    #[serde(default)]
    pub ai_model: String,
    #[serde(default)]
    pub ai_providers: Vec<AiProvider>,
    #[serde(default)]
    pub active_provider_id: String,
    /// OpenCode-style websearch + webfetch tools
    #[serde(default = "default_true")]
    pub web_search: bool,
    /// bing | google | auto
    #[serde(default = "default_web_search_engine")]
    pub web_search_engine: String,
    /// e.g. http://127.0.0.1:10808 — used for Google path
    #[serde(default = "default_proxy_url")]
    pub proxy_url: String,
    #[serde(default = "default_true")]
    pub proxy_enabled_for_google: bool,
    /// e.g. Alt+Q / Ctrl+Shift+Space
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// model id for /fy translate; empty = use chat selected_model
    #[serde(default)]
    pub translate_model: String,
    /// disable tools / thinking for translate (default true)
    #[serde(default = "default_true")]
    pub translate_no_think: bool,
    #[serde(default)]
    pub conversation_pinned: bool,
    /// conversation retention in hours; 0 = forever
    #[serde(default = "default_conversation_retention_hours")]
    pub conversation_retention_hours: u64,
    /// STT: speech-to-text mode
    #[serde(default = "default_stt_mode")]
    pub stt_mode: String,
    /// STT: local whisper.cpp binary path
    #[serde(default)]
    pub stt_local_bin_path: String,
    /// STT: local whisper model (.bin) path
    #[serde(default)]
    pub stt_local_model_path: String,
    /// STT: online provider id
    #[serde(default)]
    pub stt_provider_id: String,
    /// STT: online model name (e.g. whisper-1)
    #[serde(default = "default_stt_model")]
    pub stt_model: String,
    /// STT: language hint (zh / en / auto)
    #[serde(default = "default_stt_language")]
    pub stt_language: String,
    #[serde(default)]
    pub command_order: Vec<String>,
    #[serde(default)]
    pub disabled_commands: Vec<String>,
}

fn default_hotkey() -> String {
    "Alt+Q".into()
}

fn default_true() -> bool {
    true
}

fn default_web_search_engine() -> String {
    "auto".into()
}

fn default_proxy_url() -> String {
    "http://127.0.0.1:10808".into()
}

fn default_theme() -> String {
    "white".into()
}

fn default_home_ui() -> String {
    "classic".into()
}

fn default_app_scan_depth() -> u8 {
    2
}

fn default_conversation_retention_hours() -> u64 {
    0 // 0 = forever (never auto-expire)
}

fn default_stt_mode() -> String {
    "browser".into()
}

fn default_stt_model() -> String {
    "whisper-1".into()
}

fn default_stt_language() -> String {
    "auto".into()
}

pub fn new_id() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("p{n:x}")
}

impl Default for Settings {
    fn default() -> Self {
        let p = AiProvider::default();
        let id = p.id.clone();
        Self {
            theme: default_theme(),
            home_ui: default_home_ui(),
            app_scan_paths: Vec::new(),
            app_scan_depth: default_app_scan_depth(),
            ai_base_url: String::new(),
            ai_api_key: String::new(),
            ai_model: String::new(),
            ai_providers: vec![p],
            active_provider_id: id,
            web_search: true,
            web_search_engine: default_web_search_engine(),
            proxy_url: default_proxy_url(),
            proxy_enabled_for_google: true,
            hotkey: default_hotkey(),
            translate_model: String::new(),
            translate_no_think: true,
            conversation_pinned: false,
            conversation_retention_hours: default_conversation_retention_hours(),
            stt_mode: default_stt_mode(),
            stt_local_bin_path: String::new(),
            stt_local_model_path: String::new(),
            stt_provider_id: String::new(),
            stt_model: default_stt_model(),
            stt_language: default_stt_language(),
            command_order: Vec::new(),
            disabled_commands: Vec::new(),
        }
    }
}

impl Settings {
    pub fn normalize(&mut self) {
        normalize_command_ids(&mut self.command_order);
        normalize_command_ids(&mut self.disabled_commands);

        if self.theme.is_empty()
            || !matches!(
                self.theme.as_str(),
                "white" | "transparent" | "black" | "gradient"
            )
        {
            self.theme = default_theme();
        }
        // migrate old values
        if self.home_ui == "launcher" || self.home_ui == "studio" {
            self.home_ui = if self.home_ui == "studio" {
                "cards".into()
            } else {
                "classic".into()
            };
        }
        if self.home_ui != "classic" && self.home_ui != "cards" {
            self.home_ui = default_home_ui();
        }
        normalize_scan_paths(&mut self.app_scan_paths);
        self.app_scan_depth = self.app_scan_depth.min(5);

        let eng = self.web_search_engine.trim().to_ascii_lowercase();
        self.web_search_engine = match eng.as_str() {
            "bing" | "google" | "auto" => eng,
            _ => default_web_search_engine(),
        };
        let pu = self.proxy_url.trim().to_string();
        self.proxy_url = if pu.is_empty() {
            default_proxy_url()
        } else if pu.starts_with("http://")
            || pu.starts_with("https://")
            || pu.starts_with("socks5://")
        {
            pu
        } else {
            format!("http://{pu}")
        };

        if self.hotkey.trim().is_empty() {
            self.hotkey = default_hotkey();
        }

        // migrate legacy single config into providers
        if self.ai_providers.is_empty()
            && (!self.ai_base_url.trim().is_empty()
                || !self.ai_api_key.trim().is_empty()
                || !self.ai_model.trim().is_empty())
        {
            let model = if self.ai_model.trim().is_empty() {
                "gpt-4o-mini".into()
            } else {
                self.ai_model.trim().to_string()
            };
            let p = AiProvider {
                name: "默认".into(),
                format: FMT_OPENAI_COMPAT.into(),
                base_url: self.ai_base_url.trim().to_string(),
                api_key: self.ai_api_key.trim().to_string(),
                models: vec![model.clone()],
                selected_model: model,
                ..AiProvider::default()
            };
            self.active_provider_id = p.id.clone();
            self.ai_providers.push(p);
        }

        if self.ai_providers.is_empty() {
            let p = AiProvider::default();
            self.active_provider_id = p.id.clone();
            self.ai_providers.push(p);
        }

        for p in &mut self.ai_providers {
            if p.id.trim().is_empty() {
                p.id = new_id();
            }
            if p.name.trim().is_empty() {
                p.name = "未命名".into();
            }
            if !matches!(
                p.format.as_str(),
                "openai_compatible" | "openai_responses" | "anthropic" | "google_gemini"
            ) {
                p.format = FMT_OPENAI_COMPAT.into();
            }
            if p.selected_model.trim().is_empty() {
                p.selected_model = p
                    .models
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "gpt-4o-mini".into());
            }
            if !p.models.is_empty() && !p.models.iter().any(|m| m == &p.selected_model) {
                p.models.push(p.selected_model.clone());
            }
            if p.models.is_empty() {
                p.models.push(p.selected_model.clone());
            }
            if !p.request_body.is_object() {
                p.request_body = empty_object();
            }
            for model in p.models.clone() {
                let config = p.model_configs.entry(model.clone()).or_default();
                if config.label.trim().is_empty() {
                    config.label = p.model_labels.get(&model).cloned().unwrap_or_default();
                } else {
                    p.model_labels.insert(model.clone(), config.label.clone());
                }
                if !config.request_body.is_object() {
                    config.request_body = empty_object();
                }
                config.efforts.retain(|effort| !effort.id.trim().is_empty());
                if config.efforts.is_empty() {
                    config.efforts = default_efforts();
                }
                if !config
                    .efforts
                    .iter()
                    .any(|effort| effort.id == config.default_effort)
                {
                    config.default_effort = config.efforts[0].id.clone();
                }
            }
            p.model_configs
                .retain(|model, _| p.models.iter().any(|item| item == model));
        }

        if self.active_provider_id.is_empty()
            || !self
                .ai_providers
                .iter()
                .any(|p| p.id == self.active_provider_id)
        {
            self.active_provider_id = self.ai_providers[0].id.clone();
        }

        // keep legacy mirrors for older UI bits
        if let Some((base, key, model)) = self.active_provider().map(|p| {
            (
                p.base_url.clone(),
                p.api_key.clone(),
                p.selected_model.clone(),
            )
        }) {
            self.ai_base_url = base;
            self.ai_api_key = key;
            self.ai_model = model;
        }
    }

    pub fn active_provider(&self) -> Option<&AiProvider> {
        self.ai_providers
            .iter()
            .find(|p| p.id == self.active_provider_id)
            .or_else(|| self.ai_providers.first())
    }

    pub fn active_provider_mut(&mut self) -> Option<&mut AiProvider> {
        let id = self.active_provider_id.clone();
        if let Some(i) = self.ai_providers.iter().position(|p| p.id == id) {
            return self.ai_providers.get_mut(i);
        }
        self.ai_providers.first_mut()
    }
}

fn normalize_command_ids(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    *values = values
        .drain(..)
        .filter_map(|value| {
            let id = value.trim();
            if id.is_empty() || !seen.insert(id.to_ascii_lowercase()) {
                None
            } else {
                Some(id.to_string())
            }
        })
        .collect();
}

fn normalize_scan_paths(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    *values = values
        .drain(..)
        .filter_map(|value| {
            let value = value.trim().trim_matches('"').trim();
            if value.is_empty() {
                return None;
            }
            let value = value.replace('/', "\\");
            let key = value.trim_end_matches('\\').to_ascii_lowercase();
            if key.is_empty() || !seen.insert(key) {
                None
            } else {
                Some(value)
            }
        })
        .take(20)
        .collect();
}

pub fn load(path: &Path) -> Settings {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    let mut s = settings.clone();
    s.normalize();
    let mut value = serde_json::to_value(&s).map_err(|e| e.to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.remove("aiProviders");
        object.remove("aiBaseUrl");
        object.remove("aiApiKey");
        object.remove("aiModel");
    }
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

pub fn load_provider_catalog(path: &Path, settings: &mut Settings) -> Result<(), String> {
    if let Ok(data) = fs::read(path) {
        let catalog: ProviderCatalog = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
        if !catalog.providers.is_empty() {
            settings.ai_providers = catalog.providers;
        }
    }
    settings.normalize();
    save_provider_catalog(path, settings)
}

pub fn save_provider_catalog(path: &Path, settings: &Settings) -> Result<(), String> {
    let mut normalized = settings.clone();
    normalized.normalize();
    let catalog = ProviderCatalog {
        version: PROVIDER_CATALOG_VERSION,
        providers: normalized.ai_providers,
    };
    let data = serde_json::to_vec_pretty(&catalog).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

pub fn is_clutter_app(name: &str, target: &str) -> bool {
    let n = name;
    let t = target;
    let tl = t.to_ascii_lowercase();

    if tl.starts_with("http://") || tl.starts_with("https://") {
        return true;
    }
    if tl.ends_with(".msc") {
        return true;
    }
    if t.starts_with('{') && t.contains('}') && t.contains('\\') {
        return true;
    }
    if tl.contains("\\windows\\system32\\") || tl.contains("\\syswow64\\") {
        return true;
    }
    if tl.contains("\\systemapps\\") {
        return true;
    }

    let prefixes = [
        "本地安全策略",
        "步骤记录器",
        "字符映射表",
        "组件服务",
        "计算机管理",
        "ODBC",
        "iSCSI",
        "Windows 内存诊断",
        "Windows 传真和扫描",
        "Windows PowerShell",
        "Windows 媒体播放器",
        "远程桌面连接",
        "控制面板",
        "运行",
        "帮助",
        "入门",
        "提示",
        "反馈",
        "获取帮助",
        "轻松使用",
        "讲述人",
        "放大镜",
        "屏幕键盘",
        "语音识别",
        "步骤记录",
        "事件查看器",
        "任务计划程序",
        "资源监视器",
        "系统配置",
        "系统信息",
        "注册表编辑器",
        "服务",
        "设备管理器",
        "磁盘管理",
        "打印管理",
        "防火墙",
        "恢复驱动器",
        "内存诊断",
    ];
    for p in prefixes {
        if n.starts_with(p) {
            return true;
        }
    }

    let lower = n.to_ascii_lowercase();
    for kw in [
        "卸载",
        "uninstall",
        "help",
        "文档",
        "手册",
        "readme",
        "release notes",
        "website",
        "网站",
        "主页",
    ] {
        if lower.contains(kw) || n.contains(kw) {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_default_command_preferences() {
        let settings: Settings = serde_json::from_str(r#"{"theme":"white"}"#).unwrap();
        assert!(settings.command_order.is_empty());
        assert!(settings.disabled_commands.is_empty());
    }

    #[test]
    fn command_preferences_are_cleaned_without_dropping_unknown_ids() {
        let mut settings = Settings {
            command_order: vec![
                " fy ".into(),
                "future-command".into(),
                "FY".into(),
                "".into(),
                "ai".into(),
            ],
            disabled_commands: vec![" ai ".into(), "AI".into(), "future-command".into()],
            ..Settings::default()
        };

        settings.normalize();

        assert_eq!(settings.command_order, ["fy", "future-command", "ai"]);
        assert_eq!(settings.disabled_commands, ["ai", "future-command"]);
    }

    #[test]
    fn scan_paths_are_deduplicated_and_depth_is_bounded() {
        let mut settings = Settings {
            app_scan_paths: vec![" D:/Tools ".into(), "D:\\Tools\\".into(), "".into()],
            app_scan_depth: 99,
            ..Settings::default()
        };

        settings.normalize();

        assert_eq!(settings.app_scan_paths, ["D:\\Tools"]);
        assert_eq!(settings.app_scan_depth, 5);
    }

    #[test]
    fn settings_save_keeps_command_preferences() {
        let path = std::env::temp_dir().join(format!("flux-settings-{}.json", new_id()));
        let settings = Settings {
            command_order: vec!["file".into(), "ai".into()],
            disabled_commands: vec!["fy".into()],
            ..Settings::default()
        };

        save(&path, &settings).unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(value["commandOrder"], json!(["file", "ai"]));
        assert_eq!(value["disabledCommands"], json!(["fy"]));
        assert!(value.get("aiProviders").is_none());
    }
}
