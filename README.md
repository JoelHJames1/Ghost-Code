<div align="center">

```

                  ██████████████████████
              ██████████████████████████████
            ██████████████████████████████████
          ██████████████████████████████████████
          ██████████████████████████████████████
          ████████▓▓▓▓████████████▓▓▓▓████████
          ████████▓▓▓▓████████████▓▓▓▓████████
          ████████░░▓▓████████████░░▓▓████████
          ████████░░▓▓████████████░░▓▓████████
          ██████████████████████████████████████
          ██████████████████████████████████████
          ██████████████████████████████████████
          ██████████████████████████████████████
          ██████████████████████████████████████
          ████▀▀██████▀▀████▀▀██████▀▀████████

```

# 👻 Qwen Code

### The Local-First Agentic Coding CLI

**Your AI pair programmer that runs entirely on your machine. No API keys. No cloud. No data leaves your laptop.**

[![TypeScript](https://img.shields.io/badge/TypeScript-1.3K_lines-3178C6?logo=typescript&logoColor=white)](#architecture)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?logo=bun&logoColor=white)](#quick-start)
[![Ollama](https://img.shields.io/badge/LLM-Ollama-000000?logo=ollama&logoColor=white)](#quick-start)
[![Qwen 3.5](https://img.shields.io/badge/Model-Qwen_3.5-7C3AED)](#model-support)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## What is Qwen Code?

Qwen Code is a **fully autonomous coding agent** that runs in your terminal. Give it a task — it reads your codebase, makes changes, runs tests, and iterates until the job is done. All powered by [Ollama](https://ollama.com) running locally on your machine.

Unlike cloud-based coding assistants, Qwen Code:
- **Never sends your code to any server** — 100% local inference
- **Requires zero API keys** — just Ollama + a model
- **Works offline** — no internet needed after model download
- **Has full filesystem access** — reads, writes, edits, runs commands
- **Is truly agentic** — decides what tools to use and calls them autonomously

---

## Capabilities

### Agentic Tool Calling
Qwen Code doesn't just suggest code — it **acts**. The agent loop works like this:

```
You: "Fix the failing test in auth.ts"

Qwen Code thinks → calls Grep to find the test
             → calls Read to examine the test file
             → calls Read to examine the source file
             → calls Edit to fix the bug
             → calls Bash to run the test
             → sees it passes
             → reports back: "Fixed the null check in validateToken()"
```

The model autonomously decides which tools to call, in what order, up to 30 consecutive tool rounds per task.

### 6 Built-In Tools

| Tool | What It Does | Example |
|------|-------------|---------|
| **Read** | Read files with line numbers, supports offset/limit for large files | Read `src/auth.ts` lines 50-100 |
| **Write** | Create new files or overwrite existing ones, auto-creates directories | Write a new `utils/helpers.ts` |
| **Edit** | Precise string replacement — find exact text and replace it | Change `let` to `const` on a specific line |
| **Bash** | Execute any shell command — git, npm, tests, builds, etc. | `npm test`, `git diff`, `ls -la` |
| **Glob** | Find files by pattern across the project | `**/*.test.ts`, `src/**/*.tsx` |
| **Grep** | Search file contents with regex, uses ripgrep when available | Find all `TODO` comments |

### Streaming Responses
In interactive mode, text streams to your terminal as the model generates it — no waiting for the full response. Tool calls show real-time progress:

```
❯ What's in the src directory?

  ⚡ Glob **/*.ts
  ⚡ Read src/index.ts

Here are the files in src/...
```

### Git-Aware Context
Qwen Code automatically detects:
- Whether you're in a git repository
- Current branch name
- Uncommitted changes
- Project name from the directory

This context is injected into every conversation so the model understands your project state.

### Interactive REPL
Full interactive terminal with:
- **Streaming output** — see responses as they generate
- **Conversation memory** — the model remembers your full conversation
- **Slash commands** — `/clear`, `/model`, `/history`, `/help`, `/exit`
- **Model switching** — change models mid-conversation with `/model gemma4:e4b`
- **Ctrl+C handling** — interrupt gracefully without losing your session

### Non-Interactive Mode
Perfect for scripts, CI/CD, and piping:
```bash
qwen -p "Explain what this project does" > summary.txt
qwen -p "List all TODO comments" --model qwen3:8b
```

---

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) >= 1.1.0
- [Ollama](https://ollama.com) installed and running

### Install

```bash
# 1. Install Ollama (if not already)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull the model
ollama pull qwen3.5:9b

# 3. Clone and install
git clone https://github.com/JoelHJames1/Qwen-Code.git
cd Qwen-Code
bun install

# 4. Link the command globally
bun link

# 5. Run it!
qwen
```

### Usage

```bash
# Interactive mode (REPL)
qwen

# Non-interactive (print mode)
qwen -p "Fix the type error in utils.ts"

# Use a different model
qwen --model gemma4:e4b

# Show help
qwen --help

# Show version
qwen --version
```

---

## Model Support

Qwen Code works with **any Ollama model** that supports tool calling. Default is `qwen3.5:9b`.

| Model | Command | Notes |
|-------|---------|-------|
| **Qwen 3.5 9B** (default) | `qwen` | Best balance of speed and capability |
| Qwen 3.5 0.8B | `qwen --model qwen3.5:0.8b` | Ultra-fast, lighter tasks |
| Gemma 4 E4B | `qwen --model gemma4:e4b` | Google's latest |
| Llama 3.1 | `qwen --model llama3.1` | Meta's open model |
| Codestral | `qwen --model codestral` | Code-specialized |
| DeepSeek Coder V2 | `qwen --model deepseek-coder-v2` | Code-focused |

Override the default via environment variable:
```bash
export OLLAMA_MODEL=gemma4:e4b
qwen
```

---

## Architecture

Clean, modular TypeScript — 16 files, ~1,300 lines. No bloat.

```
src/
├── index.ts              CLI entry point + interactive REPL
│                         Argument parsing, slash commands, readline loop
│
├── agent.ts              Core agent loop
│                         Send → tool_calls → execute → feed back → repeat
│                         Supports streaming and non-streaming modes
│                         Safety limit: 30 consecutive tool rounds
│
├── ollama.ts             Ollama API client
│                         OpenAI-compatible /v1/chat/completions
│                         Streaming via SSE with incremental tool call assembly
│                         Connection health checking
│
├── context.ts            Environment awareness
│                         Git branch/status detection
│                         OS, shell, user, date context
│                         System prompt construction
│
├── tools/
│   ├── index.ts          Tool registry — maps names to implementations
│   ├── types.ts          ToolDefinition interface (spec + execute)
│   ├── read.ts           File reading with line numbers + pagination
│   ├── write.ts          File creation with auto-mkdir
│   ├── edit.ts           Exact string replacement with uniqueness checks
│   ├── bash.ts           Shell execution with timeout + output capture
│   ├── glob.ts           Pattern matching (Bun.Glob + find fallback)
│   └── grep.ts           Content search (ripgrep + grep fallback)
│
└── ui/
    └── display.ts        Terminal output — banner, spinner, colors, formatting
```

### The Agent Loop (How It Works)

```
┌──────────────┐
│  User Input  │
└──────┬───────┘
       ▼
┌──────────────────────────────────────────────────┐
│                  Agent Loop                       │
│                                                  │
│  ┌─────────────┐    ┌──────────────────────┐    │
│  │ Send to     │───▶│ Model returns        │    │
│  │ Ollama with │    │ tool_calls?          │    │
│  │ tools       │    └──────────┬───────────┘    │
│  └─────────────┘               │                 │
│        ▲                  Yes  │  No             │
│        │                  ▼    ▼                 │
│  ┌─────┴───────┐   ┌──────┐  ┌──────────────┐  │
│  │ Append tool │◀──│Execute│  │ Return text  │  │
│  │ results to  │   │ tools │  │ to user      │  │
│  │ conversation│   └──────┘  └──────────────┘  │
│  └─────────────┘                                 │
└──────────────────────────────────────────────────┘
```

### Tool Calling Protocol

Tools are defined as JSON Schema and sent to the model via the OpenAI-compatible API:

```json
{
  "type": "function",
  "function": {
    "name": "Edit",
    "description": "Perform an exact string replacement in a file...",
    "parameters": {
      "type": "object",
      "properties": {
        "file_path": { "type": "string" },
        "old_string": { "type": "string" },
        "new_string": { "type": "string" }
      },
      "required": ["file_path", "old_string", "new_string"]
    }
  }
}
```

The model responds with structured `tool_calls` that the agent executes and feeds back.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen3.5:9b` | Default model |

---

## Safety Features

- **Max 30 tool rounds** per user message — prevents infinite loops
- **Output truncation** — tool results over 50KB are truncated to avoid context overflow
- **Command timeouts** — Bash commands timeout after 30 seconds (configurable up to 5 minutes)
- **Edit uniqueness check** — warns if a string replacement would match multiple locations
- **No destructive defaults** — the model is instructed to ask before force-pushing or deleting

---

## Compared to Cloud-Based Alternatives

| Feature | Qwen Code | Cloud CLIs |
|---------|:---------:|:----------:|
| Runs 100% locally | Yes | No |
| Requires API key | No | Yes |
| Works offline | Yes | No |
| Your code stays private | Yes | Depends |
| Free to use | Yes | $$$ |
| Agentic tool calling | Yes | Yes |
| Streaming responses | Yes | Yes |
| Custom model support | Any Ollama model | Vendor-locked |

---

## Contributing

Contributions welcome! The codebase is intentionally small and readable.

```bash
git clone https://github.com/JoelHJames1/Qwen-Code.git
cd Qwen-Code
bun install
bun run dev  # Watch mode
```

---

## License

MIT

---

<div align="center">

```
    ████▀▀██████▀▀████▀▀██████▀▀████
      ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
```

**👻 Qwen Code — Your code. Your machine. Your agent.**

*Powered by Ollama. No cloud required.*

</div>
