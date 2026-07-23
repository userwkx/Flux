import { mountTemplate } from "../shared/template.js";
import { mountAiViews } from "../commands/ai/views.js";

export async function mountShell(root) {
  await mountTemplate(root, new URL("./shell.html", import.meta.url));
  await Promise.all([
    mountTemplate(root.querySelector("[data-settings-host]"), new URL("./settings.html", import.meta.url)),
    mountAiViews({
      quickHost: root.querySelector("#ai-quick-host"),
      conversationHost: root.querySelector("#ai-conversation-host"),
      viewerHost: root.querySelector("#ai-viewer-host"),
    }),
  ]);
  return root.querySelector(".shell");
}
