use crate::AppState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

/// 在线 Whisper API — 复用已有 AI Provider 配置
#[tauri::command]
pub async fn stt_online_transcribe(
    app: tauri::AppHandle,
    audio_base64: String,
    provider_id: String,
    model: String,
) -> Result<String, String> {
    // 1. 从 settings 获取 provider
    let state: State<'_, Arc<AppState>> = app.state();
    let provider = {
        let settings = state.settings.lock();
        settings
            .ai_providers
            .iter()
            .find(|p| p.id == provider_id)
            .cloned()
            .ok_or_else(|| format!("Provider '{provider_id}' not found"))?
    };

    // 2. 解码 base64 音频
    let audio_bytes = BASE64
        .decode(&audio_base64)
        .map_err(|e| format!("Base64 decode: {e}"))?;

    // 3. 构建 multipart 请求
    let boundary = format!("----stt{}", nanoid());
    let model_name = if model.is_empty() {
        "whisper-1"
    } else {
        &model
    };

    let mut body = Vec::new();
    // model field
    write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model_name}\r\n"
    )
    .map_err(|e| e.to_string())?;
    // file field
    write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    body.extend_from_slice(&audio_bytes);
    write!(body, "\r\n--{boundary}--\r\n").map_err(|e| e.to_string())?;

    // 4. 构建 URL
    let base = provider.base_url.trim_end_matches('/');
    let url = match provider.format.as_str() {
        "openai_compatible" | "openai_responses" => format!("{base}/v1/audio/transcriptions"),
        _ => format!("{base}/v1/audio/transcriptions"),
    };

    // 5. 发送请求
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body);

    if !provider.api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", provider.api_key));
    }

    // 6. 解析响应
    let resp = req.send().await.map_err(|e| format!("HTTP: {e}"))?;
    let text = resp.text().await.map_err(|e| format!("Read: {e}"))?;

    // OpenAI Whisper API returns {"text": "..."}
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
            return Ok(t.to_string());
        }
    }
    Err(format!("Unexpected API response: {text}"))
}

/// 本地 whisper.cpp subprocess
#[tauri::command]
pub async fn stt_local_transcribe(
    audio_base64: String,
    whisper_bin: String,
    model_path: String,
) -> Result<String, String> {
    // 1. 校验路径
    let bin_path = Path::new(&whisper_bin);
    if !bin_path.exists() {
        return Err(format!("whisper.cpp binary not found: {whisper_bin}"));
    }
    let model = Path::new(&model_path);
    if !model.exists() {
        return Err(format!("Model file not found: {model_path}"));
    }

    // 2. 解码音频
    let audio_bytes = BASE64
        .decode(&audio_base64)
        .map_err(|e| format!("Base64 decode: {e}"))?;

    // 3. 写临时 WAV 文件
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_dir = std::env::temp_dir();
    let wav_path = tmp_dir.join(format!("flux_stt_{ts}.wav"));
    let out_path = tmp_dir.join(format!("flux_stt_{ts}.txt"));

    std::fs::write(&wav_path, &audio_bytes).map_err(|e| format!("Write temp wav: {e}"))?;

    // 4. spawn whisper.cpp
    let output = std::process::Command::new(bin_path)
        .arg("-m")
        .arg(model_path)
        .arg("-f")
        .arg(&wav_path)
        .arg("-otxt")
        .arg("-np") // no prints to stderr
        .output()
        .map_err(|e| format!("Spawn whisper.cpp: {e}"))?;

    // 5. 读取输出文件或 stdout
    let result = if out_path.exists() {
        std::fs::read_to_string(&out_path).unwrap_or_default()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    // 6. 清理
    let _ = std::fs::remove_file(&wav_path);
    let _ = std::fs::remove_file(&out_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("whisper.cpp failed: {stderr}"));
    }

    Ok(result.trim().to_string())
}

fn nanoid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| format!("{:x}", d.as_nanos()))
        .unwrap_or_else(|_| "0".into())
}
