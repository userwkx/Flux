export function createSettingsController(root, { onPanelChange } = {}) {
  let panel = "general";

  function showPanel(name) {
    panel = name || "general";
    root?.querySelectorAll(".nav-pill").forEach((element) => {
      element.classList.toggle("active", element.getAttribute("data-panel") === panel);
    });
    root?.querySelectorAll(".settings-panel").forEach((element) => {
      element.classList.toggle("active", element.getAttribute("data-panel") === panel);
    });
    onPanelChange?.(panel);
  }

  function enhanceDescriptions() {
    root?.querySelectorAll(".settings-panel .s-row-desc").forEach((description) => {
      const text = description.textContent.replace(/\s+/g, " ").trim();
      const title = description.parentElement?.querySelector(".s-row-title");
      if (!title) return;
      const info = document.createElement("span");
      info.className = "settings-info-tip";
      info.tabIndex = 0;
      info.setAttribute("role", "img");
      info.setAttribute("aria-label", text);
      info.dataset.tooltip = text;
      if (description.id === "ai-current-label") info.dataset.tooltipSource = description.id;
      info.textContent = "i";
      title.prepend(info);
      const nestedStatus = description.querySelector("#proxy-status-label");
      if (nestedStatus) {
        nestedStatus.classList.add("s-row-inline-value");
        title.insertAdjacentElement("afterend", nestedStatus);
        description.remove();
        return;
      }
      const dynamic = ["about-data-dir"].includes(description.id);
      if (dynamic) {
        description.classList.add("s-row-inline-value");
        title.insertAdjacentElement("afterend", description);
        return;
      }
      description.remove();
    });
  }

  root?.querySelector("#settings-nav")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-panel]");
    if (button) showPanel(button.getAttribute("data-panel"));
  });

  return {
    showPanel,
    enhanceDescriptions,
    get panel() {
      return panel;
    },
  };
}
