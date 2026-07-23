mod ai;
mod apps;
mod conversations;
mod icons;
mod pinyin_util;
mod recent;
mod settings;
mod web;

use apps::AppItem;
use conversations::Conversation;
use futures_util::future::{AbortHandle, Abortable};
use parking_lot::Mutex;
use recent::RecentItem;
use serde::{Deserialize, Serialize};
use settings::{AiProvider, Settings};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static IGNORE_BLUR: AtomicBool = AtomicBool::new(false);
/// Manual work-area "maximize" (frameless may not report is_maximized).
static WIN_FILLED: AtomicBool = AtomicBool::new(false);
static WIN_RESTORE: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);
static SETTINGS_RESTORE: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);
static VIEWER_RESTORE: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);
static SHOW_TOPMOST_SEQ: AtomicU64 = AtomicU64::new(0);
static CONVERSATION_ACTIVE: AtomicBool = AtomicBool::new(false);
static CONVERSATION_TOPMOST: AtomicBool = AtomicBool::new(false);

fn bump_ignore_blur() {
    IGNORE_BLUR.store(true, Ordering::SeqCst);
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(400));
        IGNORE_BLUR.store(false, Ordering::SeqCst);
    });
}

struct AppState {
    root: PathBuf,
    apps: Mutex<Vec<AppItem>>,
    recent: Mutex<Vec<RecentItem>>,
    settings: Mutex<Settings>,
    conversations: Mutex<Vec<Conversation>>,
    hotkey: Mutex<String>,
    index_status: Mutex<IndexStatus>,
    icon_io: Mutex<()>,
    source_fingerprint: AtomicU64,
    ai_request_seq: AtomicU64,
    ai_abort: Mutex<Option<(u64, AbortHandle)>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IndexStatus {
    Idle,
    Running,
    Ready,
}

impl IndexStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Ready => "ready",
        }
    }
}

impl AppState {
    fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    fn providers_path(&self) -> PathBuf {
        self.root.join("ai-providers.json")
    }
    fn recent_path(&self) -> PathBuf {
        self.root.join("recent.json")
    }
    fn icons_dir(&self) -> PathBuf {
        self.root.join("icons-cache")
    }
    fn conversations_path(&self) -> PathBuf {
        self.root.join("conversations.json")
    }
    fn attachments_dir(&self) -> PathBuf {
        self.root.join("attachments-cache")
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GetAppsResult {
    apps: Vec<AppItem>,
    recent: Vec<RecentItem>,
    hotkey: String,
    settings: Settings,
    index_status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn start_app_index(app: &AppHandle, state: Arc<AppState>, force: bool) -> bool {
    {
        let mut status = state.index_status.lock();
        if *status == IndexStatus::Running || (!force && *status == IndexStatus::Ready) {
            return false;
        }
        *status = IndexStatus::Running;
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        let (scan_paths, scan_depth) = {
            let settings = state.settings.lock();
            (
                settings.app_scan_paths.clone(),
                usize::from(settings.app_scan_depth),
            )
        };
        let cache_file = state.root.join("apps_cache.json");
        match apps::collect_apps(&scan_paths, scan_depth) {
            Ok(mut list) => {
                let known_icons = state
                    .apps
                    .lock()
                    .iter()
                    .filter(|item| !item.icon.is_empty())
                    .map(|item| (item.target.clone(), item.icon.clone()))
                    .collect::<std::collections::HashMap<_, _>>();
                for item in &mut list {
                    if let Some(icon) = known_icons.get(&item.target) {
                        item.icon = icon.clone();
                    }
                }

                *state.apps.lock() = list.clone();
                {
                    let mut recent_items = state.recent.lock();
                    if let Err(error) =
                        recent::reconcile(&state.recent_path(), &mut recent_items, &list)
                    {
                        eprintln!("recent sync error: {error}");
                    }
                }
                let _ = handle.emit("apps-updated", ());

                let icon_result = {
                    let _guard = state.icon_io.lock();
                    icons::sync_icon_cache(&state.icons_dir(), &list)
                };
                if let Err(error) = icon_result {
                    eprintln!("icon sync error: {error}");
                    *state.index_status.lock() = IndexStatus::Ready;
                    let _ = handle.emit("apps-index-error", error);
                    return;
                }

                let fingerprint = apps::source_fingerprint(&scan_paths, scan_depth);
                apps::save_cache(&cache_file, &list, fingerprint);
                state
                    .source_fingerprint
                    .store(fingerprint, Ordering::Release);
                *state.index_status.lock() = IndexStatus::Ready;
                let _ = handle.emit("apps-updated", ());
            }
            Err(error) => {
                eprintln!("index error: {error}");
                *state.index_status.lock() = IndexStatus::Idle;
                let _ = handle.emit("apps-index-error", error);
            }
        }
    });
    true
}

fn start_app_monitor(app: AppHandle, state: Arc<AppState>) {
    std::thread::spawn(move || loop {
        let (scan_paths, scan_depth) = {
            let settings = state.settings.lock();
            (
                settings.app_scan_paths.clone(),
                usize::from(settings.app_scan_depth),
            )
        };
        let fingerprint = apps::source_fingerprint(&scan_paths, scan_depth);
        if fingerprint != state.source_fingerprint.load(Ordering::Acquire) {
            start_app_index(&app, state.clone(), true);
        }
        std::thread::sleep(Duration::from_secs(20));
    });
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            bump_ignore_blur();
            let _ = w.set_always_on_top(true);
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("window-shown", ());
            release_temporary_topmost(app.clone());
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        bump_ignore_blur();
        let _ = w.set_always_on_top(true);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("window-shown", ());
        release_temporary_topmost(app.clone());
    }
}

fn release_temporary_topmost(app: AppHandle) {
    let sequence = SHOW_TOPMOST_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(700));
        if SHOW_TOPMOST_SEQ.load(Ordering::SeqCst) != sequence
            || CONVERSATION_TOPMOST.load(Ordering::SeqCst)
        {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_always_on_top(false);
        }
    });
}

fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn start_window_drag(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN,
        };

        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            ReleaseCapture();
            SendMessageW(hwnd.0, WM_NCLBUTTONDOWN, HTCAPTION as usize, 0);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        window.start_dragging().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn get_apps(state: State<Arc<AppState>>, app: AppHandle) -> GetAppsResult {
    start_app_index(&app, state.inner().clone(), false);
    // return immediately with whatever we have (possibly empty on first run)
    GetAppsResult {
        apps: state.apps.lock().clone(),
        recent: state.recent.lock().clone(),
        hotkey: state.hotkey.lock().clone(),
        settings: state.settings.lock().clone(),
        index_status: state.index_status.lock().as_str(),
        error: None,
    }
}

#[tauri::command]
async fn get_app_icons(
    state: State<'_, Arc<AppState>>,
    targets: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let shared = state.inner().clone();
    let sources = shared
        .apps
        .lock()
        .iter()
        .map(|item| (item.target.clone(), item.icon_source.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let requests = targets
        .into_iter()
        .take(64)
        .map(|target| {
            let source = sources
                .get(&target)
                .cloned()
                .unwrap_or_else(|| target.clone());
            (target, source)
        })
        .collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = shared.icon_io.lock();
        icons::load_icons_batch(&shared.icons_dir(), &requests)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn reorder_recent(
    state: State<Arc<AppState>>,
    targets: Vec<String>,
) -> Result<Vec<RecentItem>, String> {
    let mut items = state.recent.lock();
    recent::reorder(&state.recent_path(), &mut items, &targets)?;
    Ok(items.clone())
}

#[tauri::command]
fn remove_recent(state: State<Arc<AppState>>, target: String) -> Result<Vec<RecentItem>, String> {
    let mut items = state.recent.lock();
    recent::remove(&state.recent_path(), &mut items, target.trim())?;
    Ok(items.clone())
}

#[tauri::command]
fn get_conversations(state: State<Arc<AppState>>) -> Vec<Conversation> {
    state.conversations.lock().clone()
}

#[tauri::command]
fn save_conversation(
    state: State<Arc<AppState>>,
    conversation: Conversation,
) -> Result<Vec<Conversation>, String> {
    let mut items = state.conversations.lock();
    conversations::upsert(&state.conversations_path(), &mut items, conversation)?;
    conversations::cleanup_attachments(&state.attachments_dir(), &items);
    Ok(items.clone())
}

#[tauri::command]
fn delete_conversation(
    state: State<Arc<AppState>>,
    id: String,
) -> Result<Vec<Conversation>, String> {
    let mut items = state.conversations.lock();
    conversations::remove(&state.conversations_path(), &mut items, id.trim())?;
    conversations::cleanup_attachments(&state.attachments_dir(), &items);
    Ok(items.clone())
}

#[tauri::command]
fn save_attachment(
    state: State<Arc<AppState>>,
    upload: ai::AttachmentUpload,
) -> Result<ai::ChatAttachment, String> {
    ai::save_attachment(&state.attachments_dir(), upload)
}

#[tauri::command]
fn set_settings(
    app: AppHandle,
    state: State<Arc<AppState>>,
    patch: Settings,
) -> Result<serde_json::Value, String> {
    let scan_settings_changed;
    {
        let mut s = state.settings.lock();
        let old_scan_settings = (s.app_scan_paths.clone(), s.app_scan_depth);
        let theme = patch.theme.trim().to_ascii_lowercase();
        if matches!(
            theme.as_str(),
            "white" | "transparent" | "black" | "gradient"
        ) {
            s.theme = theme;
        } else if s.theme.is_empty() {
            s.theme = "white".into();
        }
        let home = patch.home_ui.trim().to_ascii_lowercase();
        let home = match home.as_str() {
            "cards" | "studio" => "cards".to_string(),
            "classic" | "launcher" => "classic".to_string(),
            _ => String::new(),
        };
        if !home.is_empty() {
            s.home_ui = home;
        }
        s.app_scan_paths = patch.app_scan_paths;
        s.app_scan_depth = patch.app_scan_depth;
        // always take explicit bool from patch when settings form saves
        s.web_search = patch.web_search;
        let eng = patch.web_search_engine.trim().to_ascii_lowercase();
        if matches!(eng.as_str(), "bing" | "google" | "auto") {
            s.web_search_engine = eng;
        }
        let pu = patch.proxy_url.trim().to_string();
        if !pu.is_empty() {
            s.proxy_url = if pu.starts_with("http://")
                || pu.starts_with("https://")
                || pu.starts_with("socks5://")
            {
                pu
            } else {
                format!("http://{pu}")
            };
        }
        s.proxy_enabled_for_google = patch.proxy_enabled_for_google;
        let hk = patch.hotkey.trim().to_string();
        if !hk.is_empty() {
            s.hotkey = hk;
        }
        s.translate_model = patch.translate_model.trim().to_string();
        s.translate_no_think = patch.translate_no_think;
        s.command_order = patch.command_order;
        s.disabled_commands = patch.disabled_commands;

        // multi-provider AI config
        if !patch.ai_providers.is_empty() {
            s.ai_providers = patch.ai_providers;
        }
        if !patch.active_provider_id.trim().is_empty() {
            s.active_provider_id = patch.active_provider_id.trim().to_string();
        }
        // legacy single fields still accepted (sync into active provider)
        if !patch.ai_base_url.trim().is_empty()
            || !patch.ai_api_key.trim().is_empty()
            || !patch.ai_model.trim().is_empty()
        {
            if let Some(p) = s.active_provider_mut() {
                if !patch.ai_base_url.trim().is_empty() {
                    p.base_url = patch.ai_base_url.trim().to_string();
                }
                if !patch.ai_api_key.trim().is_empty() {
                    p.api_key = patch.ai_api_key.trim().to_string();
                }
                if !patch.ai_model.trim().is_empty() {
                    p.selected_model = patch.ai_model.trim().to_string();
                    if !p.models.iter().any(|m| m == &p.selected_model) {
                        p.models.push(p.selected_model.clone());
                    }
                }
            }
        }
        s.normalize();
        scan_settings_changed = old_scan_settings != (s.app_scan_paths.clone(), s.app_scan_depth);
        settings::save(&state.settings_path(), &s)?;
        settings::save_provider_catalog(&state.providers_path(), &s)?;
    }
    {
        let mut recent = state.recent.lock();
        recent.retain(|r| !r.clutter && !settings::is_clutter_app(&r.name, &r.target));
        recent::save(&state.recent_path(), &recent)?;
    }
    if scan_settings_changed {
        start_app_index(&app, state.inner().clone(), true);
    }
    Ok(serde_json::json!({
        "settings": state.settings.lock().clone(),
        "recent": state.recent.lock().clone(),
    }))
}

#[derive(Debug, Clone, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiChatOptions {
    /// ai | fy | ...
    #[serde(default)]
    mode: String,
    /// override model id
    #[serde(default)]
    model: Option<String>,
    /// force disable tools/thinking
    #[serde(default)]
    no_think: Option<bool>,
    /// force enable/disable web tools
    #[serde(default)]
    enable_tools: Option<bool>,
    /// configured reasoning effort id
    #[serde(default)]
    effort: Option<String>,
    /// one-off request-body patch, applied last
    #[serde(default)]
    request_body: Option<serde_json::Value>,
}

#[tauri::command]
async fn ai_chat(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    messages: Vec<ai::ChatMessage>,
    options: Option<AiChatOptions>,
) -> Result<(), String> {
    let settings = state.settings.lock().clone();
    let opts = options.unwrap_or_default();
    let request_id = state.ai_request_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    if let Some((_, previous)) = state.ai_abort.lock().replace((request_id, abort_handle)) {
        previous.abort();
    }

    let stream = ai::stream_chat(
        app.clone(),
        settings,
        messages,
        opts.mode,
        opts.model,
        opts.no_think,
        opts.enable_tools,
        opts.effort,
        opts.request_body,
        state.attachments_dir(),
    );
    let aborted = Abortable::new(stream, abort_registration).await.is_err();

    {
        let mut active = state.ai_abort.lock();
        if active.as_ref().map(|(id, _)| *id) == Some(request_id) {
            active.take();
        }
    }
    if aborted {
        let _ = app.emit("ai-done", ());
    }
    Ok(())
}

#[tauri::command]
fn stop_ai(state: State<'_, Arc<AppState>>) -> bool {
    let active = state.ai_abort.lock().take();
    if let Some((_, handle)) = active {
        handle.abort();
        true
    } else {
        false
    }
}

#[tauri::command]
async fn ai_fetch_models(
    state: State<'_, Arc<AppState>>,
    provider_id: Option<String>,
    provider: Option<AiProvider>,
) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().clone();
    let provider = if let Some(provider) = provider {
        provider
    } else if let Some(id) = provider_id {
        settings
            .ai_providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "供应商不存在".to_string())?
    } else {
        settings
            .active_provider()
            .cloned()
            .ok_or_else(|| "未配置供应商".to_string())?
    };
    ai::fetch_models(provider).await
}

#[tauri::command]
fn launch_app(
    app: AppHandle,
    state: State<Arc<AppState>>,
    item: AppItem,
) -> Result<serde_json::Value, String> {
    apps::launch_app(&item)?;
    {
        let mut recent = state.recent.lock();
        recent::push(&state.recent_path(), &mut recent, &item);
    }
    hide_main(&app);
    Ok(serde_json::json!({
        "ok": true,
        "recent": state.recent.lock().clone(),
    }))
}

#[tauri::command]
fn hide_window(app: AppHandle) -> Result<(), String> {
    hide_main(&app);
    Ok(())
}

#[tauri::command]
fn set_conversation_pin(
    app: AppHandle,
    state: State<Arc<AppState>>,
    pinned: bool,
) -> Result<bool, String> {
    let topmost = pinned && CONVERSATION_ACTIVE.load(Ordering::SeqCst);
    CONVERSATION_TOPMOST.store(topmost, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_always_on_top(topmost)
            .map_err(|error| error.to_string())?;
    }
    let mut settings = state.settings.lock();
    settings.conversation_pinned = pinned;
    settings::save(&state.settings_path(), &settings)?;
    Ok(pinned)
}

#[tauri::command]
fn set_conversation_active(
    app: AppHandle,
    state: State<Arc<AppState>>,
    active: bool,
) -> Result<bool, String> {
    CONVERSATION_ACTIVE.store(active, Ordering::SeqCst);
    let topmost = active && state.settings.lock().conversation_pinned;
    CONVERSATION_TOPMOST.store(topmost, Ordering::SeqCst);
    if topmost || !active {
        if let Some(window) = app.get_webview_window("main") {
            window
                .set_always_on_top(topmost)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(topmost)
}

#[tauri::command]
fn resize_window(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    // don't fight maximized / viewer fullscreen
    if w.is_maximized().unwrap_or(false) {
        return Ok(());
    }
    let ww = width.clamp(480.0, 2400.0);
    let hh = height.clamp(150.0, 1600.0);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));
    // clear max size so user can stretch freely
    let _ = w.set_max_size(Option::<tauri::Size>::None);
    w.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: ww,
        height: hh,
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fill current monitor work area (true "fullscreen" for frameless window on Windows).
#[tauri::command]
fn enter_viewer_mode(app: AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    {
        let mut restore = VIEWER_RESTORE.lock();
        if restore.is_none() {
            if let (Ok(position), Ok(size)) = (w.outer_position(), w.outer_size()) {
                *restore = Some((position.x, position.y, size.width, size.height));
            }
        }
    }
    let _ = w.set_always_on_top(false);
    let _ = w.set_resizable(true);
    let _ = w.set_skip_taskbar(false);
    let _ = w.set_max_size(Option::<tauri::Size>::None);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));

    // Prefer explicit work-area fill — more reliable than maximize on transparent frameless
    if let Ok(Some(monitor)) = w.current_monitor() {
        let area = monitor.work_area();
        let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: area.position.x,
            y: area.position.y,
        }));
        let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: area.size.width,
            height: area.size.height,
        }));
    } else if let Ok(Some(monitor)) = app.primary_monitor() {
        let area = monitor.work_area();
        let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: area.position.x,
            y: area.position.y,
        }));
        let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: area.size.width,
            height: area.size.height,
        }));
    } else {
        let _ = w.maximize();
    }
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn leave_viewer_mode(app: AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    if w.is_maximized().unwrap_or(false) {
        let _ = w.unmaximize();
    }
    let _ = w.set_skip_taskbar(true);
    let _ = w.set_always_on_top(false);
    let _ = w.set_resizable(true);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));
    if let Some((x, y, width, height)) = VIEWER_RESTORE.lock().take() {
        let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
        let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    } else {
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 720.0,
            height: 560.0,
        }));
    }
    let _ = w.set_focus();
    Ok(())
}

/// Cards launcher: resizable; frontend owns its compact content-fit geometry.
#[tauri::command]
fn enter_cards_mode(app: AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    if w.is_maximized().unwrap_or(false) {
        let _ = w.unmaximize();
    }
    let _ = w.set_always_on_top(false);
    let _ = w.set_skip_taskbar(false);
    let _ = w.set_resizable(true);
    let _ = w.set_max_size(Option::<tauri::Size>::None);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn enter_launcher_mode(app: AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    if w.is_maximized().unwrap_or(false) {
        let _ = w.unmaximize();
    }
    let _ = w.set_skip_taskbar(true);
    let _ = w.set_resizable(true);
    let _ = w.set_max_size(Option::<tauri::Size>::None);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn enter_settings_mode(app: AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    {
        let mut restore = SETTINGS_RESTORE.lock();
        if restore.is_none() {
            if let (Ok(position), Ok(size)) = (w.outer_position(), w.outer_size()) {
                *restore = Some((position.x, position.y, size.width, size.height));
            }
        }
    }
    if w.is_maximized().unwrap_or(false) {
        let _ = w.unmaximize();
    }
    let _ = w.set_always_on_top(false);
    let _ = w.set_skip_taskbar(false);
    let _ = w.set_resizable(true);
    let _ = w.set_max_size(Option::<tauri::Size>::None);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));
    let scale = w.scale_factor().unwrap_or(1.0);
    let current = w
        .inner_size()
        .ok()
        .map(|size| (size.width as f64 / scale, size.height as f64 / scale));
    let current_width = current.map(|size| size.0).unwrap_or(720.0);
    let current_height = current.map(|size| size.1).unwrap_or(480.0);
    if current_width < 900.0 || current_height < 600.0 {
        let monitor = w
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| app.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let max_width = (area.size.width as f64 / scale - 32.0).max(480.0);
            let max_height = (area.size.height as f64 / scale - 32.0).max(160.0);
            let width = current_width.max(920.0).min(max_width);
            let height = current_height.max(620.0).min(max_height);
            let physical_width = (width * scale).round() as u32;
            let physical_height = (height * scale).round() as u32;
            let x = area.position.x + (area.size.width.saturating_sub(physical_width) / 2) as i32;
            let y = area.position.y + (area.size.height.saturating_sub(physical_height) / 2) as i32;
            let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        } else {
            let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: current_width.max(920.0),
                height: current_height.max(620.0),
            }));
            let _ = w.center();
        }
    }
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn leave_settings_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    if w.is_maximized().unwrap_or(false) {
        let _ = w.unmaximize();
    }
    let launcher_mode = mode == "launcher";
    let _ = w.set_skip_taskbar(launcher_mode);
    let _ = w.set_always_on_top(false);
    let _ = w.set_resizable(true);
    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 480.0,
        height: 160.0,
    })));
    if let Some((x, y, width, height)) = SETTINGS_RESTORE.lock().take() {
        let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
        let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }
    let _ = w.set_focus();
    Ok(())
}

/// Parse strings like "Alt+Q", "Ctrl+Shift+Space", "F8"
fn parse_hotkey_label(s: &str) -> Result<(Modifiers, Code, String), String> {
    let raw = s.trim();
    if raw.is_empty() {
        return Err("热键为空".into());
    }
    let parts: Vec<&str> = raw
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return Err("无效热键".into());
    }
    let mut mods = Modifiers::empty();
    let key_part = parts[parts.len() - 1];
    for p in &parts[..parts.len().saturating_sub(1)] {
        match p.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "controlleft" | "controlright" => {
                mods |= Modifiers::CONTROL;
            }
            "alt" | "option" | "altleft" | "altright" => {
                mods |= Modifiers::ALT;
            }
            "shift" | "shiftleft" | "shiftright" => {
                mods |= Modifiers::SHIFT;
            }
            "super" | "meta" | "win" | "cmd" | "command" => {
                mods |= Modifiers::SUPER;
            }
            other => return Err(format!("未知修饰键: {other}")),
        }
    }
    let code = match key_part.to_ascii_lowercase().as_str() {
        "space" => Code::Space,
        "tab" => Code::Tab,
        "escape" | "esc" => Code::Escape,
        "enter" | "return" => Code::Enter,
        "f1" => Code::F1,
        "f2" => Code::F2,
        "f3" => Code::F3,
        "f4" => Code::F4,
        "f5" => Code::F5,
        "f6" => Code::F6,
        "f7" => Code::F7,
        "f8" => Code::F8,
        "f9" => Code::F9,
        "f10" => Code::F10,
        "f11" => Code::F11,
        "f12" => Code::F12,
        "a" => Code::KeyA,
        "b" => Code::KeyB,
        "c" => Code::KeyC,
        "d" => Code::KeyD,
        "e" => Code::KeyE,
        "f" => Code::KeyF,
        "g" => Code::KeyG,
        "h" => Code::KeyH,
        "i" => Code::KeyI,
        "j" => Code::KeyJ,
        "k" => Code::KeyK,
        "l" => Code::KeyL,
        "m" => Code::KeyM,
        "n" => Code::KeyN,
        "o" => Code::KeyO,
        "p" => Code::KeyP,
        "q" => Code::KeyQ,
        "r" => Code::KeyR,
        "s" => Code::KeyS,
        "t" => Code::KeyT,
        "u" => Code::KeyU,
        "v" => Code::KeyV,
        "w" => Code::KeyW,
        "x" => Code::KeyX,
        "y" => Code::KeyY,
        "z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        other => return Err(format!("不支持的按键: {other}")),
    };
    // normalize label
    let mut label_parts = Vec::new();
    if mods.contains(Modifiers::CONTROL) {
        label_parts.push("Ctrl");
    }
    if mods.contains(Modifiers::ALT) {
        label_parts.push("Alt");
    }
    if mods.contains(Modifiers::SHIFT) {
        label_parts.push("Shift");
    }
    if mods.contains(Modifiers::SUPER) {
        label_parts.push("Win");
    }
    let key_label = match key_part.to_ascii_lowercase().as_str() {
        "space" => "Space".into(),
        "escape" | "esc" => "Esc".into(),
        "enter" | "return" => "Enter".into(),
        k if k.len() == 1 => k.to_ascii_uppercase(),
        k => {
            let mut c = k.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => k.to_string(),
            }
        }
    };
    label_parts.push(key_label.as_str());
    let label = label_parts.join("+");
    let _ = key_part;
    Ok((mods, code, label))
}

fn register_hotkey_on(app: &AppHandle, label: &str) -> Result<String, String> {
    let (mods, code, norm) = parse_hotkey_label(label)?;
    let shortcut = Shortcut::new(Some(mods), code);
    // clear previous
    let _ = app.global_shortcut().unregister_all();
    let h = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                toggle_main(&h);
            }
        })
        .map_err(|e| format!("注册失败: {e}"))?;
    Ok(norm)
}

#[tauri::command]
fn set_hotkey(
    app: AppHandle,
    state: State<Arc<AppState>>,
    hotkey: String,
) -> Result<serde_json::Value, String> {
    let norm = register_hotkey_on(&app, &hotkey)?;
    {
        let mut s = state.settings.lock();
        s.hotkey = norm.clone();
        settings::save(&state.settings_path(), &s)?;
    }
    *state.hotkey.lock() = norm.clone();
    Ok(serde_json::json!({ "hotkey": norm, "ok": true }))
}

#[tauri::command]
fn open_data_dir(state: State<Arc<AppState>>) -> Result<(), String> {
    let dir = state.root.clone();
    let _ = std::fs::create_dir_all(&dir);
    std::process::Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pick_app_scan_folder() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择要扫描的软件目录'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::Write($dialog.SelectedPath)
}
"#;
        let mut command = std::process::Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ]);
        command.creation_flags(0x0800_0000);
        let output = command
            .output()
            .map_err(|e| format!("无法打开目录选择器: {e}"))?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if error.is_empty() {
                "目录选择器未能启动".into()
            } else {
                error
            });
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!path.is_empty()).then_some(path));
    }

    #[cfg(not(windows))]
    Ok(None)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileOpenOptions {
    mode: String,
    allow_file_access: bool,
}

#[cfg(windows)]
fn open_path_with_shell(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;

    let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if (result as isize) <= 32 {
        return Err(format!(
            "无法打开文件（Windows 错误码 {}）",
            result as isize
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn chromium_browser_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(variable) {
            let base = PathBuf::from(base);
            candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
            candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[tauri::command]
fn open_file_url(
    state: State<Arc<AppState>>,
    url: String,
    options: Option<FileOpenOptions>,
) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "file URL 格式无效".to_string())?;
    if parsed.scheme() != "file" {
        return Err("只支持本地 file URL".into());
    }
    let path = parsed
        .to_file_path()
        .map_err(|_| "file URL 无法转换为本地路径".to_string())?;
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let options = options.unwrap_or_default();

    #[cfg(windows)]
    {
        if options.mode.eq_ignore_ascii_case("browser") {
            let browser = chromium_browser_path().ok_or("未找到 Chrome 或 Edge 浏览器")?;
            let mut command = std::process::Command::new(browser);
            if options.allow_file_access {
                let profile = state.root.join("file-browser-profile");
                std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
                command.arg("--allow-file-access-from-files");
                command.arg("--user-data-dir").arg(profile);
            }
            command
                .arg(parsed.as_str())
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            open_path_with_shell(&path)?;
        }
    }

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn proxy_status(state: State<Arc<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.settings.lock().clone();
    let url = s.proxy_url.clone();
    let ok = web::proxy_available(&url);
    Ok(serde_json::json!({
        "proxyUrl": url,
        "available": ok,
    }))
}

#[tauri::command]
fn refresh_app_index(
    app: AppHandle,
    state: State<Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let started = start_app_index(&app, state.inner().clone(), true);
    Ok(serde_json::json!({
        "ok": true,
        "started": started,
        "status": state.index_status.lock().as_str(),
    }))
}

#[tauri::command]
fn toggle_maximize_window(app: AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };

    let os_max = w.is_maximized().unwrap_or(false);
    let filled = WIN_FILLED.load(Ordering::SeqCst);

    // restore
    if os_max || filled {
        if os_max {
            let _ = w.unmaximize();
        }
        if let Some((x, y, width, height)) = *WIN_RESTORE.lock() {
            let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
            let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        } else {
            let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 860.0,
                height: 620.0,
            }));
            let _ = w.center();
        }
        WIN_FILLED.store(false, Ordering::SeqCst);
        let _ = w.set_focus();
        return Ok(());
    }

    // save current geometry then fill work area
    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
        *WIN_RESTORE.lock() = Some((pos.x, pos.y, size.width, size.height));
    }

    if let Ok(Some(monitor)) = w.current_monitor() {
        let area = monitor.work_area();
        let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: area.position.x,
            y: area.position.y,
        }));
        let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: area.size.width,
            height: area.size.height,
        }));
        WIN_FILLED.store(true, Ordering::SeqCst);
    } else {
        let _ = w.maximize();
        WIN_FILLED.store(true, Ordering::SeqCst);
    }
    let _ = w.set_focus();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = apps::data_dir();
    let _ = std::fs::create_dir_all(root.join("icons-cache"));

    let mut settings = settings::load(&root.join("settings.json"));
    if let Err(error) =
        settings::load_provider_catalog(&root.join("ai-providers.json"), &mut settings)
    {
        eprintln!("provider catalog load error: {error}");
    }
    if settings.theme.is_empty() {
        settings.theme = "white".into();
    }
    let _ = settings::save(&root.join("settings.json"), &settings);
    let _ = settings::save_provider_catalog(&root.join("ai-providers.json"), &settings);
    let recent_list = recent::load(&root.join("recent.json"));
    let _ = recent::save(&root.join("recent.json"), &recent_list);
    let conversation_list = conversations::load(&root.join("conversations.json"));
    let cache = apps::load_cache(&root.join("apps_cache.json"));
    let cache_ready = cache.current && icons::cache_is_warm(&root.join("icons-cache"), &cache.apps);
    let initial_status = if cache_ready {
        IndexStatus::Ready
    } else {
        IndexStatus::Idle
    };
    let initial_fingerprint = if cache_ready {
        cache.source_fingerprint
    } else {
        0
    };

    let state = Arc::new(AppState {
        root: root.clone(),
        apps: Mutex::new(cache.apps),
        recent: Mutex::new(recent_list),
        settings: Mutex::new(settings),
        conversations: Mutex::new(conversation_list),
        hotkey: Mutex::new("Alt+Q".into()),
        index_status: Mutex::new(initial_status),
        icon_io: Mutex::new(()),
        source_fingerprint: AtomicU64::new(initial_fingerprint),
        ai_request_seq: AtomicU64::new(0),
        ai_abort: Mutex::new(None),
    });

    let state_for_setup = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_apps,
            get_app_icons,
            reorder_recent,
            remove_recent,
            get_conversations,
            save_conversation,
            delete_conversation,
            save_attachment,
            set_settings,
            launch_app,
            hide_window,
            set_conversation_pin,
            set_conversation_active,
            start_window_drag,
            resize_window,
            enter_viewer_mode,
            leave_viewer_mode,
            enter_cards_mode,
            enter_launcher_mode,
            enter_settings_mode,
            leave_settings_mode,
            toggle_maximize_window,
            open_data_dir,
            pick_app_scan_folder,
            open_file_url,
            proxy_status,
            refresh_app_index,
            ai_chat,
            stop_ai,
            ai_fetch_models,
            set_hotkey
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let st = state_for_setup.clone();

            // register hotkey from settings, with fallbacks
            let preferred = st.settings.lock().hotkey.clone();
            let candidates = [
                preferred.as_str(),
                "Alt+Q",
                "Alt+Space",
                "Ctrl+Shift+Space",
                "F8",
            ];
            let mut registered = false;
            for label in candidates {
                if label.trim().is_empty() {
                    continue;
                }
                match register_hotkey_on(&handle, label) {
                    Ok(norm) => {
                        *st.hotkey.lock() = norm.clone();
                        {
                            let mut s = st.settings.lock();
                            s.hotkey = norm.clone();
                            let path = st.settings_path();
                            let _ = settings::save(&path, &s);
                        }
                        println!("Hotkey OK: {norm}");
                        registered = true;
                        break;
                    }
                    Err(e) => {
                        println!("Hotkey fail {label}: {e}");
                    }
                }
            }
            if !registered {
                *st.hotkey.lock() = "(无热键)".into();
                println!("No hotkey registered");
            }

            // show main once (do this FIRST so UI loads while tray sets up)
            show_main(&handle);
            println!("show_main done");
            start_app_monitor(handle.clone(), st.clone());

            // tray
            let show_i = MenuItem::with_id(app, "show", "打开启动器", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                .unwrap_or_else(|_| Image::new(&[], 0, 0));

            let h_tray = handle.clone();
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Flux")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(&h_tray);
                    }
                })
                .build(app)?;
            println!("tray done");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
