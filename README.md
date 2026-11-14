# VibzCode

[![Release Version](https://img.shields.io/badge/version-2.2.0-blue.svg?style=flat-square)](https://github.com/Zizwar/vibzcode/releases)
[![npm version](https://img.shields.io/npm/v/vibzcode.svg?color=cb3837&style=flat-square)](https://www.npmjs.com/package/vibzcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Zizwar%2Fvibzcode-black.svg?style=flat-square&logo=github)](https://github.com/Zizwar/vibzcode)

**VibzCode (v2.2.0)** is a sovereign, self-hosted Multi-Engine AI Agent Orchestrator and Workspace Platform. It provides a centralized command bridge to configure, isolate, dispatch, and supervise autonomous agent sessions across multiple AI CLI engines, backed by a persistent zero-knowledge memory substrate (**MemoryZ v3**), real-time job progress streaming, HMAC-signed self-authorizing file downloads, and dual-layer **Remote Model Context Protocol (MCP)** endpoints.

---

## 🌟 Architecture Overview

```mermaid
flowchart TD
    User["Developer / Web Dashboard"] -->|"HTTP / WebSocket"| VibzServer["VibzCode Orchestrator (Express & Node.js)"]
    ExternalMCP["Claude Desktop / Cursor / ChatGPT / Open WebUI"] -->|"Remote MCP (HTTP / SSE)"| VibzServer

    subgraph CoreEngineControl ["Multi-Engine Execution Substrate"]
        VibzServer --> AGY["Google Antigravity CLI (agy)"]
        VibzServer --> Claude["Anthropic Claude Code (claude)"]
        VibzServer --> Codex["OpenAI Codex CLI (codex)"]
        VibzServer --> Vibe["Mistral AI Vibe (vibe)"]
        VibzServer --> OpenCode["OpenCode CLI (opencode)"]
    end

    subgraph MemoryLayer ["Sovereign Memory Substrate (MemoryZ v3)"]
        VibzServer <--> MemoryZ["MemoryZ Cloud / Local Vector Engine"]
        MemoryZ --- ExactLookup["Exact Hash Lookup (memory_fetch)"]
        MemoryZ --- VectorRecall["Semantic Vector Recall (768-dim)"]
        MemoryZ --- TaskTree["Atomic Task Claiming & Trees"]
        MemoryZ --- ZKVault["Zero-Knowledge Encrypted Vault"]
    end

    subgraph EvalLayer ["System One Evaluation"]
        VibzServer <--> JevAI["TypeSafe Jev AI (Smart Routing & Gatekeeper)"]
    end
```

---

## 📸 Visual Showcase & Dashboards

| Central Sessions Dashboard (Grid View) | Hierarchical Branching & Forks (Tree View) |
| :---: | :---: |
| ![Admin Sessions Grid](docs/assets/screenshots/admin-sessions-grid.png) | ![Admin Sessions Tree](docs/assets/screenshots/admin-sessions-tree.png) |

| Interactive Agent Console & Media Preview | Workspace Sandbox Explorer |
| :---: | :---: |
| ![Agent Chat](docs/assets/screenshots/agent-chat.png) | ![Agent Workspace](docs/assets/screenshots/agent-workspace.png) |

> 🌐 **الصفحة التعريفية باللغة العربية:** يمكنك زيارة [الصفحة التعريفية الشاملة لمنصة VibzCode](https://zizwar.github.io/vibzcode/) للاطلاع على المميزات الكاملة ودليل الاستخدام السريع.

---

## 🚀 Key Highlights & Capabilities

### 1. Instant One-Command Boot (`npx vibzcode`)
Zero-friction bootstrapping: run `npx vibzcode` on any machine (Linux, macOS, Windows). VibzCode launches its daemon, probes environment credentials, and immediately opens the visual administration dashboard in your browser.

### 2. Multi-Engine AI Substrate
Seamlessly assign different projects or team tasks to specialized AI coding engines with custom permission boundaries:
- **Google Antigravity CLI (`agy`)**: Official Google agentic coding assistant with sandbox enforcement and directory scoping.
- **Anthropic Claude Code (`claude`)**: Deep architectural refactoring, bash automation, and terminal-native capabilities.
- **OpenAI Codex CLI (`codex`)**: Autonomous verification, unit testing, and script generation.
- **Mistral AI Vibe (`vibe`)**: Generative workspace manipulation and fast lightweight coding routines.
- **OpenCode CLI (`opencode`)**: Open-source multi-model CLI engine with automated approvals.

### 3. Shared Sovereign Memory Substrate (MemoryZ v3)
Prevent LLM context amnesia across distinct sessions and developer machines:
- **Exact Hash Retrieval (`get_memory`)**: Fetch explicit architectural rules, credentials, or documentation by deterministic cryptographic hash.
- **Memory-as-Attachment (`memory_refs`)**: Transparently inject stored memories directly into session prompts formatted as `<attached_memories_from_memoryz>`.
- **Hierarchical Tasks & Atomic Claiming**: Coordinate parallel multi-agent swarms with atomic locking (`task_claim`) to prevent duplicate agent labor.
- **Namespace Isolation**: Segregate state across projects (`default`, `vibzcode`, `enterprise`, etc.).

### 4. Dual-Plane Remote MCP Architecture (35+ Sovereign Tools)
Expose your agents, workspace files, and runtime jobs to external AI frontends (Claude Desktop, Cursor, ChatGPT, Open WebUI, and autonomous agent swarms) through standard Model Context Protocol (MCP) Streamable HTTP and SSE transports:
1. **Agent Session Plane (`/mcp?token=<SESSION_TOKEN>`)**: Scoped to a specific project directory. Provides `ask_agent`, `read_workspace_file`, `write_workspace_file`, `list_workspace_files`, `fetch_workspace_file`, `generate_file_download_link`, `run_shell_command`, and `store_memory`.
2. **Orchestrator Master Plane (`/mcp/orchestrator?token=<ADMIN_SECRET>`)**: Sovereign multi-session control plane. Provides dynamic agent provisioning (`session_create`), asynchronous task dispatching (`agent_dispatch`), real-time job progress polling (`get_job_progress` / `job_progress`), job cancellation (`abort_job` / `job_abort`), cross-session file links (`generate_file_download_link`), direct file inspection (`fetch_workspace_file`), multi-agent handoffs (`handoff`), and system notifications (`notify`).

### 5. Real-Time Job Progress & Streaming Output (New in v2.2)
Supervise long-running agent workflows with fine-grained visibility:
- **Streaming Tool Steps (`get_job_progress` / `job_progress`)**: Poll or stream the current active tool (e.g. running bash commands like `ffmpeg` or `pytest`), execution duration in seconds, progress log lines, and intermediate partial output before completion.
- **Instant Job Abort (`abort_job` / `job_abort`)**: Gracefully terminate hung or runaway agent tasks with clean process cleanup.
- **REST Streaming Endpoint**: Query `GET /api/session/job/progress/:jobId` to stream progress to any external dashboard or bot.

### 6. HMAC-Signed File Downloads & Direct Media Streaming (New in v2.2)
Eliminate 401 authentication issues for external agents and client tools:
- **Digital Download Tickets (`generate_file_download_link`)**: Generates self-authorizing, tamper-proof download URLs signed with HMAC-SHA256 (`ticket=...`).
- **Direct Workspace / Server Downloads**: Enables external agents (such as Miz) to pull generated videos, builds, or large datasets (e.g. `/root/elevenlabs/...`) using standard `curl` or HTTP clients without requiring manual header configuration.
- **In-Memory File Inspection (`fetch_workspace_file`)**: Fast zero-command inspection of text or code files up to 1MB directly over MCP.
- **Multi-Mode Auth Pipeline**: Supports `?ticket=...`, `?token=<ADMIN_SECRET>`, session tokens, and `Authorization: Bearer` headers.

### 7. Multi-Agent Sender Attribution & Chat Hydration (New in v2.2)
- **External Caller Attribution**: External agents calling `ask_agent` or `agent_dispatch` pass `sender: "AgentName"` (e.g. `"Miz"`), accurately tagging the prompt in the audit log.
- **Immediate Frontend Chat Hydration**: Dispatched tasks appear immediately in the session web chat without waiting for the job to complete.

### 8. Automated Setup Wizard & Key Sensing
On initial launch, VibzCode automatically probes for essential AI keys:
- If keys are missing, an interactive setup wizard guides you through entering them via a secure web dialog or generating terminal export snippets.
- Keys are written to `.env` with strict file permissions (`0o600`), and all sessions/databases are excluded from Git and npm packaging.

---

## 💻 Quick Start

### Option A: Run directly via NPX or PNPM (Recommended)
```bash
# Launch server and auto-open browser dashboard
npx vibzcode

# Or via pnpm dlx
pnpm dlx vibzcode

# Specify custom port
npx vibzcode --port 3333

# Run in headless mode (no auto-open)
npx vibzcode --no-open

# Check system keys status without starting server
npx vibzcode --status
```

### Option B: Install Globally (NPM or PNPM)
```bash
# Via npm
npm install -g vibzcode
vibzcode

# Or via pnpm
pnpm add -g vibzcode
vibzcode
```

### Option C: Run from Source
```bash
# Clone the repository
git clone https://github.com/Zizwar/vibzcode.git
cd vibzcode

# Install dependencies
npm install

# Start development server
npm start
```

### Option D: Production with PM2
```bash
pm2 start ecosystem.config.cjs
pm2 logs vibzcode
```

---

## 📦 Programmatic JavaScript / TypeScript SDK

In addition to the CLI and Web Dashboard, VibzCode can be imported directly into any Node.js / TypeScript project:

```bash
npm install vibzcode
```

### 1. Basic Agent Execution (`askAgent` / `vibzcode`)
```javascript
const { vibzcode, askAgent } = require('vibzcode');
// or: import { vibzcode, askAgent } from 'vibzcode';

async function main() {
  // Execute a coding task using Google Antigravity (agy)
  const result = await askAgent({
    engine: 'agy',                  // 'agy' | 'claude' | 'codex' | 'vibe' | 'opencode'
    prompt: 'Implement a rate limiter middleware for Express in TypeScript',
    targetDir: './src',             // Working directory for code edits
    sandbox: true,                  // Enforce workspace sandbox
    autoApprove: true               // Automatically approve non-destructive edits
  });

  console.log('Agent Response:\n', result.response);
  console.log(`Executed in ${result.duration}s via ${result.engine}`);
}

main();
```

### 2. Multi-Engine Routing & Switching
```javascript
const { vibzcode } = require('vibzcode');

// Shorthand syntax: vibzcode(engine, prompt, options)
// 1. Using Claude Code for architectural review
const review = await vibzcode('claude', 'Review architecture of database models in models/', {
  targetDir: process.cwd()
});

// 2. Using OpenAI Codex for unit testing
const tests = await vibzcode('codex', 'Generate unit tests for authService.js');

// 3. Using Mistral Vibe for quick script manipulation
const script = await vibzcode('vibe', 'Create a migration script from CSV to SQLite');
```

### 3. Shared MemoryZ Integration & Context Injection
VibzCode integrates natively with **MemoryZ v3**. You can pass credentials explicitly, supply a full URI with embedded token, or attach historical memory hashes:

```javascript
const { vibzcode } = require('vibzcode');

async function runWithMemory() {
  const result = await vibzcode({
    engine: 'agy',
    prompt: 'Refactor payment gateway to support Cryptomus webhook signatures',
    targetDir: './payments-service',

    // MemoryZ Configuration:
    // Option A: Explicit url & token
    memoryz: {
      url: 'https://memoryz.wino.deno.net',
      token: process.env.MEMORYZ_TOKEN || 'mz_...'
    },

    // Option B: Or pass full URI with embedded token
    // memoryz: 'https://memoryz.wino.deno.net?token=mz_your_token_here',

    // Attach specific architectural memories from MemoryZ by hash:
    memoryRefs: [
      '776cc8925e', // Cryptomus signature skill note
      'ca1fd49631'  // VibzCode release guidelines
    ]
  });

  console.log(result.response);
}
```

### 4. Standalone MemoryZ Client
You can also use the bundled `MemoryzClient` directly for vector recall and task management:
```javascript
const { MemoryzClient } = require('vibzcode');

const memoryz = new MemoryzClient({
  url: 'https://memoryz.wino.deno.net', // or full URI with query token
  token: 'mz_your_token_here'
});

// Vector semantic search
const memories = await memoryz.recallMemory({ query: 'database migration rules', limit: 3 });

// Store knowledge atom with 768-dim embeddings
await memoryz.storeMemory({
  title: 'Redis Caching Strategy',
  content: 'Use TTL 300s for user sessions with Redis cluster.',
  type: 'skill',
  namespace: 'my-project'
});
```

---

## ⚙️ Environment Configuration

You can configure VibzCode either through the interactive setup screen on `http://localhost:3333` or by creating a `.env` file:

```bash
# Copy the template
cp .env.example .env
```

### Core Configuration Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3333` | HTTP and WebSocket listening port |
| `ADMIN_USER` | `admin` | Master dashboard username |
| `ADMIN_PASS` | `Vibz@123456` | Master dashboard password *(strongly recommended to change in production)* |
| `GEMINI_API_KEY` | *(empty)* | Google Gemini API key for skill distillation & fast LLM reasoning |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Default Gemini model family |
| `MEMORYZ_URL` | `https://memoryz.wino.deno.net` | MemoryZ substrate endpoint |
| `MEMORYZ_TOKEN` | *(empty)* | MemoryZ authentication token |
| `JEV_AI_KEY` | *(empty)* | Optional TypeSafe Jev AI key for System One routing |
| `DISABLE_JEV` | `false` | Explicitly disable Jev AI to prevent token usage |
| `ANTHROPIC_API_KEY`| *(empty)* | Optional key when executing Anthropic Claude Code engine |
| `OPENAI_API_KEY` | *(empty)* | Optional key when executing OpenAI Codex engine |

---

## 🖥️ Web Interfaces & Endpoints

Once running, access the following unified interfaces and programmatic endpoints:
- **Admin Dashboard:** [http://localhost:3333/](http://localhost:3333/)  
  *Manage sessions, configure AI engines, view running tasks, and toggle MCP capabilities.*
- **Agent Workspace:** `http://localhost:3333/agent.html?token=<SESSION_TOKEN>`  
  *Isolated web console for chatting with the agent or accessing the terminal.*
- **Orchestrator Remote MCP:** `POST /mcp/orchestrator?token=<ADMIN_SECRET>`  
  *Full sovereign orchestrator control plane for autonomous multi-agent coordination.*
- **Session Remote MCP:** `POST /mcp?token=<SESSION_TOKEN>`  
  *Per-session MCP endpoint scoped to individual project workspaces.*
- **HMAC File Download API:** `GET /api/session/workspace/download?path=...&ticket=...`  
  *Token & HMAC-ticket authenticated download endpoint for workspace and server artifacts.*
- **Direct API Download Alias:** `GET /api/files/download?path=...&ticket=...`  
  *Direct download endpoint for external agents, scripts, and media streaming.*
- **Job Progress Streaming:** `GET /api/session/job/progress/:jobId`  
  *Real-time JSON stream of current running tool, step duration, and partial output.*
- **Job Abort Endpoint:** `POST /api/orchestrator/jobs/:id/abort`  
  *Immediate cancellation of active background agent processes.*
- **OpenAPI 3.1 Specification:** `http://localhost:3333/openapi.json`  
  *Direct endpoint to connect ChatGPT Custom GPTs or Open WebUI actions.*
- **Keys Setup API:** `GET /api/system/keys-status` & `POST /api/system/save-keys`

---

## 📋 Changelog (v2.2.0 Highlights)

| Feature | Scope | Description |
| :--- | :--- | :--- |
| **HMAC Download Tickets** | Core / MCP / REST | Self-authorizing HMAC-SHA256 digital tickets in `generate_file_download_link` allowing external agents (e.g. Miz) to download files without 401 errors. |
| **Real-Time Job Progress** | Engine / MCP / REST | Real-time tool-step tracking (`get_job_progress` / `job_progress`), elapsed execution duration, and intermediate partial output. |
| **Instant Job Abort** | Engine / MCP / REST | Added `abort_job` / `job_abort` to terminate runaway background agent executions cleanly. |
| **Direct File Inspection** | MCP | Added `fetch_workspace_file` to read text/code files (up to 1MB) directly via MCP without running a shell command. |
| **Caller Attribution** | Core / Web UI | Added `sender` attribution to `ask_agent` & `agent_dispatch`, with instant frontend chat hydration. |
| **Orchestrator Context** | MCP | `get_orchestration_context` now reliably reflects live session counts and MemoryZ architectural conventions. |

---

## 🔒 Security & Privacy Architecture

- **Zero Token Leakage:** All workspace sessions (`data/sessions.json`), job traces, and environment credentials (`.env`) are strictly untracked in Git and excluded from npm releases via `.npmignore` and whitelist filters.
- **RAM-Only Master Secret:** Admin tokens are cryptographically derived on startup using SHA-256 with high-entropy salt and never stored in cleartext.
- **Sandbox Directory Boundaries:** Agent processes are executed with strict cwd constraints and optional platform isolation.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  
Feel free to check the [issues page](https://github.com/Zizwar/vibzcode/issues).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
