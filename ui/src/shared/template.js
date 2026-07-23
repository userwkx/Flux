const templateCache = new Map();
const styleCache = new Map();

export async function loadTemplate(url) {
  const href = String(url);
  if (!templateCache.has(href)) {
    templateCache.set(
      href,
      fetch(href).then(async (response) => {
        if (!response.ok) {
          throw new Error(`无法加载界面模板: ${response.status} ${response.statusText}`);
        }
        return response.text();
      }),
    );
  }
  return templateCache.get(href);
}

export async function mountTemplate(host, url) {
  if (!host) throw new Error("界面模板缺少挂载节点");
  const template = document.createElement("template");
  template.innerHTML = await loadTemplate(url);
  host.replaceChildren(template.content.cloneNode(true));
  return host;
}

export function loadStyle(url) {
  const href = String(url);
  if (!styleCache.has(href)) {
    styleCache.set(
      href,
      new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.addEventListener("load", () => resolve(link), { once: true });
        link.addEventListener("error", () => reject(new Error(`无法加载样式: ${href}`)), { once: true });
        document.head.appendChild(link);
      }),
    );
  }
  return styleCache.get(href);
}
