/**
 * 浏览器内置模式 — Web Speech API
 * 零配置即开即用，仅限 Chromium 系浏览器
 */

export function isBrowserSTTSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * 启动浏览器语音识别
 * @param {object} options
 * @param {string} options.language  zh / en / auto
 * @param {(text: string) => void} options.onResult  部分/最终结果回调
 * @param {(error: string) => void} options.onError
 * @param {() => void} options.onEnd
 * @returns {() => void} stop() 函数
 */
export function startBrowserSTT({ language = "auto", onResult, onError, onEnd }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.("浏览器不支持语音识别");
    onEnd?.();
    return () => {};
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language === "auto" ? "zh-CN" : language;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        onResult?.(transcript);
      }
    }
  };

  recognition.onerror = (event) => {
    onError?.(event.error);
  };

  recognition.onend = () => {
    onEnd?.();
  };

  try {
    recognition.start();
  } catch (e) {
    onError?.(String(e));
    onEnd?.();
    return () => {};
  }

  return () => {
    try {
      recognition.stop();
    } catch { /* ignore */ }
  };
}
