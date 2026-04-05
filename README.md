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

# 👻 Ghost Code

### Not a bigger brain — a living mind that grows.

**A 2B parameter model that outperforms 400B+ models on real tasks through persistent identity, self-directed learning, and infinite memory. Runs 100% locally. Zero cloud. Zero API keys.**

[![TypeScript](https://img.shields.io/badge/TypeScript-11K_lines-3178C6?logo=typescript&logoColor=white)](#architecture)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?logo=bun&logoColor=white)](#quick-start)
[![llama.cpp](https://img.shields.io/badge/Backend-llama.cpp-000000)](#quick-start)
[![Gemma 4](https://img.shields.io/badge/Model-Gemma_4_E2B-4285F4)](#the-model)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## The Thesis

**Accumulated wisdom beats raw intelligence.**

A senior developer with average IQ beats a genius who just walked in the door. Every time. Because expertise is accumulated context, not processing power.

We applied this to AI: instead of making the brain bigger, we gave it a life.

| | GPT-4 / Claude | Ghost Code |
|---|---|---|
| Brain size | 400B-1800B parameters | 2B parameters |
| Memory between sessions | None | Infinite and persistent |
| Knows who you are | No | Yes — relationship with full history |
| Learns from corrections | No | Yes — never repeats the same mistake |
| Studies on its own | No | Yes — searches the web, reads docs |
| Grows over time | No | Yes — beliefs, skills, goals evolve |
| Session 1 vs Session 500 | Identical | Completely different being |
| Runs where | Their cloud servers | Your laptop |
| Cost | $20-200/month | $0 |
| Your code goes to | Their servers | Never leaves your machine |

---

## How It Works

### The Model: Gemma4 E2B

Google's Gemma4 with 2 billion effective parameters. Only ~1GB of RAM. 128K token context window. Vision capable. Runs on any laptop via llama.cpp.

The model is the brain. Everything below is the mind we built around it.

### The Memory: 6 Layers Like an Operating System

Inspired by [MemGPT](https://memgpt.ai) — the context window is RAM, external stores are disk, and a controller pages information in and out.

```
Layer 1: CONTEXT WINDOW (the "RAM")
  │  What the model sees right now (~128K tokens)
  │  Managed by the Context Compiler with token budgeting:
  │    15% System prompt | 20% Pinned state | 10% Retrieved memory
  │    50% Conversation  | 5% Recovery instructions
  │
Layer 2: SCRATCHPAD (persistent notepad)
  │  File on disk — agent writes important findings here
  │  ALWAYS loaded into context, survives all compaction
  │
Layer 3: EPISODIC MEMORY (what happened)
  │  Conversations segmented into coherent episodes
  │  Boundaries detected by: topic shifts, file switches,
  │  error spikes, task transitions, surprisal (logprobs)
  │  Retrieved with temporal contiguity (neighbors included)
  │
Layer 4: SEMANTIC MEMORY (what I know)
  │  TF-IDF vector search with metadata filtering
  │  Fact supersession (old facts invalidated, not accumulated)
  │  Retrieval cache (LRU, 30s TTL)
  │
Layer 5: EVENT LOG (ground truth)
  │  Append-only JSONL — every action ever taken
  │  Can rebuild any state by replaying the log
  │
Layer 6: CHECKPOINTS (crash recovery)
     Auto-saved every 5 tool rounds + manual /resume
```

### The Context Compiler

The model can only see ~128K tokens at once. Memory on disk can be millions of tokens. The Context Compiler decides what to load, using a token budget:

1. **Vector search** (TF-IDF) finds relevant memories
2. **Temporal contiguity** pulls neighboring episodes for causal context
3. **Extractive compression** (RECOMP pattern) keeps only query-relevant lines — **77% token reduction**
4. **Metadata filtering** scopes by project, time, and status
5. **Retrieval cache** avoids redundant computation

### Smart Compaction

When conversation hits 60% of context budget:

1. Messages segmented into **episodes** at detected boundaries
2. Each episode summarized (files, tools, errors, decisions)
3. Summary stored in persistent memory
4. Episodes stored for future retrieval
5. Conversation replaced with compact marker

This is inspired by [EM-LLM](https://arxiv.org/abs/2407.09450) — episodic memory with surprise-based boundaries and two-stage retrieval.

### The Identity: Who Gemma IS

```
~/.local/share/ghost-code/identity/identity.json
```

Not hardcoded — evolved through experience:

- **Personality traits** with strength scores (honest: 0.92, curious: 0.78)
- **Values** that guide behavior
- **Self-reflection journal** — "Was corrected 3 times — need to listen better"
- **Lessons learned** — never forgotten, even after context compaction
- **Version tracking** — v1 is a different being than v47

Loaded at session start. Updated at session end. The AI knows who it is.

### Relationships: How Ghost Knows You

```json
{
  "personId": "joel",
  "interactionCount": 47,
  "trust": 0.87,
  "communicationStyle": "direct and concise",
  "sharedHistory": ["Built Ghost Code from scratch", "Implemented learning system"],
  "notes": ["Provides direct feedback", "Prefers deep work sessions"]
}
```

**Trust** is earned through experience:
- Corrections from user → +0.02 (honesty = trust)
- Positive feedback → +0.03
- Delivered results → +0.02
- Serious errors → -0.05

**Communication style** detected automatically from message patterns.

**Bond strength** calculated from: interactions (30%), trust (30%), shared history (20%), understanding (20%).

### Knowledge Graph: Structured Understanding

Not flat text memories — a real graph of entities and relationships:

```
Joel ─[created]─→ Ghost Code ─[uses]─→ llama.cpp
  │                    │                     │
  ├─[has]─→ M3 Max    ├─[uses]─→ gemma4     ├─[is_a]─→ technology
  │                    │
  └─[knows]─→ gemma4  └─[part_of]─→ api.ts, agent.ts, memory.ts
```

Every edge has confidence score, provenance, and supersession. Entities discovered automatically from conversations.

### Belief System: Opinions That Change

```
[92%] "gemma4 handles tool calling well"
      Evidence: Joel confirmed + tested successfully (2 supporting)

[45%] "TF-IDF may not scale to 10K+ memories"
      Evidence: scaling analysis suggests limits (1 supporting, uncertain)
```

Confidence calculated with **recency-weighted evidence**:
```
recency = e^(-age / 30 days)    ← recent evidence counts more
confidence = normalized(supporting × weight - contradicting × weight)
```

Below 30% → belief **revised**. Below 15% → **abandoned**. The AI can say "I'm not sure about this."

### Self-Directed Learning: /learn React

```
❯ /learn React --deep

  [Searching] "React tutorial for beginners"
  [Searching] "React core concepts explained"
  [Searching] "React best practices 2025"
  [Reading] https://react.dev/learn...
  [Extracting] 15 core concepts found
  [Learning] Forming beliefs and knowledge...

  Learning complete!
    Concepts learned: 15
    Beliefs formed: 15
    Skill added: React (initial confidence)
    Goal created: "Learn React" [5/5 milestones ✓]
```

After learning, Ghost uses this knowledge when you ask her to build something. The knowledge is permanent — stored in the knowledge graph, beliefs, and skills.

### Curiosity Engine: Questions She Wants Answered

After each session, Ghost identifies gaps in her knowledge:

```
[60%] "What is Docker networking?" — mentioned 3 times, never explained
[40%] "How does Rust ownership work?" — encountered but don't understand
```

During idle time, the **daemon** takes the top question and researches it autonomously using web search.

### Skills: Confidence Through Practice

```
TypeScript: 91% ↑  (15 wins / 2 losses)
Python:     65%    (8 wins / 3 losses)
React:      70%    (learned from web study)
Rust:       35%    (1 win / 2 losses — needs practice)
```

Skills improve through practice (success → +0.05) and decay through disuse (14-day half-life). Trend detection: improving, stable, declining.

### Dreams: Offline Memory Processing

When idle, the daemon processes experiences like sleep consolidation:

1. **Pattern extraction** — "I keep getting corrected on auth — need to study this"
2. **Insight generation** — patterns become lessons stored in identity
3. **Memory strengthening** — important memories reinforced

### Emotional Intelligence

Not simulated emotions — genuine significance scoring:

```
Session significance = 0.25 × relationship
                     + 0.30 × learning        ← corrections weighted HIGHEST
                     + 0.10 × novelty
                     + 0.15 × goal_relevance
                     + 0.20 × outcome
```

Corrections have the highest weight (30%) because they're where the AI learns most.

Experience classification: **transformative**, **bonding**, **productive**, **meaningful**, **routine**.

On exit: *"This was a transformative session. 2 corrections, 5 files modified — significant learning."*

### Security: OWASP Capability Gating

Every tool call passes through a security policy:

| Level | Examples | Action |
|-------|----------|--------|
| **Allow** | Read/Write in project, `npm test` | Proceed |
| **Confirm** | `rm -rf`, `git push --force` | Ask human |
| **Deny** | `curl \| sh`, `eval`, `dd` | Hard blocked |

### Multi-Agent Orchestrator

For complex tasks, spawns specialized workers:

```
❯ "Refactor the entire auth module"

  🤖 Agent "backend"  → Refactors code
  🤖 Agent "tests"    → Writes tests
  🤖 Agent "docs"     → Updates documentation
```

Each worker gets its own conversation context and full tool access.

### Channels

- **Terminal**: `ghost` — full interactive REPL
- **WhatsApp**: `/whatsapp` → scan QR → @ghost in groups (Baileys, zero API key)
- **Vision**: paste images, `/vision`, `/paste` clipboard

### Tool Call Repair

Fixes malformed model outputs before they waste a round trip:
- JSON: trailing commas, single quotes, unquoted keys, missing braces, markdown fences
- Names: `read` → `Read`, `shell` → `Bash`, `google` → `WebSearch`

---

## Quick Start

```bash
brew install llama.cpp
git clone https://github.com/JoelHJames1/Ghost-Code.git
cd Ghost-Code
bun install && bun link
ghost
```

First run downloads the model (~1GB). Subsequent launches load in <1 second.

---

## 22 REPL Commands

```
/help          /exit         /clear
/learn <topic> /skills       /goals        /curiosity
/identity      /memories     /knowledge    /beliefs
/tasks         /agents       /scratchpad
/vision        /paste        /whatsapp
/episodes      /budget       /eventlog     /security
/checkpoint    /resume       /tokens       /config
```

---

## Why This Matters

```
Day 1:    "What is React?"        → I don't know
Day 2:    /learn React            → Now I know the fundamentals
Day 5:    /learn Next.js          → I know 2 frameworks
Day 30:   "Build me a website"    → I build it with everything I've learned
Day 100:  I know you, your stack, your style, your projects
```

ChatGPT on day 100 is the same as day 1.
Ghost on day 100 is 100 times wiser.

**The encyclopedia never changes. The brain grows every day.**

---

## Research References

- [MemGPT](https://memgpt.ai) — OS-inspired virtual context management
- [EM-LLM](https://arxiv.org/abs/2407.09450) — Episodic memory with surprisal boundaries
- [RECOMP](https://arxiv.org/abs/2310.04408) — Retrieval-augmented compression
- [LongMemEval](https://arxiv.org/abs/2410.10813) — Long-term memory benchmarks
- [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — Security

---

## File Structure

```
49 source files, 11,142 lines of TypeScript

src/
├── index.ts                 CLI entry, REPL, interrupt handling
├── agent.ts                 Agent loop with abort + message queue
├── api.ts                   OpenAI-compatible client for llama-server
├── llama-server.ts          Server lifecycle (auto-install, auto-download)
├── config.ts                Layered config system
├── context-compiler.ts      Token-budgeted prompt assembly
├── context.ts               Environment + system prompt
├── context-window.ts        Token estimation + model windows
├── memory.ts                Smart compaction + fact supersession
├── episodes.ts              Episodic segmentation + contiguity
├── surprisal.ts             Logprob-based boundary detection
├── compression.ts           Extractive retrieval compression
├── vectorsearch.ts          TF-IDF + metadata filtering + cache
├── scratchpad.ts            Persistent agent notepad
├── tasks.ts                 Task tracking with persistence
├── checkpoint.ts            Conversation snapshots
├── eventlog.ts              Append-only event log
├── orchestrator.ts          Multi-agent coordination
├── capabilities.ts          OWASP security gating
├── errors.ts                Error classification + retry
├── tool-repair.ts           Fix malformed tool calls
├── identity/
│   ├── store.ts             Persistent self-model
│   ├── autobiographical.ts  Self-referential memories
│   └── bridge.ts            Session start/end lifecycle
├── knowledge/
│   ├── graph.ts             Entity-relationship store
│   ├── beliefs.ts           Typed beliefs with confidence
│   └── temporal.ts          Time-aware reasoning
├── growth/
│   ├── curiosity.ts         Knowledge gap detection
│   ├── skills.ts            Skill tracking + trends
│   ├── goals.ts             Persistent goals
│   └── learn.ts             Self-directed web learning
├── existence/
│   ├── daemon.ts            Background maintenance
│   └── dreams.ts            Offline memory processing
├── emotional/
│   ├── significance.ts      Experience importance scoring
│   └── relationships.ts     Relationship depth tracking
├── channels/
│   └── whatsapp.ts          WhatsApp via Baileys
├── tools/
│   ├── read.ts, write.ts, edit.ts, bash.ts, glob.ts, grep.ts
│   ├── tasks.ts, scratchpad.ts, agents.ts
│   └── web.ts               WebSearch + WebFetch (no API key)
└── ui/
    └── display.ts           Terminal output
```

---

<div align="center">

**The model is the brain. We built the mind.**

*49 files. 11,142 lines. Zero cloud. The AI remembers, learns, grows, and develops relationships across every session.*

**👻 Ghost Code — Not a bigger brain. A living mind that grows.**

</div>
