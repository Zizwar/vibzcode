---
name: vibzcode
description: Autonomous coding and orchestration skill for VibzCode multi-engine workspaces. Use to interact with workspace sandboxes, dispatch tasks, execute terminal commands, browse the web via /browser, plan tasks, select AI models, and manage files via Remote MCP.
---

# VibzCode AI Agent Skill Guide (`vibzcode.skill.md`)

> **Comprehensive instruction manual and operational protocol for AI Agents (Claude Desktop, Cursor, ChatGPT, Antigravity, OpenCode, Codex) connecting to and orchestrating VibzCode workspaces.**

---

## 1. Overview (نظرة عامة على المنصة)

**VibzCode** is a sovereign multi-engine AI workspace and orchestration control plane. It enables developers and autonomous AI agents to collaborate inside isolated sandboxes with support for:
- **Multiple AI Engines:** Google Antigravity (`agy`), Claude Code (`claude`), OpenAI Codex (`codex`), Mistral Vibe (`vibe`), OpenCode (`opencode`), and Vibz Master Agent.
- **Remote Model Context Protocol (MCP):** Full official `@modelcontextprotocol/sdk` implementation over HTTP/SSE.
- **Model & Reasoning Control:** Dynamic model switching (`gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`) with configurable thinking effort (`low`, `medium`, `high`, `max`).
- **Slash Commands:** Native support for expanded subagents including web browsing (`/browser`), strategic planning (`/plan`), deep reasoning (`/boost`), architectural interview (`/grill-me`), and swarm execution (`/teamwork`).
- **Accurate Token Usage Tracking:** Live breakdown of input, output, thinking, and cache tokens.

---

## 2. Security & Token Handling Policy (سياسة الأمان والتوكنز)

> [!CAUTION]
> **CRITICAL SECURITY REQUIREMENT FOR AI AGENTS:**
> - **NEVER** hardcode, embed, or commit secret tokens (`vibz_...` or `admin_...`) in this skill file, code repositories, or public configuration files.
> - If you do not possess an active **Session Token** or **Admin Secret**, **politely prompt the user** to supply their token before initiating requests.
> - Example prompt to user:
>   *"To connect to your VibzCode workspace, please provide your Session Token (`vibz_...`) or Admin Secret (`admin_...`)."*
> - Store provided tokens in your runtime environment variables (e.g. `VIBZ_TOKEN`) or MCP client headers, and never log or reflect them back in plaintext.

---

## 3. Remote MCP Endpoints & Connection (طرق الربط عبر MCP)

VibzCode exposes standard MCP endpoints supporting Streamable HTTP and SSE:

### 3.1. Session-Level MCP (مستوى جلسة مساحة العمل)
Each workspace member or task has a dedicated session sandbox:
- **URL:** `https://<BASE_URL>/mcp?token=<SESSION_TOKEN>`
- **Alternative Header:** `Authorization: Bearer <SESSION_TOKEN>`
- **Scope:** Directly inspect and execute commands inside that specific workspace sandbox (`session.targetDir`).

### 3.2. Orchestrator-Level MCP (مستوى المنسق العام)
For supervisor agents with full control over all sessions:
- **URL:** `https://<BASE_URL>/mcp/orchestrator?token=<ADMIN_SECRET>`
- **Scope:** Create sessions, list sessions, dispatch background jobs, hand off tasks between agents, and manage root system files.

### 3.3. Client Configuration Examples

#### Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "vibzcode-workspace": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<BASE_URL>/mcp?token=<SESSION_TOKEN>"
      ]
    }
  }
}
```

#### Cursor (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "vibzcode": {
      "url": "https://<BASE_URL>/mcp?token=<SESSION_TOKEN>"
    }
  }
}
```

#### ChatGPT Custom Action (OpenAPI 3.1):
- **Import URL:** `https://<BASE_URL>/openapi.json?token=<SESSION_TOKEN>`

---

## 4. Model Selection & Automatic Session Memory (اختيار النماذج والذاكرة التلقائية)

### 4.1. Supported AI Models (النماذج المتاحة)
| Model Identifier | Display Name | Thinking Reasoning | Best For |
|---|---|---|---|
| `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | Medium (Default) | General programming, fast iterations, balanced speed & quality |
| `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | High | Complex refactoring, architecture design, bug investigation |
| `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | Low | Fast scripts, formatting, trivial queries, lowest latency |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | High | Sophisticated algorithmic logic, prose writing, code review |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking) | High | Maximum reasoning depth, deep architectural analysis |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | Medium | Open-weights 120B model benchmark |

### 4.2. Thinking Effort Levels (مستويات التفكير)
- `low`: Minimal reasoning latency, fast response.
- `medium`: Default balanced reasoning depth.
- `high`: Deep exploration of edge cases and logic verification.
- `max`: Maximum reasoning effort for hardest algorithmic tasks.

### 4.3. Automatic Session Persistence (التخزين التلقائي للنموذج)
> [!NOTE]
> When you call `ask_agent` or `agent_dispatch` with a specific `model` or `effort`:
> 1. VibzCode **immediately persists** your selection into the session's metadata.
> 2. In subsequent turns, if you omit `model` or `effort`, the platform **automatically reuses** your previously selected model and effort!
> 3. You only need to specify `model` or `effort` when you wish to switch them.

---

## 5. Slash Commands (`/browser`, `/plan`, etc.)

VibzCode natively expands Antigravity slash commands. To trigger an expanded subagent or special workflow, **the command MUST appear as the very first word in the `prompt`**:

### 5.1. `/browser <query>` (وكيل التصفح المستقل)
- **What it does:** Spawns an autonomous browser subagent that browses the live web, interacts with pages, searches search engines, and captures screenshots.
- **Example:**
  ```text
  /browser Search Google for the latest Tailwind CSS v4 breaking changes and summarize the upgrade steps
  ```

### 5.2. `/plan <task>` (التخطيط الاستراتيجي)
- **What it does:** Prompts the agent to write a complete, structured, step-by-step implementation plan before touching code.
- **Example:**
  ```text
  /plan Migrate authentication from custom JWT cookies to OAuth2 Authorization Code flow
  ```

### 5.3. `/boost <task>` (التفكير المعمق والتحقق المتعدد)
- **What it does:** Triggers high-intensity verification, cross-checks code changes from multiple perspectives, and validates edge cases.

### 5.4. `/grill-me <topic>` (مقابلة تفاعلية للمواءمة)
- **What it does:** Conducts an architectural interview asking the caller pointed questions to resolve design trade-offs before implementation.

### 5.5. `/teamwork <goal>` (فريق وكلاء متوازيين)
- **What it does:** Coordinates a swarm of independent subagents working in parallel on subtasks via a shared board.

---

## 6. MCP Tools Reference (دليل أدوات الـ MCP)

### 6.1. `ask_agent`
Sends a task or coding instruction to the workspace AI agent.
- **Parameters:**
  - `prompt` *(string, required)*: The instruction or code task. Can start with `/browser`, `/plan`, `/boost`, etc.
  - `model` *(string, optional)*: Model identifier (e.g. `gemini-3.8-flash-high`). If omitted, retains current session model.
  - `effort` *(enum: low|medium|high|max, optional)*: Thinking effort level. If omitted, retains current session effort.
  - `continue_conversation` *(boolean, optional, default: true)*: Maintain conversational memory context.
  - `async_mode` *(boolean, optional, default: false)*: When `true`, returns `job_id` immediately and executes in background.
  - `session_id` *(string, optional)*: (Orchestrator only) target session.

### 6.2. `get_available_models`
Returns the active session model, list of available models, effort levels, and supported slash commands in JSON.

### 6.3. `get_session_status`
Returns metadata about the session: name, engine, active model, effort level, working directory, and sandbox restrictions.

### 6.4. `list_workspace_files`
- **Parameters:** `subpath` *(optional)*.
- **Output:** Array of files with sizes, directory indicators, and relative paths.

### 6.5. `read_workspace_file`
- **Parameters:** `relative_path` *(required)*.
- **Output:** Full text content of the requested file within the sandbox.

### 6.6. `write_workspace_file`
- **Parameters:** `relative_path` *(required)*, `content` *(required)*.
- **Output:** Confirmation and byte count written.

### 6.7. `run_shell_command`
- **Parameters:** `command` *(required)*.
- **Output:** Combined stdout and stderr executed inside the workspace directory.

### 6.8. `generate_file_download_link`
Generates a secure temporary download ticket URL for user artifacts or reports.

---

## 7. Token Usage Breakdown (بيانات استهلاك التوكنز)

Every completed turn returns a structured token usage report:
- `total_tokens`: Overall tokens consumed.
- `input_tokens`: Prompt and context tokens sent to the LLM.
- `output_tokens`: Completion tokens generated.
- `thinking_tokens`: Reasoning tokens generated by thinking models.
- `cache_read_tokens`: Tokens retrieved from prompt cache.

---

## 8. Agent Operating Protocol (طريقة عمل الوكيل الذكي خطوة بخطوة)

When assigned a task via VibzCode:

1. **Check Environment & Configuration:**
   - Call `get_session_status` or `get_available_models` to verify working directory, active model, and thinking effort.
2. **Select Appropriate Model & Effort:**
   - For routine file updates: default `gemini-3.8-flash-medium` is recommended.
   - For complex architectural refactoring: pass `model: "gemini-3.8-flash-high"` and `effort: "high"`.
   - Once passed, the model remains set for the rest of your session automatically.
3. **Execute Web Research if Needed:**
   - Prepend `/browser ` to search the web for current documentation or inspect live endpoints.
4. **Implement Code Changes:**
   - Use `ask_agent` for autonomous multi-file edits, or use direct `read_workspace_file` and `write_workspace_file` for targeted surgical edits.
5. **Verify with Tests:**
   - Run tests or build commands via `run_shell_command` (e.g. `npm test`, `npm run build`).
6. **Report Summary with Token Usage:**
   - Present a concise, clear summary of actions taken and reference token metrics.
