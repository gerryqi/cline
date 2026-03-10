import type { Webview } from "vscode";

export function getWebviewHtml(webview: Webview): string {
	const nonce = createNonce();
	const csp = [
		"default-src 'none'",
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join("; ");
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cline RPC Chat</title>
  <style>
    :root {
      --bg: #111319;
      --panel: #171a21;
      --panel-2: #1f2430;
      --text: #e7ebf2;
      --muted: #9ea6b6;
      --accent: #48b0f7;
      --danger: #e36f7f;
      --border: #2d3444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, #22283a, var(--bg) 60%);
      color: var(--text);
      font: 13px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 10px;
      padding: 12px;
    }
    .controls,
    .composer,
    .status {
      background: color-mix(in srgb, var(--panel), #000 8%);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    input, select, textarea, button {
      font: inherit;
      color: var(--text);
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 9px;
    }
    textarea { resize: vertical; min-height: 76px; }
    #messages {
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      background: rgba(9, 11, 16, 0.52);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .msg { white-space: pre-wrap; word-break: break-word; padding: 8px 10px; border-radius: 8px; }
    .msg.user { background: rgba(72, 176, 247, 0.15); border: 1px solid rgba(72, 176, 247, 0.35); }
    .msg.assistant { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); }
    .msg.meta { color: var(--muted); font-size: 12px; border: 1px dashed var(--border); }
    .row { display: flex; gap: 8px; align-items: center; }
    .row.spread { justify-content: space-between; }
    button {
      cursor: pointer;
      background: linear-gradient(180deg, #2f9fe9, #2384c4);
      border-color: #3293d8;
      color: #f4faff;
    }
    button.secondary {
      background: var(--panel-2);
      border-color: var(--border);
      color: var(--text);
    }
    button.danger {
      background: color-mix(in srgb, var(--danger), #000 20%);
      border-color: color-mix(in srgb, var(--danger), #fff 10%);
    }
    #statusText { color: var(--muted); }
    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <section class="controls">
    <div class="grid">
      <label>Provider
        <select id="provider"></select>
      </label>
      <label>Model
        <select id="model"></select>
      </label>
      <label>Workspace
        <input id="workspaceRoot" type="text" readonly />
      </label>
      <label>Max Iterations
        <input id="maxIterations" type="number" min="1" step="1" placeholder="Default" />
      </label>
    </div>
    <label style="margin-top: 8px;">System Prompt
      <textarea id="systemPrompt" placeholder="Optional"></textarea>
    </label>
    <div class="row" style="margin-top: 8px;">
      <label><input id="enableTools" type="checkbox" checked /> Tools</label>
      <label><input id="enableSpawn" type="checkbox" checked /> Spawn</label>
      <label><input id="enableTeams" type="checkbox" /> Teams</label>
      <label><input id="autoApproveTools" type="checkbox" checked /> Auto-approve tools</label>
    </div>
  </section>

  <section id="messages"></section>

  <section class="composer">
    <label>Message
      <textarea id="prompt" placeholder="Ask Cline anything..."></textarea>
    </label>
    <div class="row spread" style="margin-top: 8px;">
      <div class="row">
        <button id="send">Send</button>
        <button id="abort" class="danger secondary">Abort</button>
        <button id="reset" class="secondary">New Session</button>
      </div>
      <span id="statusText">Waiting for RPC initialization...</span>
    </div>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      providers: [],
      modelsByProvider: new Map(),
      activeAssistant: null,
      sending: false,
    };

    const els = {
      provider: document.getElementById("provider"),
      model: document.getElementById("model"),
      workspaceRoot: document.getElementById("workspaceRoot"),
      maxIterations: document.getElementById("maxIterations"),
      systemPrompt: document.getElementById("systemPrompt"),
      enableTools: document.getElementById("enableTools"),
      enableSpawn: document.getElementById("enableSpawn"),
      enableTeams: document.getElementById("enableTeams"),
      autoApproveTools: document.getElementById("autoApproveTools"),
      messages: document.getElementById("messages"),
      prompt: document.getElementById("prompt"),
      send: document.getElementById("send"),
      abort: document.getElementById("abort"),
      reset: document.getElementById("reset"),
      statusText: document.getElementById("statusText"),
    };

    function appendMessage(kind, text) {
      const node = document.createElement("div");
      node.className = \`msg \${kind}\`;
      node.textContent = text;
      els.messages.appendChild(node);
      els.messages.scrollTop = els.messages.scrollHeight;
      return node;
    }

    function setStatus(text) {
      els.statusText.textContent = text;
    }

    function setSending(sending) {
      state.sending = sending;
      els.send.disabled = sending;
      els.prompt.disabled = sending;
      if (!sending) {
        state.activeAssistant = null;
      }
    }

    function currentConfig() {
      const provider = els.provider.value || undefined;
      const model = els.model.value || undefined;
      const rawMaxIterations = Number.parseInt(els.maxIterations.value, 10);
      const maxIterations = Number.isInteger(rawMaxIterations) && rawMaxIterations > 0
        ? rawMaxIterations
        : undefined;
      return {
        provider,
        model,
        systemPrompt: els.systemPrompt.value || undefined,
        maxIterations,
        enableTools: !!els.enableTools.checked,
        enableSpawn: !!els.enableSpawn.checked,
        enableTeams: !!els.enableTeams.checked,
        autoApproveTools: !!els.autoApproveTools.checked,
      };
    }

    function refreshProviderOptions() {
      const prev = els.provider.value;
      els.provider.textContent = "";
      for (const item of state.providers) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = \`\${item.name} (\${item.id})\`;
        els.provider.appendChild(option);
      }
      if (state.providers.length === 0) {
        const fallback = document.createElement("option");
        fallback.value = "";
        fallback.textContent = "No providers available";
        els.provider.appendChild(fallback);
      }
      const target = state.providers.find((item) => item.id === prev)?.id || state.providers[0]?.id || "";
      els.provider.value = target;
      if (target) {
        vscode.postMessage({ type: "loadModels", providerId: target });
      }
    }

    function refreshModelOptions(providerId) {
      const models = state.modelsByProvider.get(providerId) || [];
      const prev = els.model.value;
      els.model.textContent = "";
      for (const item of models) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name || item.id;
        els.model.appendChild(option);
      }
      if (models.length === 0) {
        const fallback = document.createElement("option");
        fallback.value = "";
        fallback.textContent = "No models available";
        els.model.appendChild(fallback);
      }
      const defaultModel = state.providers.find((item) => item.id === providerId)?.defaultModelId;
      els.model.value = models.find((item) => item.id === prev)?.id || models.find((item) => item.id === defaultModel)?.id || models[0]?.id || "";
    }

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "status") {
        setStatus(message.text);
        return;
      }
      if (message.type === "error") {
        setStatus(\`Error: \${message.text}\`);
        appendMessage("meta", \`Error: \${message.text}\`);
        setSending(false);
        return;
      }
      if (message.type === "defaults") {
        els.workspaceRoot.value = message.defaults.workspaceRoot || "";
        return;
      }
      if (message.type === "providers") {
        state.providers = message.providers || [];
        refreshProviderOptions();
        return;
      }
      if (message.type === "models") {
        state.modelsByProvider.set(message.providerId, message.models || []);
        if (els.provider.value === message.providerId) {
          refreshModelOptions(message.providerId);
        }
        return;
      }
      if (message.type === "session_started") {
        appendMessage("meta", \`Session: \${message.sessionId}\`);
        return;
      }
      if (message.type === "assistant_delta") {
        if (!state.activeAssistant) {
          state.activeAssistant = appendMessage("assistant", "");
        }
        state.activeAssistant.textContent += message.text;
        els.messages.scrollTop = els.messages.scrollHeight;
        return;
      }
      if (message.type === "tool_event") {
        appendMessage("meta", message.text);
        return;
      }
      if (message.type === "turn_done") {
        appendMessage(
          "meta",
          \`Done (\${message.finishReason}) • iterations=\${message.iterations} • input=\${message.usage?.inputTokens ?? 0} output=\${message.usage?.outputTokens ?? 0}\`,
        );
        setStatus(\`Done (\${message.finishReason})\`);
        setSending(false);
        return;
      }
      if (message.type === "reset_done") {
        appendMessage("meta", "Started a new chat session.");
        state.activeAssistant = null;
        setSending(false);
      }
    });

    els.provider.addEventListener("change", () => {
      const providerId = els.provider.value;
      if (providerId) {
        vscode.postMessage({ type: "loadModels", providerId });
      }
    });

    els.send.addEventListener("click", () => {
      const prompt = els.prompt.value.trim();
      if (!prompt) {
        return;
      }
      appendMessage("user", prompt);
      els.prompt.value = "";
      setSending(true);
      setStatus("Running...");
      vscode.postMessage({
        type: "send",
        prompt,
        config: currentConfig(),
      });
    });

    els.abort.addEventListener("click", () => {
      vscode.postMessage({ type: "abort" });
      setStatus("Abort requested...");
    });

    els.reset.addEventListener("click", () => {
      vscode.postMessage({ type: "reset" });
      appendMessage("meta", "Resetting session...");
    });

    els.prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.send.click();
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function createNonce(): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let index = 0; index < 32; index += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}
