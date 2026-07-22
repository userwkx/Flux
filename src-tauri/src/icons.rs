use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::apps::AppItem;

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

pub fn icon_path_for(cache_dir: &Path, target: &str) -> PathBuf {
    let hash = target
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    cache_dir.join(format!("{hash:016x}.png"))
}

pub fn cached_icon_url(cache_dir: &Path, target: &str) -> Option<String> {
    let p = icon_path_for(cache_dir, target);
    if p.exists() && fs::metadata(&p).map(|m| m.len() > 0).unwrap_or(false) {
        path_to_data_url(&p)
    } else {
        None
    }
}

pub fn path_to_data_url(p: &Path) -> Option<String> {
    let bytes = fs::read(p).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{}", B64.encode(bytes)))
}

fn is_local_icon_source(source: &str) -> bool {
    let bytes = source.as_bytes();
    bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn powershell_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        value.into_owned()
    }
}

/// Treat the persistent cache as warm once most resolvable local sources have icons.
/// Some shell links and executables legitimately expose no extractable icon, so requiring
/// complete coverage would force a full rescan on every launch.
pub fn cache_is_warm(cache_dir: &Path, apps: &[AppItem]) -> bool {
    let eligible = apps
        .iter()
        .filter(|app| {
            let source = if app.icon_source.trim().is_empty() {
                app.target.as_str()
            } else {
                app.icon_source.as_str()
            };
            is_local_icon_source(source) && Path::new(source).exists()
        })
        .collect::<Vec<_>>();

    if eligible.is_empty() {
        return true;
    }

    let cached = eligible
        .iter()
        .filter(|app| {
            let path = icon_path_for(cache_dir, &app.target);
            fs::metadata(path)
                .map(|meta| meta.len() > 0)
                .unwrap_or(false)
        })
        .count();

    cached * 4 >= eligible.len() * 3
}

/// Load cached icons and extract only missing icons in one PowerShell process.
pub fn load_icons_batch(
    cache_dir: &Path,
    requests: &[(String, String)],
) -> Result<HashMap<String, String>, String> {
    let _ = fs::create_dir_all(cache_dir);
    let mut icons = HashMap::new();
    let mut jobs: Vec<(String, String, String)> = Vec::new();
    let mut seen = HashSet::new();

    for (target, icon_source) in requests.iter().take(64) {
        if target.is_empty() || !seen.insert(target.clone()) {
            continue;
        }
        if let Some(url) = cached_icon_url(cache_dir, target) {
            icons.insert(target.clone(), url);
            continue;
        }
        let source = if icon_source.trim().is_empty() {
            target
        } else {
            icon_source
        };
        if is_local_icon_source(source) {
            let out = icon_path_for(cache_dir, target);
            jobs.push((target.clone(), source.to_string(), powershell_path(&out)));
        }
    }

    if jobs.is_empty() {
        return Ok(icons);
    }

    #[derive(serde::Serialize)]
    struct Job {
        s: String,
        o: String,
    }
    let payload: Vec<Job> = jobs
        .iter()
        .map(|(_, source, output)| Job {
            s: source.clone(),
            o: output.clone(),
        })
        .collect();
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let b64 = B64.encode(json.as_bytes());

    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{b64}'))
$items = $json | ConvertFrom-Json
$created = 0
$errors = New-Object System.Collections.Generic.List[string]
foreach ($it in $items) {{
  try {{
    if (Test-Path -LiteralPath $it.o) {{ continue }}
    $source = $it.s
    if (-not (Test-Path -LiteralPath $source) -and $source -match '^(.*),-?\d+$') {{
      $source = $Matches[1]
    }}
    if (-not (Test-Path -LiteralPath $source)) {{ continue }}
    $ext = [IO.Path]::GetExtension($source).ToLowerInvariant()
    if ($ext -eq '.png') {{
      [IO.File]::Copy($source, $it.o, $true)
      $created++
      continue
    }}
    if ($ext -eq '.jpg' -or $ext -eq '.jpeg' -or $ext -eq '.bmp') {{
      $img = [System.Drawing.Image]::FromFile($source)
      $img.Save($it.o, [System.Drawing.Imaging.ImageFormat]::Png)
      $img.Dispose()
      $created++
      continue
    }}
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($source)
    if ($null -eq $icon) {{ continue }}
    $bmp = $icon.ToBitmap()
    $dir = Split-Path -Parent $it.o
    if (-not (Test-Path $dir)) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}
    $bmp.Save($it.o, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose(); $icon.Dispose()
    $created++
  }} catch {{
    $errors.Add("$source :: $($_.Exception.Message)")
  }}
}}
[pscustomobject]@{{ created = $created; errors = $errors }} | ConvertTo-Json -Compress
"#
    );

    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &script,
    ]);
    let output = without_console(&mut command)
        .output()
        .map_err(|e| format!("icon extraction: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "icon extraction exit {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let report = String::from_utf8_lossy(&output.stdout);
    if report.contains("\"errors\":[") && !report.contains("\"errors\":[]") {
        eprintln!("icon extraction report: {}", report.trim());
    }

    for (target, _, _) in jobs {
        if let Some(url) = cached_icon_url(cache_dir, &target) {
            icons.insert(target, url);
        }
    }
    Ok(icons)
}

/// Populate every missing icon after an index sync and remove PNGs for uninstalled apps.
pub fn sync_icon_cache(cache_dir: &Path, apps: &[AppItem]) -> Result<(), String> {
    let requests = apps
        .iter()
        .map(|app| (app.target.clone(), app.icon_source.clone()))
        .collect::<Vec<_>>();
    for chunk in requests.chunks(48) {
        load_icons_batch(cache_dir, chunk)?;
    }

    let keep = apps
        .iter()
        .map(|app| icon_path_for(cache_dir, &app.target))
        .collect::<HashSet<_>>();
    if let Ok(entries) = fs::read_dir(cache_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("png")
                && !keep.contains(&path)
            {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}
