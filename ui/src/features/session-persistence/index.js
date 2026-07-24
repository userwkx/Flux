/**
 * 功能7：会话持久化 — 窗口重新打开时自动恢复最近会话
 *
 * 在 boot() 中调用 restoreLastConversation() 即可。
 * 保留时间通过 settingsSnap.conversationRetentionHours 控制：
 *   0  = 永久保留（默认）
 *   1  = 1 小时
 *   24 = 24 小时
 *   168 = 7 天 (24×7)
 */

/**
 * 判断会话是否在保留时间内
 * @param {{ updatedAt: number }} conversation
 * @param {number} retentionHours  0 表示永久
 * @returns {boolean}
 */
export function isConversationWithinRetention(conversation, retentionHours) {
  if (!conversation || !conversation.updatedAt) return false;
  if (retentionHours === 0) return true; // 永久保留
  const now = Date.now();
  const ageMs = now - conversation.updatedAt;
  const maxAgeMs = retentionHours * 60 * 60 * 1000;
  return ageMs <= maxAgeMs;
}

/**
 * 从 conversations 列表中找出最近的有效会话
 * @param {Array} conversations
 * @param {number} retentionHours
 * @returns {object|null}
 */
export function findLastConversation(conversations, retentionHours) {
  if (!Array.isArray(conversations) || conversations.length === 0) return null;
  // conversations 已按 updatedAt 降序排列（见 conversations.rs normalize）
  for (const conv of conversations) {
    if (isConversationWithinRetention(conv, retentionHours)) {
      return conv;
    }
  }
  return null;
}

/**
 * 在 boot() 完成后调用，自动恢复最近的有效会话
 * @param {Array} conversations  已加载的会话列表
 * @param {{ conversationRetentionHours: number }} settingsSnap
 * @param {(conversation: object) => void} openConversation
 * @returns {boolean} 是否恢复了会话
 */
export function restoreLastConversation(conversations, settingsSnap, openConversation) {
  const retentionHours = settingsSnap.conversationRetentionHours ?? 0;
  const last = findLastConversation(conversations, retentionHours);
  if (!last) return false;
  openConversation(last);
  return true;
}
