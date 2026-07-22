use crate::settings::{AiProvider, Settings, FMT_ANTHROPIC, FMT_GEMINI, FMT_OPENAI_RESPONSES};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{future::join_all, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter};

static RE_DSML_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<｜｜DSML｜｜[^>]*>.*?</｜｜DSML｜｜[^>]*>").unwrap());
static RE_DSML_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<｜｜DSML｜｜[^>]*>").unwrap());
static RE_TOOL_CALLS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<tool_calls>.*?</tool_calls>").unwrap());
static RE_INVOKE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<invoke\b[^>]*>.*?</invoke>").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub storage_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentUpload {
    pub name: String,
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<ChatAttachment>,
}

pub fn save_attachment(dir: &Path, upload: AttachmentUpload) -> Result<ChatAttachment, String> {
    let name = upload.name.trim();
    if name.is_empty() {
        return Err("附件名称为空".into());
    }
    let mime = upload.mime.trim().to_ascii_lowercase();
    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text_ext = matches!(
        ext.as_str(),
        "txt"
            | "md"
            | "json"
            | "jsonl"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "csv"
            | "tsv"
            | "log"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "css"
            | "html"
            | "htm"
            | "rs"
            | "py"
            | "go"
            | "java"
            | "kt"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "cs"
            | "sh"
            | "ps1"
            | "sql"
    );
    let supported = mime.starts_with("image/")
        || mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/pdf"
        || text_ext;
    if !supported {
        return Err("暂不支持这种附件；可添加图片、文本、代码或 PDF".into());
    }
    let data = BASE64
        .decode(upload.data_base64.trim())
        .map_err(|_| "附件数据无效".to_string())?;
    if data.is_empty() {
        return Err("附件内容为空".into());
    }
    if data.len() > 12 * 1024 * 1024 {
        return Err("单个附件不能超过 12 MB".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = chrono_lite();
    let id = format!("a{stamp:x}");
    let safe_ext = ext
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(10)
        .collect::<String>();
    let storage_key = if safe_ext.is_empty() {
        id.clone()
    } else {
        format!("{id}.{safe_ext}")
    };
    std::fs::write(dir.join(&storage_key), &data).map_err(|e| e.to_string())?;
    Ok(ChatAttachment {
        id,
        name: name.chars().take(180).collect(),
        mime,
        size: data.len() as u64,
        storage_key,
    })
}

fn attachment_path(dir: &Path, attachment: &ChatAttachment) -> Result<PathBuf, String> {
    let key = attachment.storage_key.trim();
    if key.is_empty()
        || key.contains('/')
        || key.contains('\\')
        || key.contains("..")
        || !key
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("附件缓存键无效".into());
    }
    Ok(dir.join(key))
}

fn read_attachment(dir: &Path, attachment: &ChatAttachment) -> Result<Vec<u8>, String> {
    std::fs::read(attachment_path(dir, attachment)?)
        .map_err(|_| format!("附件已不存在：{}", attachment.name))
}

fn is_text_attachment(attachment: &ChatAttachment) -> bool {
    attachment.mime.starts_with("text/")
        || attachment.mime == "application/json"
        || matches!(
            Path::new(&attachment.name)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
            "txt"
                | "md"
                | "json"
                | "jsonl"
                | "yaml"
                | "yml"
                | "toml"
                | "xml"
                | "csv"
                | "tsv"
                | "log"
                | "js"
                | "jsx"
                | "ts"
                | "tsx"
                | "css"
                | "html"
                | "htm"
                | "rs"
                | "py"
                | "go"
                | "java"
                | "kt"
                | "c"
                | "h"
                | "cpp"
                | "hpp"
                | "cs"
                | "sh"
                | "ps1"
                | "sql"
        )
}

fn attachment_text(dir: &Path, attachment: &ChatAttachment) -> Result<String, String> {
    let data = read_attachment(dir, attachment)?;
    Ok(format!(
        "\n\n[附件：{}]\n{}",
        attachment.name,
        String::from_utf8_lossy(&data)
    ))
}

fn data_url(dir: &Path, attachment: &ChatAttachment) -> Result<String, String> {
    let data = read_attachment(dir, attachment)?;
    let mime = if attachment.mime.trim().is_empty() {
        "application/octet-stream"
    } else {
        attachment.mime.as_str()
    };
    Ok(format!("data:{mime};base64,{}", BASE64.encode(data)))
}

fn openai_chat_message(message: &ChatMessage, dir: &Path) -> Result<Value, String> {
    if message.attachments.is_empty() {
        return Ok(json!({ "role": message.role, "content": message.content }));
    }
    let mut text = message.content.clone();
    let mut parts = Vec::new();
    for attachment in &message.attachments {
        if is_text_attachment(attachment) {
            text.push_str(&attachment_text(dir, attachment)?);
        } else if attachment.mime.starts_with("image/") {
            parts.push(
                json!({ "type": "image_url", "image_url": { "url": data_url(dir, attachment)? } }),
            );
        } else {
            return Err(format!("当前接口不支持附件：{}", attachment.name));
        }
    }
    if !text.is_empty() {
        parts.insert(0, json!({ "type": "text", "text": text }));
    }
    Ok(json!({ "role": message.role, "content": parts }))
}

fn emit_chunk(app: &AppHandle, text: &str) {
    if text.is_empty() {
        return;
    }
    // filter out tool-call XML tags that some models emit in content
    // e.g. <｜｜DSML｜｜tool_calls> ... </｜｜DSML｜｜tool_calls>
    let cleaned = filter_tool_tags(text);
    if !cleaned.is_empty() {
        let _ = app.emit("ai-chunk", cleaned);
    }
}

fn filter_tool_tags(s: &str) -> String {
    let mut out = RE_DSML_BLOCK.replace_all(s, "").into_owned();
    out = RE_DSML_TAG.replace_all(&out, "").into_owned();
    out = RE_TOOL_CALLS.replace_all(&out, "").into_owned();
    out = RE_INVOKE.replace_all(&out, "").into_owned();
    out
}

fn emit_done(app: &AppHandle) {
    let _ = app.emit("ai-done", ());
}

fn emit_error(app: &AppHandle, msg: impl Into<String>) {
    let _ = app.emit("ai-error", msg.into());
}

fn emit_tool(app: &AppHandle, payload: Value) {
    let _ = app.emit("ai-tool", payload);
}

fn chrono_lite() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Local calendar date for the model (avoids stale training-cut search queries).
fn today_local_str() -> String {
    let offset_hours: i64 = std::env::var("FLUX_TZ_OFFSET")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8); // Asia/Shanghai default for this workspace
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let local = secs as i64 + offset_hours * 3600;
    let days = local.div_euclid(86400);
    // civil from days since 1970-01-01 (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let weekday = ["周四", "周五", "周六", "周日", "周一", "周二", "周三"]
        [((days + 4).rem_euclid(7)) as usize];
    format!("{y:04}-{m:02}-{d:02}（{weekday}，本地 UTC{offset_hours:+}）")
}

fn web_tool_defs(today: &str) -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "websearch",
                "description": format!(
                    "Search the web for up-to-date information. Returns content from relevant pages.\n\nWhen to use:\n- User asks about current events, recent info, or things beyond your knowledge\n- User explicitly asks to '搜索/调研/查一下/搜索一下'\n\nWhen NOT to use:\n- Pure reasoning, coding, writing, translation\n- You already know the answer\n- User just wants your opinion or explanation\n\nKeep queries SHORT (2-5 words). The current date is {today}.\nFor recent topics, include the year: e.g. 'AI news {today}' not 'AI news 2025'.\n\nDefault: search once with 3 results. Only search multiple times if user asks for thorough research ('详细调研/全面分析')."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Short search query (2-5 words)" },
                        "num_results": { "type": "integer", "description": "Number of results (default 3, max 5)", "default": 3 }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "webfetch",
                "description": "Fetch content from a specific URL. Only use when websearch results don't have enough detail and you need to read a specific page. Don't use for every search result — websearch already returns page content.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "http(s) URL" }
                    },
                    "required": ["url"]
                }
            }
        }
    ])
}

fn web_rt_from_settings(s: &Settings) -> crate::web::WebRuntime {
    crate::web::WebRuntime {
        engine: s.web_search_engine.clone(),
        proxy_url: s.proxy_url.clone(),
        proxy_for_google: s.proxy_enabled_for_google,
    }
}

async fn exec_tool(app: &AppHandle, name: &str, args: &Value, settings: &Settings) -> String {
    let rt = web_rt_from_settings(settings);
    match name {
        "websearch" => {
            let query = args
                .get("query")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let n = args
                .get("num_results")
                .and_then(|x| x.as_u64())
                .unwrap_or(3)
                .clamp(1, 5) as usize;
            let id = format!("s{}", chrono_lite());
            let title = format!("Web Search \"{query}\"");
            emit_tool(
                app,
                json!({
                    "id": id,
                    "kind": "websearch",
                    "status": "running",
                    "title": title,
                    "detail": query,
                }),
            );
            match crate::web::web_search(&query, n, &rt).await {
                Ok(out) => {
                    let detail = format!("{} · {} results", out.note, out.hits.len());
                    emit_tool(
                        app,
                        json!({
                            "id": id,
                            "kind": "websearch",
                            "status": "done",
                            "title": format!("Web Search \"{query}\" · {}", out.engine_used),
                            "detail": detail,
                        }),
                    );
                    // Exa/Parallel already return content in snippet — no need to fetch
                    // For Bing/Google fallback, snippet is empty → model can webfetch if needed
                    let results: Vec<Value> = out
                        .hits
                        .iter()
                        .map(|h| {
                            json!({
                                "title": h.title,
                                "url": h.url,
                                "content": h.snippet,
                            })
                        })
                        .collect();
                    json!({
                        "engine": out.engine_used,
                        "note": out.note,
                        "results": results
                    })
                    .to_string()
                }
                Err(e) => {
                    emit_tool(
                        app,
                        json!({
                            "id": id,
                            "kind": "websearch",
                            "status": "error",
                            "title": title,
                            "detail": e,
                        }),
                    );
                    format!("search error: {e}")
                }
            }
        }
        "webfetch" => {
            let url = args
                .get("url")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let id = format!("f{}", chrono_lite());
            let title = format!("WebFetch {url}");
            emit_tool(
                app,
                json!({
                    "id": id,
                    "kind": "webfetch",
                    "status": "running",
                    "title": title,
                    "url": url,
                }),
            );
            match crate::web::web_fetch(&url, 4000, &rt).await {
                Ok(body) => {
                    emit_tool(
                        app,
                        json!({
                            "id": id,
                            "kind": "webfetch",
                            "status": "done",
                            "title": title,
                            "url": url,
                        }),
                    );
                    body
                }
                Err(e) => {
                    emit_tool(
                        app,
                        json!({
                            "id": id,
                            "kind": "webfetch",
                            "status": "error",
                            "title": title,
                            "detail": e,
                            "url": url,
                        }),
                    );
                    format!("fetch error: {e}")
                }
            }
        }
        other => format!("unknown tool: {other}"),
    }
}

fn trim_slash(s: &str) -> &str {
    s.trim().trim_end_matches('/')
}

fn join_url(base: &str, path: &str) -> String {
    let b = trim_slash(base);
    let p = path.trim_start_matches('/');
    if b.is_empty() {
        format!("/{p}")
    } else {
        format!("{b}/{p}")
    }
}

/// Normalize OpenAI-style base: allow full root or .../v1
fn openai_root(base: &str) -> String {
    let b = trim_slash(base);
    if b.is_empty() {
        return "https://api.openai.com/v1".into();
    }
    if b.ends_with("/v1") {
        b.to_string()
    } else {
        format!("{b}/v1")
    }
}

fn anthropic_root(base: &str) -> String {
    let b = trim_slash(base);
    if b.is_empty() {
        "https://api.anthropic.com".into()
    } else {
        b.to_string()
    }
}

fn gemini_root(base: &str) -> String {
    let b = trim_slash(base);
    if b.is_empty() {
        "https://generativelanguage.googleapis.com/v1beta".into()
    } else if b.ends_with("/v1beta") || b.ends_with("/v1") {
        b.to_string()
    } else {
        format!("{b}/v1beta")
    }
}

fn apply_extra_headers(
    req: reqwest::RequestBuilder,
    headers: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    let mut r = req;
    for (k, v) in headers {
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        // don't let empty overwrite auth
        r = r.header(key, v);
    }
    r
}

fn effective_headers(p: &AiProvider) -> HashMap<String, String> {
    let mut headers = p.headers.clone();
    if let Some(config) = p.model_configs.get(p.selected_model.trim()) {
        headers.extend(config.headers.clone());
    }
    headers
}

fn deep_merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                if let Some(current) = target.get_mut(key) {
                    deep_merge(current, value);
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
        }
        (target, patch) => *target = patch.clone(),
    }
}

fn apply_request_config(
    body: &mut Value,
    p: &AiProvider,
    effort_override: Option<&str>,
    request_override: Option<&Value>,
) {
    if !p.extra_options.is_empty() {
        deep_merge(
            body,
            &Value::Object(p.extra_options.clone().into_iter().collect()),
        );
    }
    deep_merge(body, &p.request_body);

    if let Some(config) = p.model_configs.get(p.selected_model.trim()) {
        if let Some(max_tokens) = config.max_output_tokens {
            match p.format.as_str() {
                FMT_OPENAI_RESPONSES => body["max_output_tokens"] = json!(max_tokens),
                FMT_GEMINI => body["generationConfig"]["maxOutputTokens"] = json!(max_tokens),
                _ => body["max_tokens"] = json!(max_tokens),
            }
        }
        deep_merge(body, &config.request_body);

        let effort_id = effort_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(config.default_effort.trim());
        if !effort_id.is_empty() {
            match p.format.as_str() {
                FMT_OPENAI_RESPONSES => body["reasoning"]["effort"] = json!(effort_id),
                crate::settings::FMT_OPENAI_COMPAT => body["reasoning_effort"] = json!(effort_id),
                _ => {}
            }
            if let Some(effort) = config.efforts.iter().find(|item| item.id == effort_id) {
                deep_merge(body, &effort.request_body);
            }
        }
    }

    if let Some(override_body) = request_override {
        deep_merge(body, override_body);
    }
}

static HTTP_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
});

fn client() -> Result<&'static reqwest::Client, String> {
    HTTP_CLIENT.as_ref().map_err(Clone::clone)
}

fn split_system(messages: &[ChatMessage]) -> (Option<String>, Vec<ChatMessage>) {
    let mut system = None;
    let mut rest = Vec::new();
    for m in messages {
        if m.role == "system" && system.is_none() {
            system = Some(m.content.clone());
        } else if m.role == "system" {
            // merge extra system
            if let Some(s) = &mut system {
                s.push('\n');
                s.push_str(&m.content);
            }
        } else {
            rest.push(m.clone());
        }
    }
    (system, rest)
}

pub async fn stream_chat(
    app: AppHandle,
    settings: Settings,
    messages: Vec<ChatMessage>,
    mode: String,
    model_override: Option<String>,
    no_think: Option<bool>,
    enable_tools_override: Option<bool>,
    effort: Option<String>,
    request_override: Option<Value>,
    attachment_dir: PathBuf,
) {
    log_debug(&format!(
        "stream_chat: mode={}, msgs={}, model_override={:?}",
        mode,
        messages.len(),
        model_override
    ));
    let Some(mut provider) = settings.active_provider().cloned() else {
        emit_error(&app, "未配置 AI 供应商");
        emit_done(&app);
        return;
    };

    let is_translate = mode.eq_ignore_ascii_case("fy")
        || mode.eq_ignore_ascii_case("tr")
        || mode.eq_ignore_ascii_case("translate");

    // model: translate uses settings.translate_model if set
    if let Some(m) = model_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        provider.selected_model = m;
    } else if is_translate {
        let tm = settings.translate_model.trim();
        if !tm.is_empty() {
            provider.selected_model = tm.to_string();
        }
    }

    if provider.selected_model.trim().is_empty() {
        emit_error(&app, "未选择模型，请在设置中配置");
        emit_done(&app);
        return;
    }

    // Chat respects webSearch; translation defaults to no tools and its saved reasoning setting.
    let no_think_flag = no_think.unwrap_or(is_translate && settings.translate_no_think);
    let enable_tools = if let Some(e) = enable_tools_override {
        e
    } else if is_translate {
        false
    } else {
        settings.web_search
    };

    let result = match provider.format.as_str() {
        FMT_OPENAI_RESPONSES => {
            stream_openai_responses(
                &app,
                &provider,
                &messages,
                no_think_flag,
                effort.as_deref(),
                request_override.as_ref(),
                &attachment_dir,
            )
            .await
        }
        FMT_ANTHROPIC => {
            stream_anthropic(
                &app,
                &provider,
                &messages,
                effort.as_deref(),
                request_override.as_ref(),
                &attachment_dir,
            )
            .await
        }
        FMT_GEMINI => {
            stream_gemini(
                &app,
                &provider,
                &messages,
                effort.as_deref(),
                request_override.as_ref(),
                &attachment_dir,
            )
            .await
        }
        _ => {
            stream_openai_compat(
                &app,
                &provider,
                &messages,
                enable_tools,
                no_think_flag,
                &settings,
                effort.as_deref(),
                request_override.as_ref(),
                &attachment_dir,
            )
            .await
        }
    };

    if let Err(e) = result {
        emit_error(&app, e);
    }
    emit_done(&app);
}

fn apply_no_think(body: &mut Value) {
    // Common flags to disable thinking/reasoning on various OpenAI-compatible APIs.
    // Only add fields the API likely understands; unknown fields may cause 400.
    if let Some(obj) = body.as_object_mut() {
        // DeepSeek / Qwen style
        obj.insert(
            "chat_template_kwargs".into(),
            json!({ "enable_thinking": false }),
        );
        // OpenAI o-series style
        obj.insert("reasoning_effort".into(), json!("none"));
    }
}

#[cfg(debug_assertions)]
fn log_debug(msg: &str) {
    eprintln!("{msg}");
}

#[cfg(not(debug_assertions))]
fn log_debug(_msg: &str) {}

async fn stream_openai_compat(
    app: &AppHandle,
    p: &AiProvider,
    messages: &[ChatMessage],
    enable_tools: bool,
    no_think: bool,
    settings: &Settings,
    effort: Option<&str>,
    request_override: Option<&Value>,
    attachment_dir: &Path,
) -> Result<(), String> {
    let url = join_url(&openai_root(&p.base_url), "chat/completions");

    let mut api_msgs: Vec<Value> = Vec::new();
    let today = today_local_str();
    // Always inject real "today" so search queries don't use training-cutoff dates
    let mut sys = format!(
        "当前真实本地日期时间基准：{today}。\n\
         用户说「今天/今日/本周/最新」时，必须使用上述日期，禁止使用训练数据里的过期年份（如 2023/2024/2025 误用）。\n\
         构造 websearch 查询时请带上正确年月日，例如「2026年7月21日 新闻」。"
    );
    if enable_tools {
        sys.push_str(
            "\n\n你可以使用工具 websearch、webfetch，且仅在需要实时网页信息时调用。\
             流程类似 OpenCode：先思考 → 需要则 websearch → 再对有价值的 URL 逐条 webfetch → 最后作答并给链接。\
             纯闲聊/推理/写代码且不需联网时不要调用工具。",
        );
    }
    api_msgs.push(json!({
        "role": "system",
        "content": sys,
    }));
    for m in messages {
        api_msgs.push(openai_chat_message(m, attachment_dir)?);
    }

    // Probe tool calls without streaming, then always produce the user-facing answer via SSE.
    let mut has_tool_context = false;
    if enable_tools {
        for round in 0..4 {
            log_debug(&format!("tool round {} starting", round));
            let mut body = json!({
                "model": p.selected_model,
                "stream": false,
                "messages": api_msgs,
                "tools": web_tool_defs(&today),
                "tool_choice": "auto",
            });
            apply_request_config(&mut body, p, effort, request_override);
            if no_think {
                apply_no_think(&mut body);
            }

            let mut req = client()?
                .post(&url)
                .header("Content-Type", "application/json");
            if !p.api_key.trim().is_empty() {
                req = req.bearer_auth(p.api_key.trim());
            }
            req = apply_extra_headers(req, &effective_headers(p));

            let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                let status = resp.status();
                let t = resp.text().await.unwrap_or_default();
                // if tools unsupported, fall back to plain stream
                if status.as_u16() == 400 && t.to_ascii_lowercase().contains("tool") {
                    log_debug("tools not supported by API, falling back to plain stream");
                    break;
                }
                return Err(format!("HTTP {status}: {t}"));
            }

            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            let msg = v
                .pointer("/choices/0/message")
                .cloned()
                .unwrap_or(json!({}));
            let tool_calls = msg
                .get("tool_calls")
                .and_then(|x| x.as_array())
                .cloned()
                .unwrap_or_default();

            if !tool_calls.is_empty() {
                api_msgs.push(msg);
                // concurrent execution: all tool_calls in parallel
                let app_cloned = app.clone();
                let settings_cloned = settings.clone();
                let tasks = tool_calls.into_iter().map(|tc| {
                    let tid = tc
                        .get("id")
                        .and_then(|x| x.as_str())
                        .unwrap_or("tool")
                        .to_string();
                    let name = tc
                        .pointer("/function/name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    let args_raw = tc
                        .pointer("/function/arguments")
                        .and_then(|x| x.as_str())
                        .unwrap_or("{}");
                    let args: Value = serde_json::from_str(args_raw).unwrap_or_else(|_| json!({}));
                    let app_h = app_cloned.clone();
                    let st = settings_cloned.clone();
                    async move {
                        let out = exec_tool(&app_h, &name, &args, &st).await;
                        (tid, out)
                    }
                });
                for (tid, out) in join_all(tasks).await {
                    api_msgs.push(json!({
                        "role": "tool",
                        "tool_call_id": tid,
                        "content": out,
                    }));
                }
                has_tool_context = true;
                continue;
            }

            // no tool_calls — check if content has tool-call XML tags (model doesn't support tools)
            if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                if content.contains("DSML")
                    || content.contains("<tool_calls")
                    || content.contains("<invoke")
                {
                    log_debug(
                        "model output tool tags in content — doesn't support tools, falling back",
                    );
                    break;
                }
                // This was only a tool-selection probe. Discard its non-streamed draft
                // and run the same turn through the final SSE request below.
            }
            break;
        }
    }

    let mut api_msgs_clean = if has_tool_context {
        api_msgs.clone()
    } else {
        let mut clean = Vec::new();
        for m in &api_msgs {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role == "tool" || m.get("tool_calls").is_some() {
                continue;
            }
            let mut cleaned = m.clone();
            if let Some(c) = m.get("content").and_then(|c| c.as_str()) {
                let filtered = filter_tool_tags(c);
                if filtered.trim().is_empty() && role == "assistant" {
                    continue;
                }
                cleaned["content"] = json!(filtered);
            }
            clean.push(cleaned);
        }
        clean
    };

    if let Some(first) = api_msgs_clean.first_mut() {
        if first.get("role").and_then(|r| r.as_str()) == Some("system") {
            *first = json!({
                "role": "system",
                "content": if has_tool_context {
                    format!("当前真实本地日期时间基准：{today}。请依据随后提供的工具结果直接回答，并保留有价值的来源链接。")
                } else {
                    format!("当前真实本地日期时间基准：{today}。")
                }
            });
        }
    }
    if !has_tool_context
        && api_msgs_clean
            .last()
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            != Some("user")
    {
        if let Some(last_user) = api_msgs
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        {
            api_msgs_clean.push(last_user.clone());
        }
    }
    let mut body = json!({
        "model": p.selected_model,
        "stream": true,
        "messages": api_msgs_clean,
    });
    apply_request_config(&mut body, p, effort, request_override);
    if no_think {
        apply_no_think(&mut body);
    }

    let mut req = client()?
        .post(&url)
        .header("Content-Type", "application/json");
    if !p.api_key.trim().is_empty() {
        req = req.bearer_auth(p.api_key.trim());
    }
    req = apply_extra_headers(req, &effective_headers(p));

    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        eprintln!("AI API error: HTTP {status}: {t}");
        return Err(format!("HTTP {status}: {t}"));
    }

    eprintln!(
        "AI stream started, model={}, msgs={}",
        p.selected_model,
        api_msgs.len()
    );
    log_debug(&format!(
        "stream_openai_compat: model={}, msgs={}, enable_tools={}, no_think={}",
        p.selected_model,
        api_msgs.len(),
        enable_tools,
        no_think
    ));
    log_debug(&format!(
        "system msg: {}",
        api_msgs
            .first()
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("(none)")
    ));

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut emitted_any = false;
    // buffer to detect and filter tool-call tags across chunk boundaries
    let mut pending = String::new();
    let mut in_tool_tag = false;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(t) = v
                        .pointer("/choices/0/delta/content")
                        .and_then(|x| x.as_str())
                    {
                        if !t.is_empty() {
                            pending.push_str(t);
                            // process pending: emit safe parts, hold back tag regions
                            loop {
                                if in_tool_tag {
                                    // look for closing tag
                                    if let Some(end) = pending.find("｜｜>") {
                                        pending = pending[end + 3..].to_string();
                                        in_tool_tag = false;
                                        continue;
                                    } else if pending.len() > 500 {
                                        // too long without close — just drop
                                        pending.clear();
                                        in_tool_tag = false;
                                    } else {
                                        break; // wait for more
                                    }
                                } else {
                                    if let Some(start) = pending.find("<｜｜") {
                                        // emit everything before the tag
                                        let safe = &pending[..start];
                                        if !safe.is_empty() {
                                            emit_chunk(app, safe);
                                            emitted_any = true;
                                        }
                                        pending = pending[start..].to_string();
                                        in_tool_tag = true;
                                        continue;
                                    } else if pending.contains("<tool_calls")
                                        || pending.contains("<invoke ")
                                    {
                                        // other tag formats — emit before, hold rest
                                        let idx = pending.find('<').unwrap_or(pending.len());
                                        let safe = &pending[..idx];
                                        if !safe.is_empty() {
                                            emit_chunk(app, safe);
                                            emitted_any = true;
                                        }
                                        pending = pending[idx..].to_string();
                                        in_tool_tag = true;
                                        continue;
                                    } else {
                                        // no tag detected — but keep last few chars in case tag starts
                                        let char_count = pending.chars().count();
                                        if char_count > 8 {
                                            let cut = pending
                                                .char_indices()
                                                .nth(char_count - 8)
                                                .map(|(index, _)| index)
                                                .unwrap_or(0);
                                            let safe = &pending[..cut];
                                            emit_chunk(app, safe);
                                            emitted_any = true;
                                            pending = pending[cut..].to_string();
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // flush remaining pending (not in a tag)
    if !in_tool_tag && !pending.is_empty() {
        let cleaned = filter_tool_tags(&pending);
        if !cleaned.is_empty() {
            emit_chunk(app, &cleaned);
            emitted_any = true;
        }
    }
    if !emitted_any {
        log_debug("stream completed but no content after filtering");
    }
    let _ = settings;
    Ok(())
}

async fn stream_openai_responses(
    app: &AppHandle,
    p: &AiProvider,
    messages: &[ChatMessage],
    no_think: bool,
    effort: Option<&str>,
    request_override: Option<&Value>,
    attachment_dir: &Path,
) -> Result<(), String> {
    let url = join_url(&openai_root(&p.base_url), "responses");
    let input: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| -> Result<Value, String> {
            if m.attachments.is_empty() {
                return Ok(json!({
                    "role": if m.role == "assistant" { "assistant" } else { "user" },
                    "content": m.content,
                }));
            }
            let mut text = m.content.clone();
            let mut content = Vec::new();
            for attachment in &m.attachments {
                if is_text_attachment(attachment) {
                    text.push_str(&attachment_text(attachment_dir, attachment)?);
                } else if attachment.mime.starts_with("image/") {
                    content.push(json!({ "type": "input_image", "image_url": data_url(attachment_dir, attachment)? }));
                } else if attachment.mime == "application/pdf" {
                    content.push(json!({
                        "type": "input_file",
                        "filename": attachment.name,
                        "file_data": data_url(attachment_dir, attachment)?,
                    }));
                } else {
                    return Err(format!("当前接口不支持附件：{}", attachment.name));
                }
            }
            if !text.is_empty() {
                content.insert(0, json!({ "type": "input_text", "text": text }));
            }
            Ok(json!({
                "role": if m.role == "assistant" { "assistant" } else { "user" },
                "content": content,
            }))
        })
        .collect::<Result<_, _>>()?;
    let (system, _) = split_system(messages);
    let mut body = json!({
        "model": p.selected_model,
        "stream": true,
        "input": input,
    });
    if let Some(s) = system {
        body["instructions"] = json!(s);
    }
    apply_request_config(&mut body, p, effort, request_override);
    if no_think {
        apply_no_think(&mut body);
    }

    let mut req = client()?
        .post(&url)
        .header("Content-Type", "application/json");
    if !p.api_key.trim().is_empty() {
        req = req.bearer_auth(p.api_key.trim());
    }
    req = apply_extra_headers(req, &effective_headers(p));

    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {t}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    // response.output_text.delta
                    if let Some(t) = v.get("delta").and_then(|d| d.as_str()) {
                        emit_chunk(app, t);
                    } else if let Some(t) = v.pointer("/delta/text").and_then(|x| x.as_str()) {
                        emit_chunk(app, t);
                    } else if v.get("type").and_then(|t| t.as_str())
                        == Some("response.output_text.delta")
                    {
                        if let Some(t) = v.get("delta").and_then(|d| d.as_str()) {
                            emit_chunk(app, t);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

async fn stream_anthropic(
    app: &AppHandle,
    p: &AiProvider,
    messages: &[ChatMessage],
    effort: Option<&str>,
    request_override: Option<&Value>,
    attachment_dir: &Path,
) -> Result<(), String> {
    let url = join_url(&anthropic_root(&p.base_url), "v1/messages");
    let (system, rest) = split_system(messages);
    let api_messages = rest
        .iter()
        .map(|m| -> Result<Value, String> {
            if m.attachments.is_empty() {
                return Ok(json!({
                    "role": if m.role == "assistant" { "assistant" } else { "user" },
                    "content": m.content,
                }));
            }
            let mut text = m.content.clone();
            let mut content = Vec::new();
            for attachment in &m.attachments {
                if is_text_attachment(attachment) {
                    text.push_str(&attachment_text(attachment_dir, attachment)?);
                } else if attachment.mime.starts_with("image/") {
                    let data = read_attachment(attachment_dir, attachment)?;
                    content.push(json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": attachment.mime,
                            "data": BASE64.encode(data),
                        }
                    }));
                } else {
                    return Err(format!("当前接口不支持附件：{}", attachment.name));
                }
            }
            if !text.is_empty() {
                content.insert(0, json!({ "type": "text", "text": text }));
            }
            Ok(json!({
                "role": if m.role == "assistant" { "assistant" } else { "user" },
                "content": content,
            }))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut body = json!({
        "model": p.selected_model,
        "max_tokens": 4096,
        "stream": true,
        "system": system.unwrap_or_default(),
        "messages": api_messages,
    });
    apply_request_config(&mut body, p, effort, request_override);

    let mut req = client()?
        .post(&url)
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01");
    if !p.api_key.trim().is_empty() {
        req = req.header("x-api-key", p.api_key.trim());
    }
    req = apply_extra_headers(req, &effective_headers(p));

    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {t}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                        if let Some(t) = v.pointer("/delta/text").and_then(|x| x.as_str()) {
                            emit_chunk(app, t);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

async fn stream_gemini(
    app: &AppHandle,
    p: &AiProvider,
    messages: &[ChatMessage],
    effort: Option<&str>,
    request_override: Option<&Value>,
    attachment_dir: &Path,
) -> Result<(), String> {
    let root = gemini_root(&p.base_url);
    let model = p.selected_model.trim();
    let model_path = if model.starts_with("models/") {
        model.to_string()
    } else {
        format!("models/{model}")
    };
    let mut url = join_url(&root, &format!("{model_path}:streamGenerateContent"));
    // prefer key query for Gemini
    if !p.api_key.trim().is_empty() {
        url = format!("{url}?alt=sse&key={}", urlencoding_lite(p.api_key.trim()));
    } else {
        url = format!("{url}?alt=sse");
    }

    let (system, rest) = split_system(messages);
    let mut contents = Vec::new();
    for m in rest {
        let role = if m.role == "assistant" {
            "model"
        } else {
            "user"
        };
        let mut text = m.content.clone();
        let mut parts = Vec::new();
        for attachment in &m.attachments {
            if is_text_attachment(attachment) {
                text.push_str(&attachment_text(attachment_dir, attachment)?);
            } else if attachment.mime.starts_with("image/") {
                let data = read_attachment(attachment_dir, attachment)?;
                parts.push(json!({
                    "inline_data": {
                        "mime_type": attachment.mime,
                        "data": BASE64.encode(data),
                    }
                }));
            } else {
                return Err(format!("当前接口不支持附件：{}", attachment.name));
            }
        }
        if !text.is_empty() {
            parts.insert(0, json!({ "text": text }));
        }
        contents.push(json!({
            "role": role,
            "parts": parts,
        }));
    }
    let mut body = json!({ "contents": contents });
    if let Some(s) = system {
        body["systemInstruction"] = json!({ "parts": [{"text": s}] });
    }
    apply_request_config(&mut body, p, effort, request_override);

    let mut req = client()?
        .post(&url)
        .header("Content-Type", "application/json");
    req = apply_extra_headers(req, &effective_headers(p));

    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {t}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            let data = if let Some(d) = line.strip_prefix("data:") {
                d.trim()
            } else if line.starts_with('{') {
                line.trim()
            } else {
                continue;
            };
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                if let Some(arr) = v
                    .pointer("/candidates/0/content/parts")
                    .and_then(|x| x.as_array())
                {
                    for part in arr {
                        if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                            emit_chunk(app, t);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn urlencoding_lite(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Fetch remote model list for a provider (may not include all custom names).
pub async fn fetch_models(provider: AiProvider) -> Result<Vec<String>, String> {
    match provider.format.as_str() {
        FMT_ANTHROPIC => fetch_anthropic_models(&provider).await,
        FMT_GEMINI => fetch_gemini_models(&provider).await,
        _ => fetch_openai_models(&provider).await,
    }
}

async fn fetch_openai_models(p: &AiProvider) -> Result<Vec<String>, String> {
    let url = join_url(&openai_root(&p.base_url), "models");
    let mut req = client()?.get(&url);
    if !p.api_key.trim().is_empty() {
        req = req.bearer_auth(p.api_key.trim());
    }
    req = apply_extra_headers(req, &p.headers);
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {t}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                names.push(id.to_string());
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

async fn fetch_anthropic_models(p: &AiProvider) -> Result<Vec<String>, String> {
    let url = join_url(&anthropic_root(&p.base_url), "v1/models");
    let mut req = client()?
        .get(&url)
        .header("anthropic-version", "2023-06-01");
    if !p.api_key.trim().is_empty() {
        req = req.header("x-api-key", p.api_key.trim());
    }
    req = apply_extra_headers(req, &p.headers);
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {t}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                names.push(id.to_string());
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

async fn fetch_gemini_models(p: &AiProvider) -> Result<Vec<String>, String> {
    let root = gemini_root(&p.base_url);
    let mut url = join_url(&root, "models");
    if !p.api_key.trim().is_empty() {
        url = format!("{url}?key={}", urlencoding_lite(p.api_key.trim()));
    }
    let mut req = client()?.get(&url);
    req = apply_extra_headers(req, &p.headers);
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {t}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    if let Some(arr) = v.get("models").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(name) = item.get("name").and_then(|x| x.as_str()) {
                // models/gemini-1.5-flash -> gemini-1.5-flash
                let short = name.strip_prefix("models/").unwrap_or(name);
                // prefer generateContent capable
                let methods = item
                    .get("supportedGenerationMethods")
                    .and_then(|m| m.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str())
                            .any(|s| s.contains("generateContent"))
                    })
                    .unwrap_or(true);
                if methods {
                    names.push(short.to_string());
                }
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}
