import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      theme: "white",
      homeUi: "classic",
      appScanPaths: [],
      appScanDepth: 2,
      webSearch: true,
      webSearchEngine: "auto",
      proxyUrl: "http://127.0.0.1:10808",
      translateModel: "",
      translateNoThink: true,
      aiProviders: [],
      activeProviderId: "",
      aiModel: "gpt-4o-mini",
      commandOrder: ["ai", "fy", "file"],
      disabledCommands: [],
    };
    const recents = Array.from({ length: 16 }, (_, index) => ({
      name: `Recent ${index + 1}`,
      target: `C:\\Apps\\Recent-${index + 1}.exe`,
      kind: "exe",
      icon: "",
      clutter: false,
    }));
    const eventListeners = new Map();
    window.__tauriInvocations = [];
    window.__tauriInvocationCalls = [];
    window.__TAURI__ = {
      core: {
        invoke: async (command, args = {}) => {
          window.__tauriInvocations.push(command);
          window.__tauriInvocationCalls.push({ command, args });
          if (command === "get_apps") return { apps: [], recent: recents, settings };
          if (command === "get_app_icons") return {};
          if (command === "remove_recent") {
            const index = recents.findIndex((item) => item.target === args.target);
            if (index >= 0) recents.splice(index, 1);
            return recents;
          }
          if (command === "get_conversations") return [];
          if (command === "proxy_status") return { available: false };
          if (command === "set_settings") {
            Object.assign(settings, args.patch || {});
            return { settings };
          }
          if (command === "set_conversation_pin") return !!args.pinned;
          return null;
        },
      },
      event: {
        listen: async (name, handler) => {
          if (!eventListeners.has(name)) eventListeners.set(name, new Set());
          eventListeners.get(name).add(handler);
          return () => eventListeners.get(name)?.delete(handler);
        },
      },
      window: {
        getCurrentWindow: async () => ({
          minimize: async () => {},
        }),
      },
    };
  });
});

test("loads modular views and re-enters commands cleanly", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      errors.push(message.text());
    }
  });

  await page.goto("/");
  const input = page.locator("#q");
  await expect(input).toBeVisible();
  await expect(page.locator(".shell")).toHaveCSS("height", "700px");
  await page.setViewportSize({ width: 920, height: 520 });
  await expect(page.locator(".shell")).toHaveCSS("height", "520px");
  await page.setViewportSize({ width: 920, height: 700 });
  await expect(page.locator("#page-settings")).toHaveCount(1);
  await expect(page.locator("#ai-section")).toHaveCount(1);
  await expect(page.locator("#page-conversation")).toHaveCount(1);
  await expect(page.locator(".file-section")).toHaveCount(1);
  await expect(page.locator("#builtins .builtin-card")).toHaveCount(3);
  await expect(page.locator("#builtins .name")).toHaveText(["AI", "翻译", "文件"]);
  await expect(page.locator("#btn-builtin-ai .icon")).toHaveCSS("width", "44px");
  await expect(page.locator("#btn-builtin-fy .icon")).toHaveCSS("height", "44px");
  const classicBuiltinWidth = await page.locator("#btn-builtin-ai").evaluate((card) => card.getBoundingClientRect().width);
  expect(classicBuiltinWidth).toBeLessThanOrEqual(104);
  await expect(page.locator("#recent-count")).toHaveText("16");
  await expect(page.locator("#recent .recent-card")).toHaveCount(16);
  await page.setViewportSize({ width: 560, height: 700 });
  await expect.poll(() => page.locator("#recent .recent-card").count()).toBe(10);
  await page.setViewportSize({ width: 720, height: 700 });
  await expect.poll(() => page.locator("#recent .recent-card").count()).toBe(14);
  const recentRows = await page.locator("#recent .recent-card").evaluateAll((cards) =>
    new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size
  );
  expect(recentRows).toBe(2);
  const classicColumns = await page.locator("#recent .recent-card").evaluateAll((cards) =>
    cards.slice(0, 7).map((card) => Math.round(card.getBoundingClientRect().left))
  );
  await page.evaluate(() => document.body.classList.replace("ui-classic", "ui-cards"));
  const cardsColumns = await page.locator("#recent .recent-card").evaluateAll((cards) =>
    cards.slice(0, 7).map((card) => Math.round(card.getBoundingClientRect().left))
  );
  expect(cardsColumns).toEqual(classicColumns);
  if (process.env.FLUX_SCREENSHOT) {
    await page.screenshot({ path: "test-results/cards-launcher-state.png", fullPage: true });
  }
  await page.evaluate(() => document.body.classList.replace("ui-cards", "ui-classic"));
  await page.setViewportSize({ width: 920, height: 700 });
  await expect
    .poll(() => page.evaluate(() => window.__tauriInvocationCalls.find((call) => call.command === "resize_window")?.args))
    .not.toBeUndefined();
  const launcherResizeArgs = await page.evaluate(() =>
    window.__tauriInvocationCalls.find((call) => call.command === "resize_window")?.args
  );
  const expectedLauncherHeight = await page.evaluate(() => {
    const shell = document.querySelector(".shell").getBoundingClientRect();
    const builtins = document.querySelector("#builtin-section").getBoundingClientRect();
    return Math.max(300, Math.ceil(builtins.bottom - shell.top + 24));
  });
  expect(launcherResizeArgs).toMatchObject({ width: 720, height: expectedLauncherHeight });
  if (process.env.FLUX_SCREENSHOT) {
    await page.setViewportSize({ width: 720, height: 520 });
    await page.screenshot({ path: "test-results/launcher-state.png", fullPage: true });
    await page.setViewportSize({ width: 920, height: 700 });
  }

  await page.locator("#recent .recent-card").first().click({ button: "right" });
  await expect(page.locator("#recent-context-menu")).toBeVisible();
  if (process.env.FLUX_SCREENSHOT) {
    await page.screenshot({ path: "test-results/recent-context-state.png", fullPage: true });
  }
  await page.locator("#btn-remove-recent").click();
  await expect(page.locator("#recent-count")).toHaveText("15");
  await expect(page.locator("#recent-context-menu")).toBeHidden();

  await page.locator("#btn-builtin-fy").click();
  await expect(page.locator("#mode-prefix")).toContainText("Translate");
  await input.press("Escape");
  await page.locator("#btn-builtin-file").click();
  await expect(page.locator(".file-section")).toBeVisible();
  await input.press("Escape");
  await page.locator("#btn-builtin-ai").click();
  await expect(page.locator("#mode-prefix")).toContainText("AI");
  await input.press("Escape");

  await input.fill("/file");
  await expect(page.locator(".file-section")).toBeVisible();
  await page.locator('[data-file-mode="browser"]').click();
  await expect(page.locator('[data-file-mode="browser"]')).toHaveAttribute("aria-pressed", "true");
  await input.press("Escape");
  await expect(page.locator(".file-section")).toBeHidden();
  await input.fill("/file");
  await expect(page.locator(".file-section")).toBeVisible();
  await expect(page.locator(".file-section")).toHaveCount(1);

  await input.press("Escape");
  await input.fill("/fy");
  await expect(page.locator("#ai-section")).toBeVisible();
  await expect(page.locator("#mode-prefix")).toContainText("Translate");
  await expect(page.locator(".ai-more-wrap")).toBeHidden();

  await input.press("Escape");
  await input.fill("/ai");
  await expect(page.locator("#ai-section")).toBeVisible();
  await expect(page.locator("#quick-web-button")).toBeVisible();
  await expect(page.locator(".ai-more-wrap")).toBeVisible();
  await page.locator("#btn-ai-more").click();
  await page.locator("#ai-menu-mode").click();
  await expect(page.locator("#page-conversation")).toBeVisible();
  await page.locator("#btn-conversation-pin").click();
  await expect(page.locator("#btn-conversation-pin")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#btn-conversation-back").click();
  await expect(page.locator("#page-conversation")).toBeHidden();

  await page.locator("#btn-settings").click();
  await expect(page.locator("#page-settings")).toBeVisible();
  await expect(page.locator("#settings-nav")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCSS("border-radius", "14px");
  await page.locator("#settings-nav [data-panel='ai']").click();
  await page.locator("#btn-manage-providers").click();
  await expect(page.locator("#provider-panel")).toBeVisible();
  await expect(page.locator(".provider-dialog")).toHaveCSS("width", "860px");
  await expect(page.locator(".provider-dialog")).toHaveCSS("height", "560px");
  await expect(page.locator(".provider-dialog")).toHaveCSS("border-radius", "16px");
  await expect(page.locator(".provider-footer button")).toHaveCount(3);
  await expect(page.locator(".provider-footer-right button")).toHaveText(["取消", "保存"]);
  await expect(page.locator("#btn-save-ai")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  if (process.env.FLUX_SCREENSHOT) {
    await page.screenshot({ path: "test-results/provider-state.png", fullPage: true });
  }
  await page.locator("#btn-close-provider").click();
  await expect(page.locator("#provider-cancel-confirm")).toBeVisible();
  await expect(page.locator("#provider-confirm-title")).toHaveText("确认取消编辑？");
  if (process.env.FLUX_SCREENSHOT) {
    await page.screenshot({ path: "test-results/provider-confirm-state.png", fullPage: true });
  }
  await page.locator("#btn-provider-continue").click();
  await expect(page.locator("#provider-cancel-confirm")).toBeHidden();
  await page.locator("#btn-cancel-provider").click();
  await expect(page.locator("#provider-cancel-confirm")).toBeVisible();
  await expect(page.locator("#btn-provider-confirm-cancel")).toBeVisible();
  await page.locator("#btn-provider-confirm-cancel").click();
  await expect(page.locator("#provider-panel")).toBeHidden();
  await page.locator("#btn-manage-providers").click();
  await page.locator("#pv-key").fill("test-key");
  await page.locator("#btn-save-ai").click();
  await expect(page.locator("#provider-panel")).toBeHidden();
  await expect(page.locator("#settings-toast")).toContainText("供应商保存成功");
  await page.locator("#settings-nav [data-panel='general']").click();
  await page.locator("#hotkey-input").fill("Alt+R");
  await page.locator("#btn-save-hotkey").click();
  await expect(page.locator("#settings-toast")).toContainText("全局热键已保存：Alt+R");
  if (process.env.FLUX_SCREENSHOT) {
    await page.screenshot({ path: "test-results/settings-state.png", fullPage: true });
  }
  await page.locator("#btn-back").click();
  await expect(page.locator("#page-settings")).toBeHidden();
  await expect(page.locator("#ai-section")).toBeVisible();
  await expect(page.locator("#mode-prefix")).toContainText("AI");
  const invocations = await page.evaluate(() => window.__tauriInvocations);
  const enterSettings = invocations.lastIndexOf("enter_settings_mode");
  const leaveSettings = invocations.lastIndexOf("leave_settings_mode");
  expect(enterSettings).toBeGreaterThanOrEqual(0);
  expect(leaveSettings).toBeGreaterThan(enterSettings);
  expect(invocations.slice(enterSettings + 1, leaveSettings)).not.toContain("resize_window");
  expect(invocations.slice(leaveSettings + 1)).not.toContain("resize_window");
  const invocationCalls = await page.evaluate(() => window.__tauriInvocationCalls);
  expect(invocationCalls).toContainEqual({ command: "set_conversation_active", args: { active: true } });
  expect(invocationCalls).toContainEqual({ command: "set_conversation_active", args: { active: false } });
  expect(invocationCalls).toContainEqual({ command: "set_conversation_pin", args: { pinned: true } });
  expect(errors).toEqual([]);
});
