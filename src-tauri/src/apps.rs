use crate::pinyin_util::build_pinyin_fields;
use crate::settings::is_clutter_app;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

const CACHE_VERSION: u32 = 4;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn without_console(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

struct StableHasher(u64);

impl StableHasher {
    fn new() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl Hasher for StableHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 = (self.0 ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppItem {
    pub name: String,
    pub target: String,
    pub kind: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub icon_source: String,
    #[serde(default)]
    pub clutter: bool,
    #[serde(default)]
    pub py: String,
    #[serde(default)]
    pub py_initials: String,
    #[serde(default)]
    pub py_words: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Deserialize)]
struct RawItem {
    #[serde(alias = "Name")]
    name: Option<String>,
    #[serde(alias = "Target", alias = "AppID")]
    target: Option<String>,
    #[serde(alias = "Source")]
    source: Option<String>,
    #[serde(alias = "IconSource")]
    icon_source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppCache {
    version: u32,
    #[serde(default)]
    source_fingerprint: u64,
    apps: Vec<AppItem>,
}

pub struct LoadedCache {
    pub apps: Vec<AppItem>,
    pub current: bool,
    pub source_fingerprint: u64,
}

fn clean_app_name(name: &str) -> String {
    let mut n = name.trim().to_string();
    for suf in [" - 快捷方式", " - Shortcut", ".lnk", ".exe"] {
        if let Some(stripped) = n.strip_suffix(suf) {
            n = stripped.trim().to_string();
        }
        // case-insensitive for english
        if n.to_ascii_lowercase().ends_with(&suf.to_ascii_lowercase()) && suf.is_ascii() {
            let len = n.len().saturating_sub(suf.len());
            n = n[..len].trim().to_string();
        }
    }
    if n.is_empty() {
        name.trim().to_string()
    } else {
        n
    }
}

fn looks_like_path(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return true;
    }
    let b = s.as_bytes();
    b.len() >= 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

fn run_ps_b64_json(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
    ]);
    let output = without_console(&mut command)
        .output()
        .map_err(|e| format!("powershell spawn: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("powershell exit {:?}: {err}", output.status.code()));
    }
    let b64 = String::from_utf8_lossy(&output.stdout)
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();
    if b64.is_empty() {
        return Err("empty powershell stdout".into());
    }
    let bytes = B64
        .decode(b64.as_bytes())
        .map_err(|e| format!("base64 decode: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("utf8: {e}"))
}

fn strip_runtime_icons(apps: &mut [AppItem]) {
    for app in apps.iter_mut() {
        app.icon.clear();
        if app.icon_source.is_empty() {
            app.icon_source = app.target.clone();
        }
    }
}

/// Load cached metadata without touching PowerShell. Legacy array caches are accepted once,
/// then upgraded by the first background sync.
pub fn load_cache(cache_file: &Path) -> LoadedCache {
    let Ok(data) = fs::read(cache_file) else {
        return LoadedCache {
            apps: Vec::new(),
            current: false,
            source_fingerprint: 0,
        };
    };
    if let Ok(mut cache) = serde_json::from_slice::<AppCache>(&data) {
        strip_runtime_icons(&mut cache.apps);
        return LoadedCache {
            current: cache.version == CACHE_VERSION,
            source_fingerprint: cache.source_fingerprint,
            apps: cache.apps,
        };
    }
    let mut apps = serde_json::from_slice::<Vec<AppItem>>(&data).unwrap_or_default();
    strip_runtime_icons(&mut apps);
    LoadedCache {
        apps,
        current: false,
        source_fingerprint: 0,
    }
}

/// Save only searchable metadata. Icon bytes live in icons-cache as independent PNG files.
pub fn save_cache(cache_file: &Path, apps: &[AppItem], source_fingerprint: u64) {
    let mut cached = apps.to_vec();
    strip_runtime_icons(&mut cached);
    let cache = AppCache {
        version: CACHE_VERSION,
        source_fingerprint,
        apps: cached,
    };
    if let Ok(json) = serde_json::to_vec(&cache) {
        let _ = fs::write(cache_file, json);
    }
}

pub fn collect_apps(scan_paths: &[String], scan_depth: usize) -> Result<Vec<AppItem>, String> {
    let scan_paths_json = serde_json::to_vec(scan_paths).map_err(|e| format!("scan paths: {e}"))?;
    let scan_paths_b64 = B64.encode(scan_paths_json);
    let scan_depth = scan_depth.min(5);
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$items = New-Object System.Collections.Generic.List[object]
$shell = New-Object -ComObject Shell.Application
$appsFolder = $shell.Namespace('shell:AppsFolder')
$appxByFamily = @{}
Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.PackageFamilyName -and $_.InstallLocation) {
    $appxByFamily[$_.PackageFamilyName] = $_.InstallLocation
  }
}
$customRootsJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__FLUX_SCAN_PATHS__'))
$customRoots = @()
try { $customRoots = @($customRootsJson | ConvertFrom-Json) } catch {}
$customDepth = __FLUX_SCAN_DEPTH__

function Resolve-AppxLogo([string]$appUserModelId) {
  try {
    $parts = $appUserModelId -split '!', 2
    if ($parts.Count -ne 2) { return '' }
    $install = $appxByFamily[$parts[0]]
    if (-not $install) { return '' }
    $manifestPath = Join-Path $install 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $manifestPath)) { return '' }
    $manifest = [xml](Get-Content -Raw -LiteralPath $manifestPath)
    $appNode = @($manifest.Package.Applications.Application) |
      Where-Object { $_.Id -eq $parts[1] } | Select-Object -First 1
    if ($null -eq $appNode) { return '' }
    $relative = $appNode.VisualElements.Square44x44Logo
    if (-not $relative) { $relative = $appNode.VisualElements.Square150x150Logo }
    if (-not $relative) { return '' }
    $plain = Join-Path $install $relative
    if (Test-Path -LiteralPath $plain) { return $plain }
    $dir = Split-Path -Parent $plain
    $stem = [IO.Path]::GetFileNameWithoutExtension($plain)
    $variants = @(Get-ChildItem -LiteralPath $dir -Filter ($stem + '*.png') -File -ErrorAction SilentlyContinue)
    $best = $variants | Sort-Object @{ Expression = {
      if ($_.Name -match 'targetsize-48.*unplated') { 0 }
      elseif ($_.Name -match 'targetsize-48') { 1 }
      elseif ($_.Name -match 'scale-200') { 2 }
      elseif ($_.Name -match 'scale-100') { 3 }
      else { 4 }
    }} | Select-Object -First 1
    if ($best) { return $best.FullName }
  } catch {}
  return ''
}

foreach ($a in (Get-StartApps)) {
  $iconSource = ''
  try {
    $shellItem = $appsFolder.ParseName($a.AppID)
    if ($null -ne $shellItem) {
      $iconSource = $shellItem.ExtendedProperty('System.Link.TargetParsingPath')
    }
  } catch {}
  if (-not $iconSource -and $a.AppID -like '*!*') {
    $iconSource = Resolve-AppxLogo $a.AppID
  }
  $items.Add([pscustomobject]@{
    Name = $a.Name; Target = $a.AppID; Source = 'start'; IconSource = $iconSource
  }) | Out-Null
}

$sh = New-Object -ComObject WScript.Shell
$deskRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
)
foreach ($root in $deskRoots) {
  if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $sc = $sh.CreateShortcut($_.FullName)
      $t = $sc.TargetPath
      if (-not $t) { $t = $_.FullName }
      $items.Add([pscustomobject]@{
        Name = $_.BaseName; Target = $t; Source = 'desktop'; IconSource = $t
      }) | Out-Null
    } catch {}
  }
}

function Add-CustomApp($file) {
  if ($file.BaseName -match '(?i)(^|[._ -])(setup|install|uninstall|unins|update|crash|helper|repair|remove)([._ -]|$)') { return }
  $target = $file.FullName
  $iconSource = $target
  if ($file.Extension -ieq '.lnk') {
    try {
      $sc = $sh.CreateShortcut($file.FullName)
      if ($sc.TargetPath) { $target = $sc.TargetPath }
      if ($sc.IconLocation) { $iconSource = ($sc.IconLocation -split ',', 2)[0] }
      if (-not $iconSource) { $iconSource = $target }
    } catch {}
  }
  if (-not $target) { return }
  $items.Add([pscustomobject]@{
    Name = $file.BaseName; Target = $target; Source = 'custom'; IconSource = $iconSource
  }) | Out-Null
}

foreach ($root in @($customRoots)) {
  $folder = [string]$root
  if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
  Get-ChildItem -LiteralPath $folder -File -Recurse -Depth $customDepth -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -ieq '.exe' -or $_.Extension -ieq '.lnk' } |
    ForEach-Object { Add-CustomApp $_ }
}

$json = ($items | ConvertTo-Json -Compress -Depth 4)
if (-not $json) { $json = '[]' }
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
[Console]::Out.Write([Convert]::ToBase64String($bytes))
"#
    .replace("__FLUX_SCAN_PATHS__", &scan_paths_b64)
    .replace("__FLUX_SCAN_DEPTH__", &scan_depth.to_string());

    let json = run_ps_b64_json(&script)?;
    let raw: Vec<RawItem> = serde_json::from_str(&json).map_err(|e| format!("json: {e}"))?;

    let mut list = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for item in raw {
        let name = clean_app_name(item.name.as_deref().unwrap_or(""));
        let target = item.target.as_deref().unwrap_or("").trim().to_string();
        if name.is_empty() || target.is_empty() {
            continue;
        }
        let key = name.to_lowercase();
        let tkey = format!("t:{}", target.to_lowercase());
        if seen.contains(&key) || seen.contains(&tkey) {
            continue;
        }
        seen.insert(key);
        seen.insert(tkey);

        let kind = if looks_like_path(&target) {
            "path"
        } else {
            "appid"
        }
        .to_string();
        let (py, py_initials, py_words) = build_pinyin_fields(&name);
        let clutter = is_clutter_app(&name, &target);
        list.push(AppItem {
            name,
            target,
            kind,
            icon: String::new(),
            icon_source: item.icon_source.unwrap_or_default(),
            clutter,
            py,
            py_initials,
            py_words,
            source: item.source.unwrap_or_else(|| "start".into()),
        });
    }

    list.sort_by_cached_key(|app| app.name.to_lowercase());
    Ok(list)
}

fn source_roots(custom_paths: &[String], custom_depth: usize) -> Vec<(PathBuf, usize, bool)> {
    let mut roots = Vec::new();
    if let Some(value) = std::env::var_os("APPDATA") {
        roots.push((
            PathBuf::from(value).join("Microsoft/Windows/Start Menu/Programs"),
            6,
            true,
        ));
    }
    if let Some(value) = std::env::var_os("PROGRAMDATA") {
        roots.push((
            PathBuf::from(value).join("Microsoft/Windows/Start Menu/Programs"),
            6,
            true,
        ));
    }
    if let Some(value) = std::env::var_os("USERPROFILE") {
        roots.push((PathBuf::from(value).join("Desktop"), 2, true));
    }
    if let Some(value) = std::env::var_os("PUBLIC") {
        roots.push((PathBuf::from(value).join("Desktop"), 2, true));
    }
    if let Some(value) = std::env::var_os("LOCALAPPDATA") {
        roots.push((PathBuf::from(value).join("Packages"), 1, false));
    }
    roots.push((PathBuf::from(r"C:\Windows\SystemApps"), 1, false));
    for path in custom_paths {
        let path = path.trim();
        if !path.is_empty() {
            roots.push((PathBuf::from(path), custom_depth, true));
        }
    }
    roots
}

fn hash_tree(path: &Path, depth: usize, include_metadata: bool, hasher: &mut impl Hasher) {
    path.to_string_lossy().to_ascii_lowercase().hash(hasher);
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if include_metadata {
        metadata.len().hash(hasher);
        metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
            .unwrap_or(0)
            .hash(hasher);
    }
    if depth == 0 || !metadata.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort_by_cached_key(|entry| entry.to_string_lossy().to_ascii_lowercase());
    for entry in paths {
        hash_tree(&entry, depth - 1, include_metadata, hasher);
    }
}

/// Cheap install-source snapshot used by the background monitor. It avoids running
/// Get-StartApps until a Start menu, desktop, package, or portable-app directory changes.
pub fn source_fingerprint(custom_paths: &[String], custom_depth: usize) -> u64 {
    let mut hasher = StableHasher::new();
    for (root, depth, include_metadata) in source_roots(custom_paths, custom_depth) {
        depth.hash(&mut hasher);
        hash_tree(&root, depth, include_metadata, &mut hasher);
    }
    hasher.finish()
}

pub fn launch_app(app: &AppItem) -> Result<(), String> {
    let target = &app.target;
    if app.kind == "path" || looks_like_path(target) {
        // Use cmd start for shell associations / lnk / urls
        let mut command = Command::new("cmd.exe");
        command.args(["/c", "start", "", target]);
        without_console(&mut command)
            .spawn()
            .map_err(|e| format!("launch path: {e}"))?;
    } else {
        Command::new("explorer.exe")
            .arg(format!("shell:AppsFolder\\{target}"))
            .spawn()
            .map_err(|e| format!("launch appid: {e}"))?;
    }
    Ok(())
}

pub fn data_dir() -> PathBuf {
    // Prefer project root (contains settings.json / icons-cache next to ui/)
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidates = [
        cwd.clone(),
        cwd.join(".."),
        cwd.join("../.."),
        cwd.join("../../.."),
    ];
    for c in candidates {
        if c.join("ui/index.html").exists() || c.join("settings.json").exists() {
            return c.canonicalize().unwrap_or(c);
        }
        if c.join("index.html").exists() && c.join("src-tauri").exists() {
            return c.canonicalize().unwrap_or(c);
        }
    }
    let mut p = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    p.pop();
    p
}

#[cfg(test)]
mod tests {
    use super::AppItem;

    #[test]
    fn app_item_accepts_the_persisted_recent_item_shape() {
        let item: AppItem = serde_json::from_str(
            r#"{"name":"Flux","target":"C:\\Flux\\flux.exe","kind":"path","clutter":false}"#,
        )
        .unwrap();

        assert_eq!(item.name, "Flux");
        assert!(item.py.is_empty());
        assert!(item.icon_source.is_empty());
    }
}
