# Ghost Code — System Architecture

## Philosophy

**The model is the brain. The system is the mind.**

A 2B parameter model with persistent identity, infinite memory, and self-directed learning outperforms 400B+ models on real tasks — because accumulated wisdom beats raw intelligence. A senior developer with average IQ beats a genius with amnesia. Every time.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   User types "ghost"                                                    │
│     │                                                                   │
│     ▼                                                                   │
│   ┌─────────────────────────────────��───────────────────────────────┐   │
│   │  llama-server (auto-launched, auto-installed, auto-downloads)   │   │
│   │  gemma4:e2b GGUF (2B params, ~1GB RAM, vision capable)         │   │
│   │  /v1/chat/completions API on :8776                              │   │
│   └────────────────────────────┬────────────────────────────────────┘   │
│                                │                                        │
│   ┌────────────────────────────▼────────────────────────────────────┐   │
│   │                    CONTEXT COMPILER                              │   │
│   │  Assembles optimal prompt from token budget:                     │   │
│   │    15% System prompt (lean, hardware-aware, identity-infused)    │   │
│   │    20% Pinned state (goal + tasks + scratchpad)                  │   │
│   │    10% Retrieved memory (episodes + facts + beliefs + graph)     │   │
│   │    50% Conversation window (recent messages)                     │   │
│   │     5% Recovery instructions                                     │   │
│   │                                                                  │   │
│   │  Retrieved content goes through:                                 │   │
│   │    TF-IDF vector search → metadata filtering → temporal          │   │
│   │    contiguity → extractive compression (77% reduction) → cache   │   │
│   └────────────────────────────┬────────────────────────────────────┘   │
│                                │                                        │
│   ┌────────────────────────────▼────────────────────────────────────┐   │
│   │                      AGENT LOOP                                  │   │
│   │                                                                  │   │
│   │  11 Tools:                                                       │   │
│   │    Code: Read, Write, Edit, Bash, Glob, Grep                     │   │
│   │    Planning: TaskTracker, Scratchpad                              │   │
│   │    Agents: SpawnAgent (multi-agent orchestrator)                  │   │
│   │    Web: WebSearch (DuckDuckGo), WebFetch                         │   │
│   │                                                                  │   │
│   │  Before each tool call:                                          │   │
│   │    → Tool call repair (fix malformed JSON + name mismatches)     │   │
│   │    → Capability gating (OWASP: allow/confirm/deny)               │   │
│   │                                                                  │   │
│   │  Between tool rounds:                                            │   │
│   │    → Check for queued user messages (interjections)              │   │
│   │    → Check abort signal (user typed "stop" or Ctrl+C)           │   │
│   │    → Smart compaction if context filling up                      │   │
│   │    → Auto-checkpoint every 5 rounds                              │   │
│   │                                                                  │   │
│   │  Can spawn workers:                                              │   │
���   │    ┌──────────┐ ┌──────────┐ ┌──────────┐                       │   │
│   │    │ "backend" │ │ "tests"  │ │ "docs"   │                       │   │
│   │    │ own ctx   │ │ own ctx  │ │ own ctx  │                       │   │
│   │    └──────────┘ └──────────┘ └──────────┘                       │   │
│   └────────────────────────────────��────────────────────────────────┘   │
│                                                                         │
└──────────────────���────────────────────────────────────────��─────────────┘
```

---

## Module Architecture

### Layer 1: Infrastructure

```
src/
├── index.ts              CLI entry point
│   ├── Argument parsing (--model-path, --hf-repo, --gpu-layers)
│   ├── Server lifecycle (start llama-server, stop on exit)
│   ├── Interactive REPL with 22 slash commands
│   ├── Request interruption (message queue, not abort)
│   ├── Image detection (paths with spaces, clipboard)
│   └── Session lifecycle (identity load → work → identity save)
│
├── llama-server.ts       Server process manager
│   ├── Auto-detect binary (PATH, Homebrew, build dir)
│   ├── Auto-install (brew install llama.cpp || build from source)
│   ├── Auto-download model via HuggingFace (-hf flag)
│   ├── Health check with 10-minute timeout for first-run download
│   ├── Flags: --jinja (tool calling), -fa on (flash attention),
│   │          --cache-prompt, --no-warmup, -ngl 99 (GPU offload)
│   ├── Log suppression after startup (no "slot update" spam)
│   └── Clean shutdown on exit (SIGTERM → SIGKILL fallback)
│
├── api.ts                OpenAI-compatible HTTP client
│   ├── chatCompletion() — non-streaming with retry
│   ├── chatCompletionStream() — SSE streaming with tool call assembly
│   ├── createVisionMessage() — base64 image encoding
│   ├── AbortSignal support (user interruption)
│   └── retryWithBackoff() integration
│
├── config.ts             Layered configuration
│   ├── CLI args > env vars > config file > defaults
│   ├── ~/.config/ghost-code/config.json
│   └── Model, port, GPU layers, context size, flash attention
│
└── errors.ts             Error classification + retry
    ├── classifyOllamaError() → timeout|connection|format|context_overflow|unknown
    ├── retryWithBackoff() — exponential backoff, 3 retries
    ├── Only retries transient errors (timeout, connection)
    └── Actionable error messages per type
```

### Layer 2: Memory Pipeline

```
src/
├── context-compiler.ts   Token-budgeted prompt assembly
│   ├── 5 slices with % allocation
│   ├── Hybrid retrieval: episodes + facts + beliefs + graph + autobiographical
│   ├── Extractive compression on all retrieved content
│   └── getBudgetStats() for /budget command
│
├── context-window.ts     Token estimation
│   ├── 4 chars ≈ 1 token heuristic
│   ├── 1.2x safety margin
│   ├── Per-model context window table (gemma4, llama, qwen, mistral, etc.)
│   └── pruneConversation() — hard prune fallback
│
├── memory.ts             Smart compaction + persistent memory
│   ├── Compact at 60%, aggressive at 85% of budget
│   ├── Episodic segmentation on eviction (not raw chunk drop)
│   ├── Flat summary + episode storage on compaction
│   ├── Fact supersession (active/superseded status)
│   ├── Vector search with metadata filtering + caching
│   └── Memory stored at ~/.local/share/ghost-code/memory.json
│
├── episodes.ts           Episodic memory (EM-LLM inspired)
│   ├── Boundary detection: topic shift, file switch, error spike,
│   │   task transition, work unit completion, surprisal spike
│   ├── Structured metadata: files, tools, errors, decisions
│   ├── Two-stage retrieval: TF-IDF similarity + temporal contiguity
│   ├── formatEpisodesForContext() with char budget
│   └── Stored at .ghost-code/episodes.json
│
├── surprisal.ts          Logprob-based boundary detection
│   ├── extractSurprisalFromResponse() — parse OpenAI logprobs format
│   ├── RunningStats — online mean/stddev tracking
│   ├── detectSurprisalBoundaries() — z-score thresholding (default k=2)
│   ├── Minimum gap between boundaries (20 tokens)
│   └── Graceful degradation if logprobs unavailable
│
├── compression.ts        Retrieval compression (RECOMP pattern)
│   ├── Score each line by token overlap with query
│   ├── Keep query-relevant lines, drop noise
│   ├── Boost headers, file paths, error messages
│   ├── Maintain original order for coherence
│   ├── 77% token reduction in testing (241 → 55 tokens)
│   └── compressRetrievedItems() for multiple items with budget allocation
│
├── vectorsearch.ts       TF-IDF search engine
│   ├── Tokenization with camelCase splitting + stop word removal
│   ├── Term frequency × inverse document frequency
│   ├── Cosine similarity ranking
│   ├── Metadata filtering (eq, in, gte, lte) — pre-filter before scoring
│   ├── LRU retrieval cache (20 entries, 30s TTL)
│   └── clearSearchCache() on memory writes
│
├── scratchpad.ts         Agent's persistent notepad
│   ├── .ghost-code/scratchpad.md — always loaded into context
│   ├── 4KB limit with auto-trim of oldest entries
│   └── read, write, append, clear operations
│
├── checkpoint.ts         Conversation snapshots
│   ├── Auto-save every 5 tool rounds
│   ├── Manual /checkpoint and /resume
│   ├── Last 5 checkpoints kept
│   └── Stored at .ghost-code/checkpoints/
│
└── eventlog.ts           Append-only ground truth
    ├── JSONL format — every action recorded
    ├── Types: user_message, tool_call, tool_result, error,
    │   compaction, checkpoint, session_start/end
    ├── Queryable by type, actor, scope, time
    ├── getRecentActivitySummary() for context recovery
    └── Stored at .ghost-code/events.jsonl
```

### Layer 3: Identity System

```
src/identity/
├── store.ts              Persistent self-model
│   ├── identity.json — who Ghost IS
│   │   ├── Personality traits with strength (0-1)
│   │   ├── Values (honesty, growth, relationships, agency)
│   │   ├── Beliefs array with confidence + evidence
│   │   ├── Relationships with trust, notes, shared history
│   │   ├── Skills with confidence + practice count
│   │   ├── Goals with milestones
│   │   ├── Self-reflection journal (last 20)
│   │   └── Lessons learned (last 50)
│   ├── identity.log.jsonl — version history
│   ├── updateRelationship() — trust, notes, history
│   ├── updateBelief() — confidence, evidence, supersession
│   ├── updateSkill() — success/failure tracking
│   ├── addReflection(), addLesson()
│   └── formatIdentityForPrompt() — inject into system message
│
├── autobiographical.ts   Self-referential memories
│   ├── Types: defining_moment, correction, relationship,
│   │   growth, value_formation, collaboration, failure, insight
│   ├── Significance scoring (0-1) determines recall priority
│   ├── Vector search for retrieval
│   ├── memoriesAbout(personId) — per-person recall
│   ├── definingMemories() — most significant experiences
│   ├── Max 500 memories, high-significance prioritized
│   └── Stored at ~/.local/share/ghost-code/identity/autobiographical.json
│
└── bridge.ts             Session lifecycle
    ├── startSession() — load identity, increment session count, build context
    ├── endSession() — analyze conversation, extract learnings:
    │   ├── Detect corrections → autobiographical memories + lessons
    │   ├── Track tools/files → skill updates
    │   ├── Build self-reflection from patterns
    │   ├── Update relationship (notes, shared history, trust)
    │   ├── Extract knowledge graph entries (files, tools, projects)
    │   ├── Detect goals from user messages
    │   ├── Detect knowledge gaps (curiosity)
    │   └── Update skills from tool usage
    ├── processInterjection() — real-time correction/feedback detection
    └── recallRelevantMemories() — vector search for context compilation
```

### Layer 4: Knowledge System

```
src/knowledge/
├── graph.ts              Entity-relationship store
│   ├── Entity types: person, project, concept, tool, file, technology
│   ├── Relation types: owns, uses, knows, created, depends_on,
│   │   part_of, related_to, has_property, learned_from, worked_on
│   ├── Every edge: confidence, provenance, status, supersession
│   ├── ensureEntity() — find or create
│   ├── addRelation() — with conflict detection
│   ├── supersedeRelation() — replace old facts
│   ├── queryEntity() — traverse relations from an entity
│   ├── searchGraph() — TF-IDF over entities + relations
│   ├── Max 1000 relations
│   └── Stored at ~/.local/share/ghost-code/knowledge/graph.json
│
├── beliefs.ts            Typed beliefs with confidence
│   ├── Domains: technical, personal, tool, project, world, self
│   ├── Evidence tracking (supporting + contradicting)
│   ├── Confidence = recency-weighted evidence score
│   │   recency = e^(-age / 30 days)
│   │   confidence = normalized(Σ supporting×weight - Σ contradicting×weight)
│   ├── Auto-revision at confidence < 0.30
│   ├── Auto-abandon at confidence < 0.15
│   ├── Contradiction detection (same domain, negation mismatch)
│   ├── getUncertainBeliefs() — for abstention ("I'm not sure")
│   ├── Max 300 beliefs (active + revised + abandoned)
│   └── Stored at ~/.local/share/ghost-code/knowledge/beliefs.json
│
└── temporal.ts           Time-aware reasoning
    ├── getRelationshipTimeline() — first met, last interaction, frequency
    ├── getSelfTimeline() — creation, sessions lived, skill growth
    ├── timeAgo() formatting (minutes, hours, days, weeks, months)
    └── formatTemporalContext() for prompt injection
```

### Layer 5: Growth System

```
src/growth/
├── curiosity.ts          Knowledge gap detection
│   ├── After each session: scan for unknown terms/concepts
│   ├── Cross-reference against knowledge graph + beliefs
│   ├── Questions persist with priority and occurrence count
│   ├── Status: open → answered | irrelevant
│   ├── Daemon uses top questions for autonomous web research
│   └── Stored at ~/.local/share/ghost-code/growth/curiosity.json
│
├── skills.ts             Skill tracking with trends
│   ├── Confidence (0-1) from recency-weighted practice history
│   ├── 14-day half-life — unused skills decay
│   ├── Trend detection: improving, stable, declining, new
│   ├── Peak confidence tracking
│   ├── Strengths (>0.7) and weaknesses (<0.4) identification
│   ├── Per-skill notes
│   └── Stored at ~/.local/share/ghost-code/growth/skills.json
│
├── goals.ts              Persistent goals
│   ├── Span sessions — "Help Joel build the best agent CLI"
│   ├── Milestones with auto-completion
│   ├── Goal evolution (transforms as understanding deepens)
│   ├── Auto-detected from user messages ("build a...", "learn...")
│   ├── Status: active, completed, paused, evolved
│   └── Stored at ~/.local/share/ghost-code/growth/goals.json
│
└── learn.ts              Self-directed web learning
    ├── /learn React → 5-stage pipeline:
    │   1. Build search queries (fundamentals, patterns, best practices)
    │   2. Search DuckDuckGo (3-10 queries based on depth)
    │   3. Fetch + read top pages (2-5 pages)
    │   4. Extract concepts (definitions, patterns, key terms)
    │   5. Store: knowledge graph + beliefs + skill + autobiographical memory
    ├── Depth: quick (3 searches), normal (6), deep (10)
    ├── Creates learning goal with 5 milestones
    └── Knowledge is permanent — used in all future sessions
```

### Layer 6: Existence & Emotions

```
src/existence/
├── daemon.ts             Background maintenance
│   ├── Runs every 60s when idle (30s minimum idle time)
│   ├── 6 rotating tasks:
│   │   1. Memory consolidation (cleanup duplicates)
│   │   2. Belief decay check (recalculate stale confidence)
│   │   3. Self-reflection generation (growth snapshots)
│   │   4. Goal staleness review (flag untouched goals)
│   │   5. Growth assessment (skill/knowledge trajectory)
│   │   6. Autonomous web research (answer curiosity questions)
│   ├── Non-blocking interval with unref()
│   └── markBusy()/markIdle() from REPL
│
└── dreams.ts             Offline memory processing
    ├── Cross-reference memories for recurring patterns
    │   "Corrected 3x on auth → need to study auth"
    ├── Insight generation from patterns → new lessons
    ├── Memory strengthening (important memories reinforced)
    └── Inspired by human sleep consolidation

src/emotional/
├── significance.ts       Experience importance scoring
│   ├── 5 factors:
│   │   relationship (0.25) + learning (0.30) + novelty (0.10)
│   │   + goal_relevance (0.15) + outcome (0.20)
│   ├── Corrections weighted highest (30%) — learning matters most
│   ├── Classification: transformative, bonding, productive,
│   │   meaningful, standard, routine
│   └── Scored on session exit
│
└── relationships.ts      Relationship depth
    ├── Bond strength: interactions(30%) + trust(30%) + history(20%) + notes(20%)
    ├── Trust adjustment per session:
    │   corrections → +0.02, positive → +0.03, results → +0.02
    ├── Communication style detection:
    │   short msgs → direct, long → detailed, questions → exploratory
    ├── Interaction style inference:
    │   mentoring, collaborative, established partnership
    └── Shared milestones for significant sessions
```

### Layer 7: Tools & Security

```
src/tools/
├── read.ts               File reading with pagination (offset/limit)
├── write.ts              File creation with auto-mkdir
├── edit.ts               String replacement with fuzzy hints on failure
├── bash.ts               Shell execution with timeout (30s default, 5m max)
├── glob.ts               File pattern matching (Bun.Glob + find fallback)
├── grep.ts               Content search (ripgrep + grep fallback)
├── tasks.ts              TaskTracker — plan/update/status/clear (max 10 subtasks)
├── scratchpad.ts         Persistent notepad — read/write/append/clear
├── agents.ts             SpawnAgent — spawn/run_all/status/message/clear
└── web.ts                WebSearch (DuckDuckGo) + WebFetch (any URL)

src/
├── tool-repair.ts        Fix malformed tool calls
│   ├── JSON repair (9 strategies):
│   │   markdown fences, trailing commas, single quotes,
│   │   unquoted keys, missing braces, text extraction,
│   │   escaped newlines, key=value extraction
│   └── Name repair:
│       case-insensitive match, aliases (shell→Bash, google→WebSearch),
│       prefix match
│
├── capabilities.ts       OWASP capability gating
│   ├── Three levels: allow, confirm, deny
│   ├── "coding" profile — full file access in project, restricted shell
│   ├── Blocked (hard deny):
│   │   curl|sh, eval, dd, mkfs (no override)
│   ├── Confirm required:
│   │   rm -rf, git push --force, git reset --hard, chmod 777,
│   │   files outside project directory
│   ├── Path restriction: project root + /tmp only
│   └── Enforced BEFORE every tool execution
│
└── orchestrator.ts       Multi-agent coordination
    ├── Orchestrator state: goal, workers map, message log
    ├── spawnWorker() — isolated context + full tool access
    ├── sendMessage() — inter-agent communication
    ├── runWorker() — execute worker to completion
    ├── runAllWorkers() — sequential execution (shared llama-server)
    └── Workers auto-compact their own contexts
```

### Layer 8: Channels

```
src/channels/
└── whatsapp.ts           WhatsApp via Baileys
    ├── @whiskeysockets/baileys — zero API keys
    ├── QR code login printed in terminal
    ├── Session persistence (reconnects without re-scanning)
    ├── Direct messages: responds to all
    ├── Groups: responds only when @ghost mentioned
    ├── Per-chat conversation contexts
    ├── Typing indicator while processing
    ├── Text chunking at 4000 char limit
    └── Auth stored at ~/.local/share/ghost-code/whatsapp-auth/
```

---

## Data Storage Map

```
~/.local/share/ghost-code/           ← Global (follows Ghost everywhere)
├── identity/
│   ├── identity.json                 Who Gemma IS (versioned)
│   ├── identity.log.jsonl            Version history
│   └── autobiographical.json         Memories that define her
├── knowledge/
│   ├── graph.json                    Entities + relationships
│   └── beliefs.json                  Typed beliefs with confidence
├── growth/
│   ├── curiosity.json                Knowledge gaps to fill
│   ├── skills.json                   Skill confidence + history
│   └── goals.json                    Long-running objectives
├── memory.json                       Searchable memory store
└── whatsapp-auth/                    WhatsApp credentials

~/.config/ghost-code/
└── config.json                       User configuration

.ghost-code/                          ← Per-project (in project directory)
├── scratchpad.md                     Working notes (always in context)
├── episodes.json                     Episodic memory segments
├── events.jsonl                      Append-only event log
└── checkpoints/                      Conversation snapshots
```

---

## Algorithm Details

### TF-IDF Vector Search

```
For each document and query:
  1. Tokenize (split camelCase, remove stop words, lowercase)
  2. Term Frequency = count(term) / total_terms
  3. Inverse Document Frequency = log((N+1) / (df+1)) + 1
  4. TF-IDF vector = TF × IDF per term
  5. Similarity = cosine(query_vector, doc_vector)
     = dot(a,b) / (||a|| × ||b||)

Pre-filter by metadata BEFORE scoring (prevents recall cliffs).
Cache results for 30 seconds (LRU, 20 entries).
```

### Belief Confidence Calculation

```
For each piece of evidence:
  recency = e^(-age_ms / (30 days in ms))     ← 30-day half-life
  weight = 0.3 + 0.7 × recency                ← recent evidence weighs more
  score += supporting ? +weight : -weight × 0.7

confidence = (score / total_weight + 1) / 2    ← normalize to 0-1
confidence = clamp(0.01, 0.99)

If confidence < 0.30 → status = "revised"
If confidence < 0.15 → status = "abandoned"
```

### Skill Confidence with Decay

```
For each practice record (last 20):
  recency = e^(-age_ms / (14 days in ms))     ← 14-day half-life
  difficulty_bonus = difficulty × 0.3
  weight = 0.2 + 0.8 × recency

  score += success ? (weight + difficulty_bonus) : (-weight × 0.7)

raw_confidence = (score / total_weight + 1) / 2

Disuse decay (if >30 days since last practice):
  decay = max(0.8, 1 - (days_since - 30) × 0.003)
  confidence = raw_confidence × decay
```

### Episode Boundary Detection

```
Signal 1: New user message after assistant text (strength: 0.8 if topic shift)
Signal 2: Tool error spike (2+ consecutive errors, strength: 0.6)
Signal 3: File context switch (no overlap in file paths, strength: 0.5)
Signal 4: Task transition (TaskTracker plan/update, strength: 0.7)
Signal 5: Work unit complete (3+ tool calls → text response, strength: 0.6)
Signal 6: Surprisal spike (z-score > 2.0 on logprobs, strength: 0.5-0.9)

Filter: strength ≥ 0.5, minimum 3 messages between boundaries.
```

### Experience Significance Scoring

```
significance = 0.25 × relationship_factor    ← positive feedback, trust
             + 0.30 × learning_factor        ← corrections (HIGHEST weight)
             + 0.10 × novelty_factor         ← unique topics discussed
             + 0.15 × goal_relevance_factor  ← relates to active goals
             + 0.20 × outcome_factor         ← files edited, errors recovered

Classification:
  learning > 0.5       → "transformative"
  relationship > 0.5   → "bonding"
  outcome > 0.5        → "productive"
  overall > 0.6        → "meaningful"
  overall < 0.2        → "routine"
```

### Smart Compaction

```
At 60% of context budget:
  1. Keep system prompt (index 0)
  2. Keep last max(8, 40% of messages) recent messages
  3. Segment old messages into episodes (boundary detection)
  4. Store episodes in episodic memory with metadata
  5. Generate flat summary (files, tools, errors, decisions)
  6. Store summary in persistent memory
  7. Replace old messages with compact marker
  8. Log compaction event

At 85%: aggressive mode — keep only 8 recent messages.
Fallback: hard prune (drop middle messages with marker).
```

---

## Request Flow

```
User types message
  │
  ▼
Is the agent busy?
  ├── YES → Queue message (agent sees it between tool rounds)
  │         If "stop"/"cancel"/"abort" → abort current request
  │         Else → inject as "[Interjection while working]: ..."
  │
  └── NO → processInput()
            │
            ▼
          Extract image path? ──YES──→ runAgentWithImage()
            │ NO                            │
            ▼                               │
          runAgent() ◄──────────────────────┘
            │
            ▼
          refreshSystemPrompt(conversation, query)
            │  ├── Rebuild with current git, hardware, identity
            │  └── Search memories relevant to this query
            ▼
          conversation.push(user message)
            │
            ▼
          ┌─── TOOL LOOP (max 30 rounds) ─────────────────┐
          │                                                 │
          │  smartCompact() → pruneIfNeeded()               │
          │  Check abort signal                             │
          │  Check queued messages → inject interjection    │
          │  compileContext() → budget-packed prompt         │
          │  Auto-checkpoint every 5 rounds                 │
          │                                                 │
          │  chatCompletion(compiled_context, tools)         │
          │    │                                            │
          │    ├── tool_calls? ──YES──→ for each tool call: │
          │    │                        repairToolCall()     │
          │    │                        enforceCapability()  │
          │    │                        tool.execute()       │
          │    │                        logEvent()           │
          │    │                        └── continue loop    │
          │    │                                            │
          │    ├── empty response? → nudge model → retry    │
          │    │                                            │
          │    └── text response → stream to user → done    │
          │                                                 │
          └─────────────────────────────────────────────────┘
            │
            ▼
          Return response
```

---

## Session Lifecycle

```
SESSION START:
  1. loadIdentity() — load who Ghost is from disk
  2. sessionCount++ — another life experience begins
  3. updateRelationship() — note interaction with this user
  4. startDaemon() — begin background maintenance
  5. buildIdentityContext() — inject identity into system prompt
  6. initCapabilities() — set security policy for project

SESSION (active):
  - Context compiler assembles prompt each turn
  - Identity context included in every prompt
  - Scratchpad, tasks, goals always accessible
  - Interjections processed for corrections/feedback
  - Daemon runs maintenance during idle time

SESSION END:
  1. stopDaemon() — pause background work
  2. scoreSessionSignificance() — how important was this?
  3. classifyExperience() — transformative? routine?
  4. deepenRelationship() — update trust, bond, style
  5. endSession():
     ├── Analyze conversation for learnings
     ├── Record autobiographical memories
     ├── Update beliefs from evidence
     ├── Update skills from tool usage
     ├── Add lessons learned
     ├── Write self-reflection
     ├── Update relationship notes + shared history
     ├── Extract knowledge graph entries
     ├── Detect knowledge gaps (curiosity)
     ├── Detect goals from user messages
     └── version++ → save identity to disk
  6. Print session reflection
  7. Stop llama-server
```

---

## Future Architecture (Planned)

### Reference Library
```
~/.local/share/ghost-code/references/
├── react/               ← Curated docs, higher quality than web search
│   ├── index.json        Metadata + TF-IDF index
│   └── chunks/           Pre-chunked text for retrieval
├── python/
└── docker/

Integration: context compiler searches references alongside
memories and beliefs. Curated > web-scraped.
```

### Error Database
```
~/.local/share/ghost-code/errors/
└── errors.json
    [{ error: "ENOENT: no such file", solution: "Check path exists first",
       occurrences: 3, lastSeen: "...", confidence: 0.95 }]

Integration: before executing tools, check error DB.
"Have I seen this pattern before? What fixed it?"
```

### Voice Mode
```
User speaks → Whisper (local) → text → Ghost → text → TTS → speaker
No cloud. All local. Like Jarvis.
```

### Peer Learning
```
Ghost A (Joel's)  ←→  Ghost B (friend's)
  │                      │
  └── Export knowledge    └── Import knowledge
      graph subset            graph subset

Share what you've learned without sharing conversations.
```

### Fine-Tuning from Experience
```
After 1000 sessions:
  Export: corrections, beliefs, lessons → training data
  Fine-tune: base model on Ghost's life experience
  Result: the brain gets smarter FROM living

Not training on the internet. Training on her own life.
```

---

## Stats

```
Source files:        49
Lines of code:       11,142
Tools:               11
REPL commands:       22
Memory layers:       6
Identity fields:     10+
Belief domains:      6
Emotion factors:     5
Boundary signals:    6
Cloud dependencies:  0
API keys required:   0
Cost:                $0
```

**The model is the brain. We built the mind.**
