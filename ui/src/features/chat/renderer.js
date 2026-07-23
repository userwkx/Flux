export function createChatRenderer({
  els,
  getState,
  getStreamRenderFrame,
  setStreamRenderFrame,
  currentModeDef,
  openViewer,
  updateConversationJumpBottom,
  renderMarkdown,
  enhanceCodeBlocks,
  escapeHtml,
}) {
  function renderToolRows(container, toolRows) {
    if (!toolRows.length) return;
    const wrap = document.createElement("div");
    wrap.className = "ai-tools";
    for (const tool of toolRows) {
      const row = document.createElement("div");
      row.className = `ai-tool-row is-${tool.status || "running"}`;
      const icon = tool.kind === "webfetch" ? "%" : "◈";
      const status = tool.status === "done" ? "✓" : tool.status === "error" ? "✗" : "•";
      const tooltip = [tool.title, tool.detail, tool.url].filter(Boolean).join("\n");
      const title = tool.status === "error" && tool.detail ? `${tool.title} — ${tool.detail}` : tool.title;
      row.innerHTML = `<span class="tool-icon">${icon}</span>
        <span class="tool-title" title="${escapeHtml(tooltip)}">${escapeHtml(title)}</span>
        <span class="tool-status">${status}</span>`;
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  function updateAiStopControls() {
    const { aiBusy, aiStopping } = getState();
    els.btnAiStop?.classList.toggle("hidden", !aiBusy);
    if (els.btnAiStop) els.btnAiStop.disabled = aiStopping;
    els.conversationSend?.classList.toggle("is-stopping", aiBusy);
  }

  async function copyAssistantMessage(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add("is-copied");
      button.title = "已复制";
      button.setAttribute("aria-label", "已复制");
      setTimeout(() => {
        button.classList.remove("is-copied");
        button.title = "复制";
        button.setAttribute("aria-label", "复制");
      }, 1200);
    } catch {
      button.title = "复制失败";
    }
  }

  function createAssistantActions(content) {
    const actions = document.createElement("div");
    actions.className = "ai-message-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ai-message-action ai-message-copy";
    copy.title = "复制";
    copy.setAttribute("aria-label", "复制");
    copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
    copy.addEventListener("click", () => copyAssistantMessage(content, copy));
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "ai-message-action";
    expand.title = "全屏查看";
    expand.setAttribute("aria-label", "全屏查看");
    expand.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
    expand.addEventListener("click", () => openViewer(content));
    actions.append(copy, expand);
    return actions;
  }

  function renderThread(options = {}) {
    const { streaming = false, errorText = "" } = options;
    if (!els.aiThread) return;
    const { aiBusy, chatHistory, conversationModeOpen, streamingAssistant, toolRows } = getState();
    updateAiStopControls();
    const previousScrollTop = els.aiThread.scrollTop;
    const shouldStickToBottom = els.aiThread.scrollHeight - els.aiThread.scrollTop - els.aiThread.clientHeight < 90;
    const command = currentModeDef();
    const hasDedicatedResult = typeof command?.parseResult === "function" && typeof command?.renderResult === "function";
    els.aiThread.innerHTML = "";
    els.aiThread.classList.toggle("fy-thread", command?.resultKind === "translate");

    if (hasDedicatedResult) {
      const lastUser = [...chatHistory].reverse().find((message) => message.role === "user");
      const lastAssistant = [...chatHistory].reverse().find((message) => message.role === "assistant");
      if (lastUser) {
        const query = document.createElement("div");
        query.className = "fy-qbar";
        query.innerHTML = `<span class="fy-cmd">${escapeHtml(command.label)}</span><span class="fy-q">${escapeHtml(lastUser.content)}</span>`;
        els.aiThread.appendChild(query);
      }
      if (streaming || (aiBusy && !errorText && !lastAssistant)) {
        const thinking = document.createElement("div");
        thinking.className = "fy-card thinking";
        thinking.innerHTML = `<div class="ai-thinking" aria-label="${escapeHtml(command.title)}中"><span class="ai-thinking-dots"><i></i><i></i><i></i></span><span class="ai-thinking-label">${escapeHtml(command.title)}中</span></div>`;
        els.aiThread.appendChild(thinking);
      } else if (lastAssistant) {
        const payload = command.parseResult(lastAssistant.content);
        if (payload) els.aiThread.appendChild(command.renderResult(payload));
      }
      if (errorText) {
        const error = document.createElement("div");
        error.className = "ai-msg error";
        error.textContent = errorText;
        els.aiThread.appendChild(error);
      }
      els.aiMenuFollowup?.classList.add("hidden");
      els.aiThread.scrollTop = shouldStickToBottom ? els.aiThread.scrollHeight : previousScrollTop;
      updateConversationJumpBottom();
      return;
    }

    let toolsPlaced = false;
    chatHistory.forEach((message, index) => {
      const bubble = document.createElement("div");
      bubble.className = `ai-msg ${message.role === "user" ? "user" : "assistant"}`;
      const head = document.createElement("div");
      head.className = "ai-msg-head";
      const role = document.createElement("div");
      role.className = "ai-role";
      role.textContent = message.role === "user" ? "你" : "AI";
      head.appendChild(role);
      const body = document.createElement("div");
      body.className = "ai-md";
      if (message.role === "assistant") {
        body.innerHTML = renderMarkdown(message.content);
        enhanceCodeBlocks(body);
      } else {
        body.textContent = message.content;
      }
      if (Array.isArray(message.attachments) && message.attachments.length) {
        const files = document.createElement("div");
        files.className = "ai-message-attachments";
        for (const attachment of message.attachments) {
          const file = document.createElement("span");
          file.textContent = attachment.name || "附件";
          file.title = attachment.name || "附件";
          files.appendChild(file);
        }
        body.appendChild(files);
      }
      bubble.append(head, body);
      if (message.role === "assistant") bubble.appendChild(createAssistantActions(message.content));
      els.aiThread.appendChild(bubble);
      const isLastUser = message.role === "user" && !chatHistory.slice(index + 1).some((item) => item.role === "user");
      if (isLastUser && toolRows.length) {
        renderToolRows(els.aiThread, toolRows);
        toolsPlaced = true;
      }
    });
    if (!toolsPlaced && toolRows.length) renderToolRows(els.aiThread, toolRows);

    if (streaming || (aiBusy && !errorText)) {
      const hasText = !!streamingAssistant?.trim();
      const bubble = document.createElement("div");
      bubble.className = `ai-msg assistant ${hasText ? "streaming" : "thinking"}`;
      const head = document.createElement("div");
      head.className = "ai-msg-head";
      head.innerHTML = '<div class="ai-role">AI</div>';
      const body = document.createElement("div");
      body.className = "ai-md";
      if (hasText) {
        body.innerHTML = renderMarkdown(streamingAssistant);
        enhanceCodeBlocks(body);
      } else {
        body.innerHTML = '<div class="ai-thinking" aria-label="思考中"><span class="ai-thinking-dots"><i></i><i></i><i></i></span><span class="ai-thinking-label">思考中</span></div>';
      }
      bubble.append(head, body);
      els.aiThread.appendChild(bubble);
    }

    if (errorText) {
      const bubble = document.createElement("div");
      bubble.className = "ai-msg error";
      bubble.innerHTML = '<div class="ai-role">错误</div>';
      const body = document.createElement("div");
      body.className = "ai-md";
      body.textContent = errorText;
      bubble.appendChild(body);
      els.aiThread.appendChild(bubble);
    }

    const canFollow = !aiBusy && chatHistory.some((message) => message.role === "assistant") && !errorText;
    els.aiMenuFollowup?.classList.toggle("hidden", !canFollow);
    els.aiThread.scrollTop = shouldStickToBottom ? els.aiThread.scrollHeight : previousScrollTop;
    updateConversationJumpBottom();
  }

  function scheduleStreamingRender() {
    if (getStreamRenderFrame()) return;
    setStreamRenderFrame(requestAnimationFrame(() => {
      setStreamRenderFrame(0);
      renderThread({ streaming: true });
    }));
  }

  function upsertToolRow(payload) {
    if (!payload?.id) return;
    const { toolRows, aiBusy } = getState();
    const index = toolRows.findIndex((tool) => tool.id === payload.id);
    const row = {
      id: payload.id,
      kind: payload.kind || "tool",
      status: payload.status || "running",
      title: payload.title || payload.kind || "tool",
      detail: payload.detail || "",
      url: payload.url || "",
    };
    if (index >= 0) toolRows[index] = { ...toolRows[index], ...row };
    else toolRows.push(row);
    renderThread({ streaming: aiBusy, errorText: "" });
  }

  return { renderThread, scheduleStreamingRender, updateAiStopControls, upsertToolRow };
}
