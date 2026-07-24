/**
 * 在线模式 — MediaRecorder 录音 → Tauri Rust → Whisper API
 */

/**
 * 录制音频并调用在线 Whisper API
 * @param {object} options
 * @param {string} options.providerId  AI Provider ID
 * @param {string} options.model       模型名，默认 whisper-1
 * @param {(text: string) => void} options.onResult
 * @param {(error: string) => void} options.onError
 * @returns {Promise<{stop: () => void}>}
 */
export async function startOnlineSTT({ providerId, model = "whisper-1", onResult, onError }) {
  let mediaRecorder = null;
  let audioChunks = [];
  let stopped = false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      // 停止所有轨道
      stream.getTracks().forEach((t) => t.stop());

      if (stopped || audioChunks.length === 0) return;

      // 合并音频 blob → base64
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = [];
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      // 调用 Rust 后端
      try {
        const text = await window.launcher.sttOnlineTranscribe?.({
          audioBase64,
          providerId,
          model,
        });
        if (text) onResult?.(text);
      } catch (e) {
        onError?.(String(e));
      }
    };

    mediaRecorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      onError?.("录音失败");
    };

    mediaRecorder.start();
  } catch (e) {
    onError?.(`麦克风访问被拒绝: ${e.message || e}`);
    return { stop: () => {} };
  }

  return {
    stop: () => {
      stopped = true;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    },
  };
}
