/**
 * Custom dropdown — replaces native <select> with a styled popup panel
 * that matches the trigger's rounded card style.
 * Usage: call CustomDropdown.mountAll() once after DOM ready.
 * Native <select> stays in DOM (hidden) for value/form compatibility.
 */
(function () {
  const CustomDropdown = {
    instances: new WeakMap(),

    mountAll(root = document) {
      root.querySelectorAll("select:not(.cd-managed):not(.hidden)").forEach((sel) => {
        if (sel.classList.contains("cd-managed")) return;
        CustomDropdown.mount(sel);
      });
    },

    mount(select) {
      if (select.classList.contains("cd-managed")) return;
      select.classList.add("cd-managed");

      // wrap in a container
      const wrap = document.createElement("div");
      wrap.className = "cd-wrap";
      // preserve sizing classes from the select
      if (select.classList.contains("s-select")) wrap.classList.add("cd-s-select");
      select.parentNode.insertBefore(wrap, select);
      wrap.appendChild(select);
      // hide native visually but keep accessible
      select.classList.add("cd-native");
      // move appearance:none already applied via CSS; ensure not focusable by tab
      select.tabIndex = -1;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "cd-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");

      const label = document.createElement("span");
      label.className = "cd-label";
      trigger.appendChild(label);

      const chev = document.createElement("span");
      chev.className = "cd-chevron";
      chev.setAttribute("aria-hidden", "true");
      chev.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      trigger.appendChild(chev);

      const panel = document.createElement("div");
      panel.className = "cd-panel";
      panel.setAttribute("role", "listbox");
      panel.hidden = true;

      wrap.appendChild(trigger);
      wrap.appendChild(panel);

      const inst = { select, trigger, panel, label, open: false, items: [] };
      CustomDropdown.instances.set(select, inst);

      const render = () => {
        // label
        const opt = select.options[select.selectedIndex];
        label.textContent = opt ? opt.textContent : "";
        // panel items
        panel.innerHTML = "";
        inst.items = [];
        [...select.options].forEach((o, i) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "cd-item" + (i === select.selectedIndex ? " active" : "");
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", i === select.selectedIndex ? "true" : "false");
          item.textContent = o.textContent;
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            select.selectedIndex = i;
            syncAndClose();
            select.dispatchEvent(new Event("change", { bubbles: true }));
          });
          panel.appendChild(item);
          inst.items.push(item);
        });
      };

      const open = () => {
        if (inst.open) return;
        inst.open = true;
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        wrap.classList.add("cd-open");
        // mark active item
        const idx = select.selectedIndex;
        inst.items.forEach((el, i) => el.classList.toggle("active", i === idx));
        const active = inst.items[idx];
        if (active) active.scrollIntoView({ block: "nearest" });
        // outside click
        setTimeout(() => {
          document.addEventListener("mousedown", onOutside, true);
          document.addEventListener("keydown", onKey);
        }, 0);
      };

      const close = () => {
        if (!inst.open) return;
        inst.open = false;
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        wrap.classList.remove("cd-open");
        document.removeEventListener("mousedown", onOutside, true);
        document.removeEventListener("keydown", onKey);
      };

      const syncAndClose = () => {
        const opt = select.options[select.selectedIndex];
        label.textContent = opt ? opt.textContent : "";
        close();
      };

      const onOutside = (e) => {
        if (!wrap.contains(e.target)) close();
      };

      const onKey = (e) => {
        if (!inst.open) return;
        const idx = select.selectedIndex;
        if (e.key === "Escape") {
          e.preventDefault();
          close();
          trigger.focus();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          const n = Math.min(idx + 1, select.options.length - 1);
          if (n !== idx) {
            select.selectedIndex = n;
            inst.items.forEach((el, i) => el.classList.toggle("active", i === n));
            inst.items[n]?.scrollIntoView({ block: "nearest" });
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const n = Math.max(idx - 1, 0);
          if (n !== idx) {
            select.selectedIndex = n;
            inst.items.forEach((el, i) => el.classList.toggle("active", i === n));
            inst.items[n]?.scrollIntoView({ block: "nearest" });
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          syncAndClose();
          select.dispatchEvent(new Event("change", { bubbles: true }));
          trigger.focus();
        }
      };

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (inst.open) close();
        else open();
      });

      // sync when native value changes programmatically (debounced)
      let renderTimer = null;
      const debouncedRender = () => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => render(), 50);
      };
      const obs = new MutationObserver(debouncedRender);
      obs.observe(select, { childList: true });
      select.addEventListener("change", () => {
        const opt = select.options[select.selectedIndex];
        label.textContent = opt ? opt.textContent : "";
      });

      render();
    },
  };

  window.CustomDropdown = CustomDropdown;

  // auto-mount on DOMContentLoaded + re-scan on demand
  function autoMount() {
    CustomDropdown.mountAll(document);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
  window.addEventListener("load", autoMount);
})();
