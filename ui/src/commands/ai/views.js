import { mountTemplate } from "../../shared/template.js";

export async function mountAiViews({ quickHost, conversationHost, viewerHost }) {
  await Promise.all([
    mountTemplate(quickHost, new URL("./quick.html", import.meta.url)),
    mountTemplate(conversationHost, new URL("./conversation.html", import.meta.url)),
    mountTemplate(viewerHost, new URL("./viewer.html", import.meta.url)),
  ]);
}
