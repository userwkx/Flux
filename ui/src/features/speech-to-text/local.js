/**
 * 本地模型模式 — MediaRecorder 录音 → Tauri Rust → whisper.cpp subprocess
 */

/**
 * 录制音频并调用本地 whisper.cpp
 * @param {object} options
 * @param {string} options.whisperBin   whisper.cpp 可执行文件路径
 * @param {string} options.modelPath    模型文件 (.bin) 路径
 * @param {(text: string) => void} options.onResult
 * @param {(error: string) => void} options.onError
 * @returns {Promise<{stop: () => void}>}
 */
export async function startLocalSTT({ whisperBin, modelPath, onResult, onError }) {
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
      stream.getTracks().forEach((t) => t.stop());

      if (stopped || audioChunks.length === 0) return;

      const blob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = [];
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      try {
        const text = await window.launcher.sttLocalTranscribe?.({
          audioBase64,
          whisperBin,
          modelPath,
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
