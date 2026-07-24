/**
 * 功能6：图片翻译 — 将图片作为附件发送给 LLM 进行 OCR + 翻译
 *
 * 复用功能2（quick-attach-bar）和功能4（paste image）的附件上传机制。
 * 当 /fy 命令检测到附件中包含图片时，自动增强 system prompt，
 * 提示 LLM 具备图片理解能力。
 */

/**
 * 检查当前对话消息中是否包含图片附件
 * @param {Array<{role:string, content:string, attachments?:Array<{type:string}>}>} chatHistory
 * @returns {boolean}
 */
export function hasImageAttachments(chatHistory) {
  return chatHistory.some(
    (m) =>
      Array.isArray(m.attachments) &&
      m.attachments.some((a) => {
        const t = (a.type || "").toLowerCase();
        return t.startsWith("image/") || t === "image";
      }),
  );
}

/**
 * 获取增强后的翻译 system prompt
 * 当检测到图片附件时，追加图片理解指令
 * @param {string} basePrompt  原始 system prompt
 * @param {boolean} hasImage   是否有图片附件
 * @returns {string}
 */
export function enhanceTranslatePrompt(basePrompt, hasImage) {
  if (!hasImage) return basePrompt;
  return (
    basePrompt +
    "\n\n【附加指令】用户上传了图片。请识别图片中的文字（OCR），然后翻译成目标语言。如果图片中没有文字，请描述图片内容并用目标语言概括。输出 JSON 格式与纯文本翻译一致。"
  );
}

/**
 * 获取图片附件预览描述，用于显示在界面中
 * @param {Array} attachments
 * @returns {string}
 */
export function imageAttachSummary(attachments) {
  const images = attachments.filter((a) => {
    const t = (a.type || "").toLowerCase();
    return t.startsWith("image/") || t === "image";
  });
  if (images.length === 0) return "";
  return `📷 ${images.length} 张图片已附加 — 将进行 OCR 翻译`;
}
