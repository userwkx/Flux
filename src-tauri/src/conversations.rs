use crate::ai::ChatMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CONVERSATIONS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub mode: String,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn normalize(items: &mut Vec<Conversation>) {
    items.retain(|item| !item.id.trim().is_empty() && !item.messages.is_empty());
    items.sort_by_key(|item| std::cmp::Reverse(item.updated_at));
    items.truncate(MAX_CONVERSATIONS);
}

pub fn load(path: &Path) -> Vec<Conversation> {
    let mut items = fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default();
    normalize(&mut items);
    items
}

fn save(path: &Path, items: &[Conversation]) -> Result<(), String> {
    let data = serde_json::to_vec(items).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

pub fn upsert(
    path: &Path,
    items: &mut Vec<Conversation>,
    mut conversation: Conversation,
) -> Result<(), String> {
    conversation.id = conversation.id.trim().to_string();
    if conversation.id.is_empty() {
        return Err("会话 ID 为空".into());
    }
    conversation.title = conversation.title.trim().chars().take(48).collect();
    if conversation.title.is_empty() {
        conversation.title = "新对话".into();
    }
    conversation.mode = match conversation.mode.trim() {
        "fy" => "fy".into(),
        "file" => "file".into(),
        _ => "ai".into(),
    };
    conversation
        .messages
        .retain(|message| matches!(message.role.as_str(), "user" | "assistant"));
    if conversation.messages.is_empty() {
        return Err("会话内容为空".into());
    }
    conversation.updated_at = now_millis();
    items.retain(|item| item.id != conversation.id);
    items.push(conversation);
    normalize(items);
    save(path, items)
}

pub fn remove(path: &Path, items: &mut Vec<Conversation>, id: &str) -> Result<(), String> {
    items.retain(|item| item.id != id);
    save(path, items)
}

pub fn cleanup_attachments(dir: &Path, items: &[Conversation]) {
    let keep = items
        .iter()
        .flat_map(|conversation| conversation.messages.iter())
        .flat_map(|message| message.attachments.iter())
        .map(|attachment| attachment.storage_key.as_str())
        .collect::<HashSet<_>>();
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !keep.contains(name) {
            let _ = fs::remove_file(entry.path());
        }
    }
}
