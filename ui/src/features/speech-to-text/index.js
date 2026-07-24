/**
 * 功能3：语音转文字 — STT 工厂入口
 *
 * 支持三种模式：
 *   browser — 浏览器内置 Web Speech API（零配置）
 *   local   — 本地 whisper.cpp 模型
 *   online  — 在线 Whisper API
 */

import { isBrowserSTTSupported, startBrowserSTT } from "./browser.js";
import { startLocalSTT } from "./local.js";
import { startOnlineSTT } from "./online.js";

/**
 * 判断当前模式是否可用
 * @param {"browser"|"local"|"online"} mode
 * @param {{ sttLocalBinPath: string, sttLocalModelPath: string }} settingsSnap
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkSTTMode(mode, settingsSnap) {
  switch (mode) {
    case "browser":
      if (!isBrowserSTTSupported()) {
        return { ok: false, reason: "当前浏览器不支持 Web Speech API" };
      }
      return { ok: true };
    case "local":
      if (!settingsSnap.sttLocalBinPath) {
        return { ok: false, reason: "未配置 whisper.cpp 路径" };
      }
      if (!settingsSnap.sttLocalModelPath) {
        return { ok: false, reason: "未配置模型文件路径" };
      }
      return { ok: true };
    case "online":
      if (!settingsSnap.sttProviderId) {
        return { ok: false, reason: "未选择 AI 供应商" };
      }
      return { ok: true };
    default:
      return { ok: false, reason: `未知模式: ${mode}` };
  }
}

/**
 * 开始语音识别
 * @param {"browser"|"local"|"online"} mode
 * @param {object} settingsSnap
 * @param {(text: string) => void} options.onResult
 * @param {(error: string) => void} options.onError
 * @returns {Promise<{stop: () => void}>}
 */
export async function startSTT(mode, settingsSnap, { onResult, onError }) {
  const check = checkSTTMode(mode, settingsSnap);
  if (!check.ok) {
    onError?.(check.reason);
    return { stop: () => {} };
  }

  switch (mode) {
    case "browser":
      return {
        stop: startBrowserSTT({
          language: settingsSnap.sttLanguage || "auto",
          onResult,
          onError,
        }),
      };

    case "local":
      return startLocalSTT({
        whisperBin: settingsSnap.sttLocalBinPath,
        modelPath: settingsSnap.sttLocalModelPath,
        onResult,
        onError,
      });

    case "online":
      return startOnlineSTT({
        providerId: settingsSnap.sttProviderId,
        model: settingsSnap.sttModel || "whisper-1",
        onResult,
        onError,
      });

    default:
      onError?.(`未知模式: ${mode}`);
      return { stop: () => {} };
  }
}
