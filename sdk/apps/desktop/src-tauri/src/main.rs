#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamChunkEvent {
    session_id: String,
    stream: String,
    chunk: String,
    ts: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEndedEvent {
    session_id: String,
    reason: String,
    ts: u64,
}

#[derive(Debug)]
struct SessionProcess {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct SessionStore {
    counter: AtomicU64,
    sessions: Mutex<HashMap<String, SessionProcess>>,
}

#[derive(Clone)]
struct AppContext {
    launch_cwd: String,
    workspace_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartSessionRequest {
    workspace_root: String,
    cwd: Option<String>,
    provider: String,
    model: String,
    api_key: String,
    prompt: Option<String>,
    system_prompt: Option<String>,
    max_iterations: Option<u32>,
    enable_tools: bool,
    enable_spawn: bool,
    enable_teams: bool,
    auto_approve_tools: Option<bool>,
    team_name: String,
    mission_step_interval: u32,
    mission_time_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatHistoryMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRunTurnRequest {
    config: StartSessionRequest,
    history: Vec<ChatHistoryMessage>,
    prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatTurnResult {
    text: String,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    iterations: Option<u64>,
    finish_reason: Option<String>,
    tool_calls: Vec<ChatToolCallResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatToolCallResult {
    name: String,
    input: Option<Value>,
    output: Option<Value>,
    error: Option<String>,
    duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSessionCommandRequest {
    action: String,
    session_id: Option<String>,
    prompt: Option<String>,
    config: Option<StartSessionRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSessionCommandResponse {
    session_id: Option<String>,
    result: Option<ChatTurnResult>,
    ok: Option<bool>,
}

#[derive(Debug, Clone)]
struct ChatRuntimeSession {
    config: StartSessionRequest,
    history: Vec<ChatHistoryMessage>,
    busy: bool,
}

#[derive(Default)]
struct ChatSessionStore {
    counter: AtomicU64,
    sessions: Mutex<HashMap<String, ChatRuntimeSession>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamHistoryItem {
    ts: String,
    #[serde(rename = "type")]
    item_type: String,
    task: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessContext {
    workspace_root: String,
    cwd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionHookEvent {
    ts: String,
    hook_event_name: String,
    agent_id: Option<String>,
    conversation_id: Option<String>,
    parent_agent_id: Option<String>,
    iteration: Option<u64>,
    tool_name: Option<String>,
    tool_input: Option<Value>,
    tool_output: Option<Value>,
    tool_error: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolApprovalRequestItem {
    request_id: String,
    session_id: String,
    created_at: String,
    tool_call_id: String,
    tool_name: String,
    input: Option<Value>,
    iteration: Option<u64>,
    agent_id: Option<String>,
    conversation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliDiscoveredSession {
    session_id: String,
    status: String,
    provider: String,
    model: String,
    cwd: String,
    workspace_root: String,
    team_name: Option<String>,
    parent_session_id: Option<String>,
    parent_agent_id: Option<String>,
    agent_id: Option<String>,
    conversation_id: Option<String>,
    is_subagent: bool,
    prompt: Option<String>,
    started_at: String,
    ended_at: Option<String>,
    interactive: bool,
}

fn resolve_api_key(provider: &str, explicit_api_key: &str) -> Option<String> {
    if !explicit_api_key.trim().is_empty() {
        return Some(explicit_api_key.to_string());
    }

    match provider {
        "anthropic" => std::env::var("ANTHROPIC_API_KEY").ok(),
        "cline" => std::env::var("CLINE_API_KEY").ok(),
        "openrouter" => std::env::var("OPENROUTER_API_KEY").ok(),
        "openai" => std::env::var("OPENAI_API_KEY").ok(),
        _ => std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .or_else(|| std::env::var("OPENAI_API_KEY").ok()),
    }
}

fn resolve_workspace_root(launch_cwd: &str) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(launch_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output();

    match output {
        Ok(result) if result.status.success() => {
            let value = String::from_utf8_lossy(&result.stdout).trim().to_string();
            if value.is_empty() {
                launch_cwd.to_string()
            } else {
                value
            }
        }
        _ => launch_cwd.to_string(),
    }
}

fn send_abort_signal(child: &mut Child) -> Result<(), String> {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        let rc = unsafe { libc::kill(pid, libc::SIGINT) };
        if rc == 0 {
            return Ok(());
        }
        return Err(format!(
            "failed to send SIGINT: {}",
            std::io::Error::last_os_error()
        ));
    }

    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|e| format!("failed to abort process: {e}"))?;
        Ok(())
    }
}

fn send_terminate_signal(child: &mut Child) -> Result<(), String> {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        let rc = unsafe { libc::kill(pid, libc::SIGTERM) };
        if rc == 0 {
            return Ok(());
        }
        return Err(format!(
            "failed to send SIGTERM: {}",
            std::io::Error::last_os_error()
        ));
    }

    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|e| format!("failed to terminate process: {e}"))?;
        Ok(())
    }
}

fn wait_for_exit(child: &mut Child, attempts: usize, sleep_ms: u64) -> Result<bool, String> {
    for _ in 0..attempts {
        if child
            .try_wait()
            .map_err(|e| format!("failed checking session status: {e}"))?
            .is_some()
        {
            return Ok(true);
        }
        thread::sleep(std::time::Duration::from_millis(sleep_ms));
    }
    Ok(false)
}

fn now_ms() -> u64 {
    let now = std::time::SystemTime::now();
    now.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn kanban_data_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_KANBAN_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".cline").join("apps").join("kanban"))
}

fn session_log_path(session_id: &str) -> Option<PathBuf> {
    let base = kanban_data_root()?;
    Some(base.join("sessions").join(format!("{session_id}.jsonl")))
}

fn session_hook_log_path(session_id: &str) -> Option<PathBuf> {
    let base = kanban_data_root()?;
    Some(base.join("hooks").join(format!("{session_id}.jsonl")))
}

fn shared_session_data_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_SESSION_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("data")
            .join("sessions"),
    )
}

fn shared_session_log_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "log")
}

fn shared_session_hook_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "hooks.jsonl")
}

fn shared_session_messages_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "messages.json")
}

fn stringify_message_content(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }

    if let Some(array) = value.as_array() {
        let mut parts: Vec<String> = Vec::new();
        for block in array {
            if let Some(obj) = block.as_object() {
                let block_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                let piece = match block_type {
                    "text" => obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    "thinking" => obj
                        .get("thinking")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    "tool_use" => {
                        let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("tool_call");
                        format!("[tool] {name}")
                    }
                    "tool_result" => {
                        let result = obj.get("content").unwrap_or(&Value::Null);
                        let inner = stringify_message_content(result);
                        if inner.is_empty() {
                            "[tool_result]".to_string()
                        } else {
                            format!("[tool_result]\n{inner}")
                        }
                    }
                    "image" => "[image]".to_string(),
                    "redacted_thinking" => "[redacted_thinking]".to_string(),
                    _ => obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                };
                if !piece.trim().is_empty() {
                    parts.push(piece);
                }
                continue;
            }

            if let Some(text) = block.as_str() {
                if !text.trim().is_empty() {
                    parts.push(text.to_string());
                }
            }
        }
        return parts.join("\n");
    }

    if let Some(obj) = value.as_object() {
        if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
            return text.to_string();
        }
    }

    String::new()
}

fn read_persisted_chat_history(session_id: &str) -> Result<Option<Vec<ChatHistoryMessage>>, String> {
    let Some(path) = shared_session_messages_path(session_id) else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading session messages: {e}"))?;
    let parsed =
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("failed parsing session messages: {e}"))?;

    let messages = parsed
        .get("messages")
        .and_then(|v| v.as_array())
        .or_else(|| parsed.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out: Vec<ChatHistoryMessage> = Vec::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if role != "user" && role != "assistant" {
            continue;
        }
        let content = stringify_message_content(message.get("content").unwrap_or(&Value::Null));
        if content.trim().is_empty() {
            continue;
        }
        out.push(ChatHistoryMessage {
            role: role.to_string(),
            content,
        });
    }

    Ok(Some(out))
}

fn tool_approval_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_TOOL_APPROVAL_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    shared_session_data_dir().map(|base| base.join("tool-approvals"))
}

fn tool_approval_request_prefix(session_id: &str) -> String {
    format!("{session_id}.request.")
}

fn tool_approval_decision_path(session_id: &str, request_id: &str) -> Option<PathBuf> {
    let dir = tool_approval_dir()?;
    Some(dir.join(format!("{session_id}.decision.{request_id}.json")))
}

fn root_session_id_from(session_id: &str) -> &str {
    session_id
        .split_once("__")
        .map(|(root, _)| root)
        .unwrap_or(session_id)
}

fn find_artifact_under_dir(dir: &Path, file_name: &str, max_depth: usize) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(dir.to_path_buf(), 0)];
    while let Some((current, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry_result in entries {
            let Ok(entry) = entry_result else {
                continue;
            };
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_file() {
                if entry.file_name().to_string_lossy() == file_name {
                    return Some(path);
                }
                continue;
            }
            if file_type.is_dir() && depth < max_depth {
                stack.push((path, depth + 1));
            }
        }
    }
    None
}

fn shared_session_artifact_path(session_id: &str, suffix: &str) -> Option<PathBuf> {
    let base = shared_session_data_dir()?;
    let file_name = format!("{session_id}.{suffix}");

    let legacy = base.join(session_id).join(&file_name);
    if legacy.exists() {
        return Some(legacy);
    }

    let root_dir = base.join(root_session_id_from(session_id));
    if let Some(found) = find_artifact_under_dir(&root_dir, &file_name, 4) {
        return Some(found);
    }

    None
}

fn resolve_cli_entrypoint_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("packages")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.workspace_root)
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("packages")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("cli")
            .join("src")
            .join("index.ts"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn resolve_cli_workdir(cli_entrypoint: &Path, context: &AppContext) -> PathBuf {
    cli_entrypoint
        .parent()
        .and_then(|p: &Path| p.parent())
        .map(|p: &Path| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd))
}

fn resolve_chat_turn_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("packages")
            .join("desktop")
            .join("scripts")
            .join("chat-agent-turn.ts"),
        PathBuf::from(&context.workspace_root)
            .join("desktop")
            .join("scripts")
            .join("chat-agent-turn.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("desktop")
            .join("scripts")
            .join("chat-agent-turn.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("scripts")
            .join("chat-agent-turn.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn run_chat_turn_script(
    context: &AppContext,
    request: &ChatRunTurnRequest,
) -> Result<ChatTurnResult, String> {
    let Some(script_path) = resolve_chat_turn_script_path(context) else {
        return Err(format!(
            "chat runner script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };

    let stdin_body =
        serde_json::to_string(request).map_err(|e| format!("failed serializing chat turn request: {e}"))?;

    let mut child = Command::new("bun")
        .arg("run")
        .arg(script_path.to_string_lossy().to_string())
        .current_dir(&request.config.workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start chat runner script: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(stdin_body.as_bytes())
            .map_err(|e| format!("failed writing chat runner stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed waiting for chat runner: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("chat runner exited with {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("chat runner returned empty output".to_string());
    }
    serde_json::from_str::<ChatTurnResult>(&stdout).map_err(|e| format!("invalid chat runner output: {e}"))
}

fn append_session_chunk(session_id: &str, stream: &str, chunk: &str, ts: u64) {
    let Some(path) = session_log_path(session_id) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let line = serde_json::json!({
        "ts": ts,
        "stream": stream,
        "chunk": chunk,
    })
    .to_string();
    let mut file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        Ok(file) => file,
        Err(_) => return,
    };
    let _ = writeln!(file, "{line}");
}

fn emit_chunk(app: &AppHandle, session_id: &str, stream: &str, chunk: String) {
    let ts = now_ms();
    append_session_chunk(session_id, stream, &chunk, ts);

    let payload = StreamChunkEvent {
        session_id: session_id.to_string(),
        stream: stream.to_string(),
        chunk,
        ts,
    };
    let _ = app.emit("agent://chunk", payload);
}

fn emit_session_ended(app: &AppHandle, session_id: &str, reason: String) {
    let payload = SessionEndedEvent {
        session_id: session_id.to_string(),
        reason,
        ts: now_ms(),
    };
    let _ = app.emit("agent://session-ended", payload);
}

fn sanitize_team_name(name: &str) -> String {
    let lowered = name.to_ascii_lowercase();
    let mut out = String::with_capacity(lowered.len());
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

fn team_base_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_TEAM_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".cline").join("data").join("teams"))
}

fn team_state_path(team_name: &str) -> Option<PathBuf> {
    let base = team_base_dir()?;
    let safe = sanitize_team_name(team_name);
    if safe.is_empty() {
        return None;
    }
    Some(base.join(safe).join("state.json"))
}

fn team_history_path(team_name: &str) -> Option<PathBuf> {
    let base = team_base_dir()?;
    let safe = sanitize_team_name(team_name);
    if safe.is_empty() {
        return None;
    }
    Some(base.join(safe).join("task-history.jsonl"))
}

fn spawn_reader<R: Read + Send + 'static>(
    app: AppHandle,
    session_id: String,
    stream: &'static str,
    mut reader: R,
) {
    thread::spawn(move || {
        let mut buf = [0_u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    emit_chunk(&app, &session_id, stream, chunk);
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
fn start_session(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    context: State<'_, AppContext>,
    request: StartSessionRequest,
) -> Result<String, String> {
    let effective_api_key = resolve_api_key(&request.provider, &request.api_key).ok_or_else(|| {
        format!(
            "Missing API key for provider '{}'. Provide one in the UI or set the required env var before launching Tauri.",
            request.provider
        )
    })?;

    let id = format!("sess_{}", state.counter.fetch_add(1, Ordering::Relaxed) + 1);

    let Some(cli_entrypoint) = resolve_cli_entrypoint_path(&context) else {
        return Err(format!(
            "CLI entrypoint not found. Checked relative to workspace_root={} and launch_cwd={}.",
            context.workspace_root, context.launch_cwd
        ));
    };

    let prompt = request.prompt.clone().unwrap_or_default();
    let interactive = prompt.trim().is_empty();

    let mut args: Vec<String> = vec![
        "run".into(),
        cli_entrypoint.to_string_lossy().to_string(),
        "-p".into(),
        request.provider.clone(),
        "-m".into(),
        request.model.clone(),
        "--mission-step-interval".into(),
        request.mission_step_interval.to_string(),
        "--mission-time-interval-ms".into(),
        request.mission_time_interval_ms.to_string(),
    ];

    if interactive {
        args.push("-i".into());
    }

    let auto_approve_tools = request.auto_approve_tools.unwrap_or(true);
    if request.enable_tools {
        args.push("--tools".into());
        if !auto_approve_tools {
            args.push("--require-tool-approval".into());
        }
    }
    if request.enable_spawn {
        args.push("--spawn".into());
    }
    if request.enable_teams {
        args.push("--teams".into());
        args.push("--team-name".into());
        args.push(request.team_name.clone());
    }
    if let Some(cwd) = &request.cwd {
        if !cwd.trim().is_empty() {
            args.push("--cwd".into());
            args.push(cwd.clone());
        }
    }
    if let Some(system_prompt) = &request.system_prompt {
        if !system_prompt.trim().is_empty() {
            args.push("-s".into());
            args.push(system_prompt.clone());
        }
    }
    if !request.enable_teams {
        if let Some(max_iterations) = request.max_iterations {
            args.push("-n".into());
            args.push(max_iterations.to_string());
        }
    }
    if !interactive {
        args.push(prompt);
    }

    let hook_log_path = session_hook_log_path(&id).unwrap_or_else(|| PathBuf::from("."));
    if let Some(parent) = hook_log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let approval_dir =
        tool_approval_dir().unwrap_or_else(|| PathBuf::from(".").join(".cline").join("tool-approvals"));
    let _ = fs::create_dir_all(&approval_dir);

    let mut command = Command::new("bun");
    command
        .current_dir(&request.workspace_root)
        .args(args)
        .stdin(if interactive { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .env("CLINE_ENABLE_SUBPROCESS_HOOKS", "1")
        .env("CLINE_SESSION_ID", id.clone())
        .env("CLINE_TOOL_APPROVAL_MODE", "desktop")
        .env("CLINE_TOOL_APPROVAL_SESSION_ID", id.clone())
        .env("CLINE_TOOL_APPROVAL_DIR", approval_dir.to_string_lossy().to_string())
        .env("CLINE_HOOKS_LOG_PATH", hook_log_path.to_string_lossy().to_string())
        .env(
            "CLINE_SESSION_DATA_DIR",
            shared_session_data_dir()
                .unwrap_or_else(|| PathBuf::from(".").join(".cline").join("data").join("sessions"))
                .to_string_lossy()
                .to_string(),
        )
        .env(
            "CLINE_TEAM_DATA_DIR",
            std::env::var("CLINE_TEAM_DATA_DIR").unwrap_or_else(|_| {
                team_base_dir()
                    .unwrap_or_else(|| PathBuf::from(".").join(".cline").join("data").join("teams"))
                    .to_string_lossy()
                    .to_string()
            }),
        )
        .env("ANTHROPIC_API_KEY", &effective_api_key)
        .env("OPENAI_API_KEY", &effective_api_key);

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start session process: {e}"))?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture stderr")?;

    spawn_reader(app.clone(), id.clone(), "stdout", stdout);
    spawn_reader(app, id.clone(), "stderr", stderr);

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;
    sessions.insert(id.clone(), SessionProcess { child, stdin });

    Ok(id)
}

#[tauri::command]
fn send_prompt(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    let mut should_remove = false;
    let mut ended_reason: Option<String> = None;
    {
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("session not found: {session_id}"))?;

        if let Some(status) = session
            .child
            .try_wait()
            .map_err(|e| format!("failed checking session status: {e}"))?
        {
            should_remove = true;
            ended_reason = Some(format!("session process exited ({status})"));
        } else {
            let Some(stdin) = session.stdin.as_mut() else {
                return Err("session is not interactive".to_string());
            };
            let write_result = stdin.write_all(format!("{prompt}\n").as_bytes());
            let flush_result = stdin.flush();

            if let Err(e) = write_result.or(flush_result) {
                should_remove = true;
                ended_reason = Some(format!("failed writing prompt: {e}"));
            }
        }
    }

    if should_remove {
        sessions.remove(&session_id);
        let reason = ended_reason.unwrap_or_else(|| "session ended".to_string());
        emit_session_ended(&app, &session_id, reason.clone());
        return Err(format!(
            "{reason}. The agent session is no longer running. Start a new session."
        ));
    }

    Ok(())
}

#[tauri::command]
fn stop_session(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    if let Some(mut session) = sessions.remove(&session_id) {
        if let Some(stdin) = session.stdin.as_mut() {
            let _ = stdin.write_all(&[3]);
            let _ = stdin.flush();
        }
        let _ = session.child.kill();
        let _ = session.child.wait();
        emit_session_ended(&app, &session_id, "session stopped".to_string());
    }

    Ok(())
}

#[tauri::command]
fn abort_session(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;

    if let Some(stdin) = session.stdin.as_mut() {
        let _ = stdin.write_all(&[3]);
        let _ = stdin.flush();
    }

    let _ = send_abort_signal(&mut session.child);
    let exited_after_int = wait_for_exit(&mut session.child, 8, 75)?;
    if !exited_after_int {
        let _ = send_terminate_signal(&mut session.child);
    }
    let exited_after_term = if exited_after_int {
        true
    } else {
        wait_for_exit(&mut session.child, 8, 75)?
    };
    if !exited_after_term {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }

    emit_session_ended(&app, &session_id, "session cancelled".to_string());
    Ok(())
}

#[tauri::command]
fn poll_sessions(app: AppHandle, state: State<'_, Arc<SessionStore>>) -> Result<Vec<String>, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    let ids: Vec<String> = sessions.keys().cloned().collect();
    let mut ended: Vec<(String, String)> = Vec::new();

    for session_id in ids {
        if let Some(session) = sessions.get_mut(&session_id) {
            if let Some(status) = session
                .child
                .try_wait()
                .map_err(|e| format!("failed checking session status: {e}"))?
            {
                let reason = if status.success() {
                    "session completed".to_string()
                } else {
                    format!("session exited ({status})")
                };
                ended.push((session_id.clone(), reason));
            }
        }
    }

    for (session_id, reason) in &ended {
        sessions.remove(session_id);
        emit_session_ended(&app, session_id, reason.clone());
    }

    Ok(ended.into_iter().map(|(session_id, _)| session_id).collect())
}

#[tauri::command]
fn list_cli_sessions(context: State<'_, AppContext>, limit: Option<usize>) -> Result<Vec<CliDiscoveredSession>, String> {
    let Some(cli_entrypoint) = resolve_cli_entrypoint_path(&context) else {
        return Ok(vec![]);
    };
    let cli_workdir = resolve_cli_workdir(&cli_entrypoint, &context);

    let limit_value = limit.unwrap_or(300).max(1).to_string();
    let output = Command::new("bun")
        .current_dir(cli_workdir)
        .arg("run")
        .arg(cli_entrypoint)
        .arg("sessions")
        .arg("list")
        .arg("--limit")
        .arg(limit_value)
        .output()
        .map_err(|e| format!("failed to list cli sessions: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("failed to list cli sessions: {stderr}"));
    }

    let parsed =
        serde_json::from_slice::<Value>(&output.stdout).map_err(|e| format!("invalid sessions json: {e}"))?;
    let mut out: Vec<CliDiscoveredSession> = Vec::new();
    let Some(items) = parsed.as_array() else {
        return Ok(out);
    };

    for item in items {
        let session_id = item
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if session_id.is_empty() {
            continue;
        }
        out.push(CliDiscoveredSession {
            session_id,
            status: item
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("running")
                .to_string(),
            provider: item
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("anthropic")
                .to_string(),
            model: item
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            cwd: item
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            workspace_root: item
                .get("workspace_root")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("cwd").and_then(|v| v.as_str()))
                .unwrap_or_default()
                .to_string(),
            team_name: item
                .get("team_name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            parent_session_id: item
                .get("parent_session_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            parent_agent_id: item
                .get("parent_agent_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            agent_id: item
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            conversation_id: item
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            is_subagent: item
                .get("is_subagent")
                .and_then(|v| v.as_i64())
                .map(|v| v != 0)
                .or_else(|| item.get("is_subagent").and_then(|v| v.as_bool()))
                .unwrap_or(false),
            prompt: item
                .get("prompt")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            started_at: item
                .get("started_at")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            ended_at: item
                .get("ended_at")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            interactive: item
                .get("interactive")
                .and_then(|v| v.as_i64())
                .map(|v| v != 0)
                .or_else(|| item.get("interactive").and_then(|v| v.as_bool()))
                .unwrap_or(false),
        });
    }

    Ok(out)
}

#[tauri::command]
fn delete_cli_session(context: State<'_, AppContext>, session_id: String) -> Result<(), String> {
    let Some(cli_entrypoint) = resolve_cli_entrypoint_path(&context) else {
        return Err("CLI entrypoint not found".to_string());
    };
    let cli_workdir = resolve_cli_workdir(&cli_entrypoint, &context);

    let output = Command::new("bun")
        .current_dir(cli_workdir)
        .arg("run")
        .arg(cli_entrypoint)
        .arg("sessions")
        .arg("delete")
        .arg("--session-id")
        .arg(&session_id)
        .output()
        .map_err(|e| format!("failed to delete cli session: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("failed to delete cli session: {stderr}"));
    }

    if let Some(path) = session_log_path(&session_id) {
        let _ = fs::remove_file(path);
    }
    if let Some(path) = session_hook_log_path(&session_id) {
        let _ = fs::remove_file(path);
    }

    Ok(())
}

#[tauri::command]
fn read_session_hooks(session_id: String, limit: Option<usize>) -> Result<Vec<SessionHookEvent>, String> {
    let path = match session_hook_log_path(&session_id) {
        Some(path) if path.exists() => path,
        _ => match shared_session_hook_path(&session_id) {
            Some(path) if path.exists() => path,
            _ => return Ok(vec![]),
        },
    };
    if !path.exists() {
        return Ok(vec![]);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading hook log: {e}"))?;
    let mut out: Vec<SessionHookEvent> = Vec::new();

    let parse_tokens = |value: &Value, key: &str| -> Option<u64> {
        value.get(key).and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_f64().map(|n| n.max(0.0) as u64))
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
    };

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let hook_event_name = value
            .get("hook_event_name")
            .or_else(|| value.get("event"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if hook_event_name.is_empty() {
            continue;
        }

        let ts = value
            .get("ts")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let tool_name = value
            .get("tool_call")
            .and_then(|v| v.get("name"))
            .or_else(|| value.get("tool_result").and_then(|v| v.get("name")))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());
        let tool_input = value
            .get("tool_call")
            .and_then(|v| v.get("input"))
            .cloned()
            .or_else(|| value.get("tool_result").and_then(|v| v.get("input")).cloned());
        let tool_output = value
            .get("tool_result")
            .and_then(|v| v.get("output"))
            .cloned();
        let tool_error = value
            .get("tool_result")
            .and_then(|v| v.get("error"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());

        let usage = value
            .get("turn")
            .and_then(|v| v.get("usage"))
            .or_else(|| value.get("usage"))
            .or_else(|| value.get("turn_usage"));
        let input_tokens = usage.and_then(|u| {
            parse_tokens(u, "inputTokens")
                .or_else(|| parse_tokens(u, "input_tokens"))
                .or_else(|| parse_tokens(u, "prompt_tokens"))
        });
        let output_tokens = usage.and_then(|u| {
            parse_tokens(u, "outputTokens")
                .or_else(|| parse_tokens(u, "output_tokens"))
                .or_else(|| parse_tokens(u, "completion_tokens"))
        });

        out.push(SessionHookEvent {
            ts,
            hook_event_name,
            agent_id: value
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            conversation_id: value
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            parent_agent_id: value
                .get("parent_agent_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            iteration: value.get("iteration").and_then(|v| v.as_u64()),
            tool_name,
            tool_input,
            tool_output,
            tool_error,
            input_tokens,
            output_tokens,
        });
    }

    let max = limit.unwrap_or(300);
    if out.len() > max {
        out = out.split_off(out.len() - max);
    }

    Ok(out)
}

#[tauri::command]
fn read_team_state(team_name: String) -> Result<Option<Value>, String> {
    let Some(path) = team_state_path(&team_name) else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading team state: {e}"))?;
    let parsed =
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("invalid team state JSON: {e}"))?;
    Ok(Some(parsed))
}

#[tauri::command]
fn read_team_history(
    team_name: String,
    limit: Option<usize>,
) -> Result<Vec<TeamHistoryItem>, String> {
    let Some(path) = team_history_path(&team_name) else {
        return Ok(vec![]);
    };
    if !path.exists() {
        return Ok(vec![]);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading team history: {e}"))?;
    let mut out: Vec<TeamHistoryItem> = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            let ts = value
                .get("ts")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let item_type = value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let task = value.get("task").cloned().unwrap_or(Value::Null);
            out.push(TeamHistoryItem {
                ts,
                item_type,
                task,
            });
        }
    }

    let max = limit.unwrap_or(200);
    if out.len() > max {
        out = out.split_off(out.len() - max);
    }

    Ok(out)
}

#[tauri::command]
fn list_existing_teams() -> Result<Vec<String>, String> {
    let Some(base) = team_base_dir() else {
        return Ok(vec![]);
    };
    if !base.exists() {
        return Ok(vec![]);
    }

    let mut out: Vec<String> = Vec::new();
    let entries = fs::read_dir(base).map_err(|e| format!("failed reading team directory: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let state_path = path.join("state.json");
        let history_path = path.join("task-history.jsonl");
        if !state_path.exists() && !history_path.exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().trim().to_string();
        if !name.is_empty() {
            out.push(name);
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

#[tauri::command]
fn get_process_context(context: State<'_, AppContext>) -> ProcessContext {
    ProcessContext {
        workspace_root: context.workspace_root.clone(),
        cwd: context.launch_cwd.clone(),
    }
}

#[tauri::command]
fn chat_session_command(
    state: State<'_, Arc<ChatSessionStore>>,
    context: State<'_, AppContext>,
    request: ChatSessionCommandRequest,
) -> Result<ChatSessionCommandResponse, String> {
    match request.action.as_str() {
        "start" => {
            let Some(config) = request.config else {
                return Err("missing config for start action".to_string());
            };
            let session_id = format!(
                "sess_{}",
                state.counter.fetch_add(1, Ordering::Relaxed) + 1
            );
            let mut sessions = state
                .sessions
                .lock()
                .map_err(|_| "failed to lock chat session store")?;
            sessions.insert(
                session_id.clone(),
                ChatRuntimeSession {
                    config,
                    history: Vec::new(),
                    busy: false,
                },
            );
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: None,
                ok: None,
            })
        }
        "send" => {
            let prompt = request
                .prompt
                .unwrap_or_default()
                .trim()
                .to_string();
            if prompt.is_empty() {
                return Err("prompt is required for send action".to_string());
            }
            let Some(session_id) = request.session_id else {
                return Err("sessionId is required for send action".to_string());
            };

            let has_live_session = {
                let sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions.contains_key(&session_id)
            };
            if !has_live_session {
                let config = request
                    .config
                    .clone()
                    .ok_or_else(|| "session not found. start a new session.".to_string())?;
                let history = read_persisted_chat_history(&session_id)?
                    .ok_or_else(|| "session not found. start a new session.".to_string())?;
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions.entry(session_id.clone()).or_insert(ChatRuntimeSession {
                    config,
                    history,
                    busy: false,
                });
            }

            let (config, history) = {
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                let session = sessions
                    .get_mut(&session_id)
                    .ok_or_else(|| "session not found. start a new session.".to_string())?;
                if session.busy {
                    return Err("session is busy. wait for current response to finish.".to_string());
                }
                session.busy = true;
                (session.config.clone(), session.history.clone())
            };

            let turn_result = run_chat_turn_script(
                &context,
                &ChatRunTurnRequest {
                    config: config.clone(),
                    history,
                    prompt: prompt.clone(),
                },
            );

            let mut sessions = state
                .sessions
                .lock()
                .map_err(|_| "failed to lock chat session store")?;
            if let Some(session) = sessions.get_mut(&session_id) {
                session.busy = false;
                if let Ok(result) = &turn_result {
                    session.history.push(ChatHistoryMessage {
                        role: "user".to_string(),
                        content: prompt,
                    });
                    session.history.push(ChatHistoryMessage {
                        role: "assistant".to_string(),
                        content: result.text.clone(),
                    });
                }
            }

            let result = turn_result?;
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: Some(result),
                ok: None,
            })
        }
        "abort" => Ok(ChatSessionCommandResponse {
            session_id: request.session_id,
            result: None,
            ok: Some(true),
        }),
        "reset" => {
            if let Some(session_id) = request.session_id.clone() {
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions.remove(&session_id);
            }
            Ok(ChatSessionCommandResponse {
                session_id: request.session_id,
                result: None,
                ok: Some(true),
            })
        }
        _ => Err("unsupported action".to_string()),
    }
}

#[tauri::command]
fn read_session_transcript(session_id: String, max_chars: Option<usize>) -> Result<String, String> {
    let (path, is_jsonl) = match session_log_path(&session_id) {
        Some(path) if path.exists() => (path, true),
        _ => match shared_session_log_path(&session_id) {
            Some(path) if path.exists() => (path, false),
            _ => return Ok(String::new()),
        },
    };
    if !path.exists() {
        return Ok(String::new());
    }
    let raw =
        fs::read_to_string(path).map_err(|e| format!("failed reading session transcript: {e}"))?;
    let mut out = String::new();
    if is_jsonl {
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if let Some(chunk) = value.get("chunk").and_then(|v| v.as_str()) {
                    out.push_str(chunk);
                }
            }
        }
    } else {
        out = raw;
    }
    if let Some(limit) = max_chars {
        if out.chars().count() > limit {
            let start = out.chars().count().saturating_sub(limit);
            out = out.chars().skip(start).collect();
        }
    }
    Ok(out)
}

#[tauri::command]
fn poll_tool_approvals(session_id: String, limit: Option<usize>) -> Result<Vec<ToolApprovalRequestItem>, String> {
    let Some(dir) = tool_approval_dir() else {
        return Ok(vec![]);
    };
    if !dir.exists() {
        return Ok(vec![]);
    }

    let prefix = tool_approval_request_prefix(&session_id);
    let mut items: Vec<ToolApprovalRequestItem> = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("failed reading tool approvals: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        if !name.starts_with(&prefix) || !name.ends_with(".json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<ToolApprovalRequestItem>(&raw) else {
            continue;
        };
        items.push(parsed);
    }

    items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let max = limit.unwrap_or(20);
    if items.len() > max {
        items.truncate(max);
    }
    Ok(items)
}

#[tauri::command]
fn respond_tool_approval(
    session_id: String,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), String> {
    let Some(path) = tool_approval_decision_path(&session_id, &request_id) else {
        return Err("tool approval decision path unavailable".to_string());
    };
    let request_path = tool_approval_dir()
        .map(|dir| dir.join(format!("{session_id}.request.{request_id}.json")));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed preparing approval dir: {e}"))?;
    }
    let body = serde_json::json!({
        "approved": approved,
        "reason": reason,
        "ts": now_ms(),
    });
    fs::write(path, serde_json::to_vec(&body).map_err(|e| format!("failed encoding decision: {e}"))?)
        .map_err(|e| format!("failed writing tool approval decision: {e}"))?;
    if let Some(req_path) = request_path {
        let _ = fs::remove_file(req_path);
    }
    Ok(())
}

fn main() {
    let store = Arc::new(SessionStore::default());
    let chat_store = Arc::new(ChatSessionStore::default());
    let launch_cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    let workspace_root = resolve_workspace_root(&launch_cwd);
    let app_context = AppContext {
        launch_cwd,
        workspace_root,
    };

    tauri::Builder::default()
        .manage(store)
        .manage(chat_store)
        .manage(app_context)
        .invoke_handler(tauri::generate_handler![
            start_session,
            send_prompt,
            abort_session,
            stop_session,
            poll_sessions,
            list_cli_sessions,
            delete_cli_session,
            read_session_hooks,
            read_team_state,
            read_team_history,
            list_existing_teams,
            get_process_context,
            chat_session_command,
            read_session_transcript,
            poll_tool_approvals,
            respond_tool_approval
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
