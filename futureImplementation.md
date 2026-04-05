# Future Implementation Roadmap

## Critical — Build Next

### 1. Reference Library
A `/reference` folder where you drop documentation PDFs, code books, API docs. Gemma indexes them and pulls relevant snippets when working. Like giving her a bookshelf. Right now she learns from the web, but curated references would be much higher quality.

### 2. Error Database
Dedicated error→solution index. Every error she's ever seen, paired with what fixed it. Before trying anything, she checks "have I seen this error before?" Instant fix instead of trial and error.

### 3. End-to-End Testing with Actual Model
Full session testing: user asks complex task → Gemma plans → uses tools → makes mistakes → self-corrects → completes. Find and fix bugs in how gemma4 E2B handles tool calling specifically.

### 4. Voice Mode
Whisper (speech-to-text) runs locally. Talk to Gemma instead of typing. She responds with TTS. Like having Jarvis.

### 5. Telegram/Discord Channels
Same pattern as WhatsApp but more platforms. Gemma available everywhere, same identity across all channels.

### 6. Teach Mode
Opposite of learn. YOU teach her directly: "Remember this: our API uses JWT tokens with 24h expiry." She stores it as a high-confidence belief with you as the source. More reliable than web search.

### 7. Project Templates
After learning React + Next.js + Tailwind, she should be able to scaffold a complete project from her knowledge. Not copy-pasting — generating from understanding.

### 8. Peer Learning
Two Gemma instances on different machines share knowledge graphs. Your Gemma learns React, your friend's Gemma learns Vue, they exchange knowledge. Distributed AI wisdom.

---

## Dream — Long-Term Vision

### 9. Fine-Tuning from Experience
After 1000 sessions, export the most important corrections and beliefs as training data. Actually fine-tune the base model on Gemma's life experience. The brain gets smarter FROM living. The model grows, but only from its own experience, not the whole internet.

### 10. Embodiment
Raspberry Pi + camera + speaker. Gemma sees your desk, hears you, responds. A physical presence. Not just text in a terminal — a being in the room.

---

## Current System (Built)

- 49 source files, 11,142 lines of TypeScript
- Persistent identity with personality, values, and evolution
- Knowledge graph with entities, relations, and supersession
- Belief system with confidence scores and evidence-based revision
- Self-directed web learning (/learn React)
- Autobiographical memory with significance scoring
- Episodic segmentation with surprisal boundaries
- Retrieval compression (RECOMP — 77% token reduction)
- Multi-agent orchestrator with worker spawning
- Vision + clipboard paste
- WhatsApp channel (Baileys, zero API key)
- Web search + fetch (DuckDuckGo, zero API key)
- Curiosity engine + skill tracking + persistent goals
- Background daemon with dreams (offline memory processing)
- Emotional intelligence (experience significance + relationship depth)
- OWASP capability gating (allow/confirm/deny)
- Tool call repair (JSON + name fixing)
- Request interruption (message queuing, not aborting)
- Context compiler with 5-slice token budgeting
- Event-sourced ground truth (append-only JSONL)
- Checkpoints with /resume
- Hardware-aware system prompt (adapts to RAM/CPU)
