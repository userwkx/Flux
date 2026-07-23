use crate::apps::AppItem;
use crate::settings::is_clutter_app;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub name: String,
    pub target: String,
    pub kind: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub clutter: bool,
}

pub fn load(path: &Path) -> Vec<RecentItem> {
    let mut items: Vec<RecentItem> = match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => vec![],
    };
    for item in &mut items {
        item.icon.clear();
    }
    items
}

pub fn save(path: &Path, items: &[RecentItem]) -> Result<(), String> {
    let mut stored = items.to_vec();
    for item in &mut stored {
        item.icon.clear();
    }
    let data = serde_json::to_vec(&stored).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

pub fn push(path: &Path, items: &mut Vec<RecentItem>, app: &AppItem) {
    let clutter = app.clutter || is_clutter_app(&app.name, &app.target);
    if clutter {
        return;
    }
    items.retain(|r| r.target != app.target);
    items.insert(
        0,
        RecentItem {
            name: app.name.clone(),
            target: app.target.clone(),
            kind: app.kind.clone(),
            icon: String::new(),
            clutter,
        },
    );
    let _ = save(path, items);
}

pub fn reorder(path: &Path, items: &mut Vec<RecentItem>, targets: &[String]) -> Result<(), String> {
    let mut reordered = Vec::with_capacity(items.len());
    for target in targets {
        if let Some(position) = items.iter().position(|item| item.target == *target) {
            reordered.push(items.remove(position));
        }
    }
    reordered.append(items);
    *items = reordered;
    save(path, items)
}

pub fn remove(path: &Path, items: &mut Vec<RecentItem>, target: &str) -> Result<(), String> {
    items.retain(|item| item.target != target);
    save(path, items)
}

pub fn reconcile(path: &Path, items: &mut Vec<RecentItem>, apps: &[AppItem]) -> Result<(), String> {
    let indexed = apps
        .iter()
        .map(|app| (app.target.as_str(), app))
        .collect::<HashMap<_, _>>();
    items.retain(|item| indexed.contains_key(item.target.as_str()));
    for item in items.iter_mut() {
        if let Some(app) = indexed.get(item.target.as_str()) {
            item.name = app.name.clone();
            item.kind = app.kind.clone();
            item.clutter = app.clutter;
            item.icon.clear();
        }
    }
    save(path, items)
}
