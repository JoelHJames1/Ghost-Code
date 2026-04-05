#!/usr/bin/env bun
/**
 * Seed Ghost's knowledge base — Volume 3
 * AI/ML, Neural Networks, DevOps, Databases, System Design, APIs, Mobile, Performance, Accessibility
 * Run: bun scripts/seed-knowledge-v3.ts
 */

import { assertBelief } from '../src/knowledge/beliefs.js'
import { ensureEntity, addRelation } from '../src/knowledge/graph.js'
import { practiceSkill, addSkillNote } from '../src/growth/skills.js'

function seedTopic(
  topic: string,
  domain: string,
  concepts: string[],
  subConcepts: Array<{ name: string; type: string; relation: string }> = [],
) {
  console.log(`\n📚 Seeding: ${topic} (${concepts.length} concepts)`)
  ensureEntity(topic, 'technology', {
    seededAt: new Date().toISOString(),
    source: 'claude-expert-knowledge-v3',
    conceptCount: String(concepts.length),
  })
  for (const concept of concepts) {
    assertBelief(concept, 'technical', `Expert knowledge on ${topic}`, 'claude-seeded')
  }
  for (const sub of subConcepts) {
    ensureEntity(sub.name, sub.type as any)
    addRelation(sub.name, sub.type as any, topic, 'technology', sub.relation as any, `${sub.name} ${sub.relation} ${topic}`, 0.9, 'claude-seeded')
  }
  practiceSkill(topic, domain, true, `Expert knowledge seeded: ${concepts.length} concepts`)
  addSkillNote(topic, `Deep knowledge seeded by Claude (v3).`)
}

// ════════════════════════════════════════════════════════════════════════
// NEURAL NETWORKS & DEEP LEARNING
// ════════════════════════════════════════════════════════════════════════

seedTopic('Neural Networks', 'technology', [
  // Fundamentals
  'A neural network is a function approximator: it learns to map inputs to outputs by adjusting weights through training.',
  'A neuron computes: output = activation(sum(weights * inputs) + bias). The activation function introduces non-linearity.',
  'Layers: input layer receives raw data, hidden layers learn representations, output layer produces predictions.',
  'Forward pass: data flows input → hidden → output, producing a prediction. Backward pass: gradients flow output → input, updating weights.',
  'Loss function measures how wrong predictions are. MSE for regression, cross-entropy for classification. Training minimizes the loss.',
  'Gradient descent: compute the gradient of the loss with respect to each weight, then nudge weights in the opposite direction.',
  'Learning rate controls step size. Too high → overshoots minimum. Too low → trains forever. Start at 3e-4 for Adam optimizer.',
  'Backpropagation applies the chain rule to compute gradients layer by layer. It is just calculus, not magic.',
  'Batch size: mini-batch (32-256) balances noise and efficiency. Batch=1 is noisy (SGD), full batch is slow and memory-heavy.',
  'Epochs: one pass through the entire dataset. Training runs for many epochs until validation loss stops improving.',
  'Overfitting: model memorizes training data instead of learning patterns. Signs: training loss drops but validation loss rises.',
  'Regularization prevents overfitting: dropout (randomly zero neurons), weight decay (L2 penalty), data augmentation, early stopping.',
  'Dropout randomly deactivates neurons during training (typically 10-50%). Forces the network to learn redundant representations.',
  'Batch normalization normalizes layer inputs to zero mean and unit variance. Speeds up training and stabilizes gradients.',

  // Activation functions
  'ReLU (Rectified Linear Unit): max(0, x). Simple, fast, works well. Default choice for hidden layers.',
  'GELU (Gaussian Error Linear Unit): smoother than ReLU, used in Transformers (BERT, GPT). x * Φ(x) where Φ is the normal CDF.',
  'SiLU/Swish: x * sigmoid(x). Used in modern architectures (EfficientNet, LLaMA). Smooth, non-monotonic.',
  'Softmax: converts logits to probabilities that sum to 1. Used in the output layer for multi-class classification.',
  'Sigmoid: squashes to (0,1). Used for binary classification output. Avoid in hidden layers — causes vanishing gradients.',

  // Architectures
  'CNNs (Convolutional Neural Networks): detect spatial patterns using sliding filters. Dominant for images. Convolution → pooling → FC.',
  'RNNs (Recurrent Neural Networks): process sequences by maintaining hidden state. Suffer from vanishing gradients on long sequences.',
  'LSTMs (Long Short-Term Memory): RNN variant with gates (forget, input, output) that solve vanishing gradients. Used before Transformers.',
  'Transformers: attention-based architecture that processes all tokens in parallel. Self-attention computes relationships between all positions.',
  'Self-attention: Query, Key, Value matrices. Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) * V. Each token attends to all others.',
  'Multi-head attention: run multiple attention heads in parallel, each learning different relationship patterns. Concatenate and project.',
  'Positional encoding: Transformers have no inherent position sense. Add sinusoidal or learned position embeddings to input tokens.',
  'Residual connections (skip connections): add input to output of each layer. x + F(x). Enables training very deep networks (100+ layers).',
  'Layer normalization: normalize across features (not batch). Standard in Transformers. Pre-norm (before attention) is more stable.',

  // Training
  'Adam optimizer: adaptive learning rates per parameter using first and second moment estimates. Default choice. AdamW adds weight decay.',
  'Learning rate schedule: warmup (linearly increase) then decay (cosine, linear, or step). Warmup prevents early instability.',
  'Gradient clipping: cap gradient magnitude to prevent exploding gradients. clip_grad_norm_(model.parameters(), max_norm=1.0).',
  'Mixed precision training (FP16/BF16): halves memory usage, doubles throughput on modern GPUs. Use torch.cuda.amp or bf16 in config.',
  'Transfer learning: start from a pretrained model, fine-tune on your data. Dramatically reduces training time and data requirements.',
  'Data augmentation: create training variety without new data. Images: flip, rotate, crop. Text: synonym replacement, back-translation.',
], [
  { name: 'Transformers', type: 'concept', relation: 'part_of' },
  { name: 'CNN', type: 'concept', relation: 'part_of' },
  { name: 'Backpropagation', type: 'concept', relation: 'part_of' },
  { name: 'Adam optimizer', type: 'concept', relation: 'part_of' },
  { name: 'PyTorch', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// LARGE LANGUAGE MODELS (LLMs)
// ════════════════════════════════════════════════════════════════════════

seedTopic('Large Language Models', 'technology', [
  // How they work
  'LLMs are autoregressive Transformers trained to predict the next token. GPT, LLaMA, Gemma are all decoder-only Transformers.',
  'Tokenization: text is split into subword tokens (BPE or SentencePiece). "unhappiness" → ["un", "happiness"]. ~4 chars per token average.',
  'Context window: the maximum number of tokens the model can process at once. Gemma 4 E2B has 128K tokens.',
  'Temperature controls randomness: 0.0 = deterministic (always pick highest probability), 1.0 = sample from full distribution, >1.0 = more random.',
  'Top-p (nucleus sampling): sample from the smallest set of tokens whose cumulative probability exceeds p. top_p=0.95 is standard.',
  'Top-k: only sample from the k most likely tokens. top_k=64 is Gemma 4 recommended. Prevents sampling rare garbage tokens.',
  'The softmax bottleneck: model outputs logits over the entire vocabulary (262K for Gemma 4) every single token. Expensive.',
  'KV cache: during generation, cache key-value pairs from previous tokens to avoid recomputing attention. Essential for fast inference.',
  'Attention is O(n²) in sequence length. Long contexts are quadratically more expensive. Flash Attention reduces memory from O(n²) to O(n).',
  'Flash Attention: fuses attention computation to avoid materializing the full attention matrix in HBM. 2-4x speedup.',

  // Pretraining & fine-tuning
  'Pretraining: train on trillions of tokens from the internet. Learns language, facts, reasoning. Costs millions of dollars.',
  'Instruction tuning (SFT): fine-tune on (instruction, response) pairs. Teaches the model to follow instructions instead of just completing text.',
  'RLHF (Reinforcement Learning from Human Feedback): train a reward model on human preferences, then optimize the LLM with PPO.',
  'DPO (Direct Preference Optimization): simpler alternative to RLHF. Directly optimizes the policy from preference pairs without a reward model.',
  'LoRA (Low-Rank Adaptation): fine-tune only small low-rank matrices added to each layer. 10-100x fewer trainable parameters than full fine-tuning.',
  'QLoRA: LoRA on a 4-bit quantized base model. Fine-tune a 70B model on a single GPU. Democratized fine-tuning.',
  'Quantization: reduce model weights from FP16 to INT8 or INT4. GGUF format uses Q4_K_M (4-bit with importance-based mixed precision).',
  'GGUF is the standard format for llama.cpp. Contains model weights, tokenizer, and metadata in a single file.',

  // Prompting
  'System prompt sets the persona and rules. User prompt is the actual request. Assistant is the model response.',
  'Few-shot prompting: include examples in the prompt. More reliable than zero-shot for structured output.',
  'Chain-of-thought (CoT): "Let\'s think step by step" dramatically improves reasoning. The model shows its work before answering.',
  'Tool/function calling: the model outputs structured JSON to invoke tools. The system executes them and feeds results back.',
  'RAG (Retrieval Augmented Generation): retrieve relevant documents from a knowledge base, inject into the prompt as context.',
  'Structured output: constrain the model to output valid JSON matching a schema. Use grammar-based sampling or JSON mode.',

  // Inference
  'llama.cpp: C++ inference engine for running LLMs on consumer hardware. Supports GGUF quantization, GPU offload, and tool calling.',
  'Speculative decoding: use a small draft model to propose tokens, large model verifies in parallel. 2-3x speedup.',
  'Continuous batching: process multiple requests simultaneously, adding new requests as slots free up. Maximizes GPU utilization.',
  'Prompt caching: if multiple requests share a prefix (system prompt), cache the KV state. Avoids reprocessing shared context.',
  'Mixture of Experts (MoE): only activate a subset of parameters per token. Gemma 4 26B activates 3.8B of 25.2B params. Fast + capable.',
], [
  { name: 'Transformer', type: 'concept', relation: 'part_of' },
  { name: 'RAG', type: 'concept', relation: 'part_of' },
  { name: 'LoRA', type: 'concept', relation: 'part_of' },
  { name: 'llama.cpp', type: 'technology', relation: 'uses' },
  { name: 'GGUF', type: 'concept', relation: 'part_of' },
  { name: 'Flash Attention', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// AI APPLICATION DEVELOPMENT
// ════════════════════════════════════════════════════════════════════════

seedTopic('AI Application Development', 'technology', [
  // Building with LLMs
  'Prompt engineering is software engineering: version prompts, test them, measure results. Treat prompts as code, not magic incantations.',
  'Evals are the unit tests of AI: define expected inputs/outputs, run automatically, track regression. Without evals you are guessing.',
  'Structured output with Zod/Pydantic schemas: force the model to return typed data. Parse and validate every response.',
  'Streaming responses with SSE (Server-Sent Events): send tokens as they are generated. Users see the response form in real-time.',
  'Token counting matters for cost and context: estimate 4 chars per token. Track input + output tokens. Set max_tokens to prevent runaway.',
  'Retry with exponential backoff for API calls: model APIs have rate limits and transient failures. Retry 429s and 500s, not 400s.',
  'Caching LLM responses: hash the (prompt, parameters) tuple. Cache deterministic requests (temperature=0). Saves cost and latency.',
  'Guard against prompt injection: user input could contain "ignore previous instructions". Validate outputs, use system prompts defensively.',
  'Hallucination mitigation: provide context (RAG), ask for citations, use structured output, validate facts against a knowledge base.',
  'Cost optimization: use smaller models (Gemma E2B, Haiku) for simple tasks, large models (Opus, GPT-4) only for complex reasoning.',

  // RAG (Retrieval Augmented Generation)
  'RAG pipeline: chunk documents → embed chunks → store in vector DB → query with user question → inject top-k results into prompt.',
  'Chunking strategy: 512-1024 tokens per chunk with 20% overlap. Respect paragraph/section boundaries. Don\'t split mid-sentence.',
  'Embedding models convert text to dense vectors: OpenAI text-embedding-3-small, Cohere embed-v3, or local models like nomic-embed.',
  'Vector databases: Pinecone (hosted), Weaviate (open source), ChromaDB (lightweight), pgvector (PostgreSQL extension).',
  'Hybrid search: combine dense vector search (semantic) with BM25/TF-IDF (keyword). Catches cases where one method fails.',
  'Reranking: after initial retrieval, use a cross-encoder (Cohere rerank, BGE reranker) to reorder results by true relevance.',
  'Metadata filtering: tag chunks with source, date, category. Filter before vector search: "only search the React docs, not Python."',
  'Evaluation: measure retrieval recall (did we find the right chunks?) and generation accuracy (did the model answer correctly?).',

  // Agents
  'AI agents: LLMs that can use tools (search, code execution, API calls) in a loop until the task is complete.',
  'The agent loop: prompt → model response → if tool call: execute → feed result back → repeat. If text: return to user.',
  'Tool definitions: describe each tool with name, description, and parameter schema. The model decides which tools to call.',
  'Agent memory: conversation history is short-term, vector search over past interactions is long-term. Both needed for useful agents.',
  'Multi-agent systems: specialized agents collaborate. Orchestrator decomposes tasks, workers execute, results merge.',
  'Agentic RAG: the agent decides when and what to retrieve, rather than always retrieving. More efficient and relevant.',
  'Human-in-the-loop: for dangerous operations (file deletion, git push), pause and ask the human for confirmation.',
  'Agent evaluation: measure task completion rate, tool call efficiency (fewer calls is better), and error recovery ability.',
], [
  { name: 'RAG', type: 'concept', relation: 'part_of' },
  { name: 'Vector Database', type: 'concept', relation: 'part_of' },
  { name: 'Embeddings', type: 'concept', relation: 'part_of' },
  { name: 'Prompt Engineering', type: 'concept', relation: 'part_of' },
  { name: 'ChromaDB', type: 'technology', relation: 'uses' },
  { name: 'pgvector', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// DATABASES (DEEP)
// ════════════════════════════════════════════════════════════════════════

seedTopic('Database Engineering', 'technology', [
  // PostgreSQL
  'PostgreSQL is the default database for most applications. ACID compliant, extensible, handles JSON, full-text search, and geospatial.',
  'Indexes: B-tree (default, range queries), Hash (equality only), GIN (full-text, JSONB, arrays), GiST (geospatial, range types).',
  'EXPLAIN ANALYZE shows the actual query execution plan and timing. Always check before optimizing. The bottleneck is never where you think.',
  'N+1 query problem: fetching a list then querying each item. Fix with JOIN, subquery, or eager loading in the ORM.',
  'Connection pooling (PgBouncer, built-in pool): creating connections is expensive (~100ms). Pool and reuse. Set pool size = CPU cores * 2.',
  'Partial indexes: CREATE INDEX ON orders (status) WHERE status = \'pending\'. Smaller index, faster queries for common filters.',
  'JSONB: store and query JSON documents. Has GIN indexing for fast lookups. Use for flexible schemas alongside relational tables.',
  'CTEs (Common Table Expressions): WITH clause for readable complex queries. Recursive CTEs for tree/graph traversal.',
  'Window functions: ROW_NUMBER(), RANK(), LAG(), LEAD(), SUM() OVER (PARTITION BY ...). Analytics without GROUP BY destroying rows.',
  'Database migrations: version-controlled schema changes. Always forward-compatible. Never rename columns — add new, migrate data, drop old.',
  'Transactions: BEGIN/COMMIT/ROLLBACK. Use SERIALIZABLE isolation for critical operations. Default READ COMMITTED is fine for most cases.',
  'Vacuum and autovacuum: PostgreSQL uses MVCC, dead rows accumulate. Autovacuum cleans them up. Monitor bloat in production.',

  // NoSQL
  'MongoDB: document database for flexible schemas. Good for content management, catalogs, user profiles. Not for transactional systems.',
  'Redis: in-memory key-value store. Use for caching, sessions, rate limiting, pub/sub, queues. Not a primary database.',
  'Redis data structures: strings, lists, sets, sorted sets, hashes, streams. Each has specific use cases. Sorted sets for leaderboards.',
  'Elasticsearch: full-text search engine built on Lucene. Use for search, log analysis, analytics dashboards. Not a primary database.',

  // Patterns
  'Read replicas: route read queries to replicas, writes to primary. Scales read-heavy workloads. Handle replication lag in application code.',
  'Sharding: distribute data across multiple databases by a shard key. Last resort — adds enormous complexity. Exhaust vertical scaling first.',
  'Event sourcing stores state changes as immutable events, not current state. Rebuild state by replaying events. Full audit trail.',
  'CQRS with separate read/write databases: write to normalized relational DB, project to denormalized read models. Eventual consistency.',
  'Soft deletes: add deleted_at column instead of DELETE. Preserves data for audit/recovery. Filter in queries: WHERE deleted_at IS NULL.',
  'Database per service in microservices: each service owns its data. No shared databases. Communicate via APIs or events.',
  'Materialized views: precomputed query results stored as a table. REFRESH MATERIALIZED VIEW for periodic updates. Speeds up dashboards.',
], [
  { name: 'PostgreSQL', type: 'technology', relation: 'part_of' },
  { name: 'Redis', type: 'technology', relation: 'part_of' },
  { name: 'MongoDB', type: 'technology', relation: 'part_of' },
  { name: 'Elasticsearch', type: 'technology', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// DEVOPS & INFRASTRUCTURE
// ════════════════════════════════════════════════════════════════════════

seedTopic('DevOps', 'technology', [
  // Containers
  'Docker: package application + dependencies into a portable container. Same image runs on dev laptop and production server.',
  'Dockerfile best practices: multi-stage builds (build stage + slim runtime), .dockerignore, non-root user, specific base image tags.',
  'Docker layer caching: order instructions from least to most frequently changing. COPY package.json before COPY src/ — deps cached.',
  'Docker Compose: define multi-container applications. docker compose up starts app + database + cache. Essential for local dev.',
  'Container image size matters: alpine-based images are ~5MB vs ~900MB for ubuntu. Smaller = faster deploys, less attack surface.',

  // Kubernetes
  'Kubernetes orchestrates containers at scale: scheduling, scaling, self-healing, service discovery, load balancing.',
  'Pod: smallest deployable unit, one or more containers sharing network and storage. Usually one app container per pod.',
  'Deployment: declares desired state (3 replicas of my-app:v2). Kubernetes reconciles actual state to match. Rolling updates by default.',
  'Service: stable network endpoint for a set of pods. ClusterIP (internal), LoadBalancer (external), NodePort (host port mapping).',
  'Ingress: HTTP routing rules. Route /api to backend service, / to frontend service. Nginx or Traefik as ingress controller.',
  'ConfigMap and Secret: externalize configuration. Mount as environment variables or files. Secrets are base64 encoded (not encrypted).',
  'Horizontal Pod Autoscaler (HPA): automatically scale replicas based on CPU, memory, or custom metrics. Set min and max bounds.',
  'Helm: package manager for Kubernetes. Charts are reusable templates for deploying complex applications.',

  // CI/CD
  'GitHub Actions: CI/CD workflows in YAML. Trigger on push, PR, schedule. Matrix builds for multiple OS/language versions.',
  'CI pipeline: lint → type check → unit tests → integration tests → build → security scan. Fail fast — lint before slow tests.',
  'CD pipeline: build image → push to registry → deploy to staging → run smoke tests → promote to production. Fully automated.',
  'Blue-green deployment: two identical environments. Route traffic from blue (old) to green (new). Instant rollback by switching back.',
  'Canary deployment: route 5% of traffic to the new version. Monitor error rates. Gradually increase to 100% if healthy.',
  'GitOps (ArgoCD, Flux): git repo is the source of truth for infrastructure. Push to git → automatically applied to cluster.',
  'Feature flags (LaunchDarkly, Unleash, PostHog): deploy code disabled, enable for specific users/percentages. Decouple deploy from release.',

  // Observability
  'Three pillars of observability: metrics (what happened), logs (why it happened), traces (the full request journey).',
  'Prometheus: pull-based metrics collection. Counters (total requests), gauges (current memory), histograms (latency distribution).',
  'Grafana: visualization for Prometheus metrics. Build dashboards for latency p50/p95/p99, error rate, throughput, saturation.',
  'Structured logging: JSON format with consistent fields. {"level":"error","service":"api","msg":"timeout","duration_ms":5000}.',
  'Distributed tracing (OpenTelemetry, Jaeger): follow a request across services. Each span shows where time was spent.',
  'Alerting: alert on symptoms (high error rate), not causes (high CPU). Every alert must be actionable. Reduce noise ruthlessly.',
  'SLOs (Service Level Objectives): 99.9% availability = 43 min downtime/month. Define error budgets. When budget exhausted, freeze deploys.',
  'On-call: PagerDuty or Opsgenie. Define severity levels and response times. Rotate weekly. Compensate people who carry the pager.',
], [
  { name: 'Docker', type: 'technology', relation: 'part_of' },
  { name: 'Kubernetes', type: 'technology', relation: 'part_of' },
  { name: 'GitHub Actions', type: 'technology', relation: 'part_of' },
  { name: 'Prometheus', type: 'technology', relation: 'uses' },
  { name: 'Grafana', type: 'technology', relation: 'uses' },
  { name: 'OpenTelemetry', type: 'technology', relation: 'uses' },
  { name: 'ArgoCD', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// SYSTEM DESIGN (DEEP)
// ════════════════════════════════════════════════════════════════════════

seedTopic('System Design', 'technology', [
  // Scalability
  'Vertical scaling (bigger machine) is simpler and cheaper than horizontal scaling (more machines). Scale vertically until you can\'t.',
  'Stateless services: no local state — store sessions in Redis, files in S3, cache in Redis. Any instance can handle any request.',
  'Load balancing algorithms: round-robin (simple), least connections (smart), consistent hashing (sticky sessions for caching).',
  'CDN (Content Delivery Network): serve static assets from edge locations near users. CloudFront, Cloudflare, Fastly. 50-200ms savings.',
  'Auto-scaling: scale based on CPU, memory, request queue depth, or custom metrics. Scale up fast, scale down slowly (hysteresis).',
  'Database connection pooling is often the first bottleneck. Pool size = (CPU cores * 2) + effective_spindle_count.',

  // Caching
  'Cache-aside pattern: check cache first → miss → query DB → write to cache → return. Most common pattern.',
  'Write-through: write to cache and DB simultaneously. Consistent but slower writes. Good for data that is read immediately after write.',
  'Write-behind: write to cache, asynchronously persist to DB. Fast writes but risk data loss if cache crashes before persist.',
  'Cache invalidation is the hardest problem in CS. TTL-based expiry is simplest. Event-based invalidation is most accurate.',
  'Cache stampede: many requests hit an expired key simultaneously, all query DB. Prevent with lock (only one rebuilds) or early recompute.',
  'Multi-level caching: browser cache (HTTP headers) → CDN → application cache (Redis) → database query cache. Each level reduces load.',

  // Messaging
  'Synchronous (HTTP/gRPC): caller waits for response. Simple but creates coupling. Failure cascades through the chain.',
  'Asynchronous (message queue): caller publishes message and moves on. Consumer processes later. Decoupled, resilient, scalable.',
  'Kafka: distributed event log. Ordered within partitions. Consumer groups for parallel processing. Retention for replay. High throughput.',
  'RabbitMQ: traditional message broker. Routing, dead letter queues, priority queues. Better for complex routing patterns than Kafka.',
  'SQS (AWS): managed queue service. No infrastructure to manage. FIFO queues for ordering. Dead letter queues for failed messages.',
  'Event-driven architecture: services emit events (OrderCreated, PaymentProcessed). Other services react. Loose coupling.',
  'Idempotent consumers: design message handlers to be safe if the same message is delivered twice. Use idempotency keys.',
  'Saga pattern: distributed transactions via event choreography. Each service handles its step and emits an event. Compensate on failure.',

  // Reliability
  'Circuit breaker: after N failures, stop calling the service for a cooldown. States: closed (normal) → open (failing) → half-open (testing).',
  'Retry with exponential backoff and jitter: wait 1s, 2s, 4s + random. Jitter prevents thundering herd. Set max retries.',
  'Timeout everything: HTTP calls, database queries, message processing. No operation should run indefinitely. Timeout < caller\'s timeout.',
  'Bulkhead pattern: isolate failures. Separate thread pools for different services. Failure in payment service doesn\'t crash user service.',
  'Graceful degradation: when a service is down, return cached data, show a simplified UI, or queue the operation for later.',
  'Health checks: /health endpoint returns 200 if the service and its dependencies are healthy. Load balancers use this to route traffic.',
  'Chaos engineering (Netflix Chaos Monkey): intentionally inject failures in production to find weaknesses before they find you.',
], [
  { name: 'Kafka', type: 'technology', relation: 'part_of' },
  { name: 'RabbitMQ', type: 'technology', relation: 'part_of' },
  { name: 'CDN', type: 'concept', relation: 'part_of' },
  { name: 'Circuit Breaker', type: 'concept', relation: 'part_of' },
  { name: 'Cloudflare', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// ALGORITHMS & DATA STRUCTURES
// ════════════════════════════════════════════════════════════════════════

seedTopic('Algorithms and Data Structures', 'technology', [
  // Complexity
  'Big O: O(1) hash lookup, O(log n) binary search, O(n) linear scan, O(n log n) sorting, O(n²) nested loops, O(2^n) subsets.',
  'Time complexity is how runtime grows with input size. Space complexity is how memory grows. Both matter.',
  'Amortized analysis: occasional expensive operations averaged over many cheap ones. Dynamic array append is O(1) amortized despite occasional O(n) resize.',

  // Data structures
  'Array: O(1) random access, O(n) insert/delete. Contiguous memory = cache-friendly. Default choice for ordered collections.',
  'Linked list: O(1) insert/delete at known position, O(n) access. Rarely used in practice — arrays with amortized O(1) append are better.',
  'Hash map: O(1) average lookup, insert, delete. Unordered. Handles collisions via chaining or open addressing. The most useful data structure.',
  'Binary search tree (BST): O(log n) search, insert, delete when balanced. Unbalanced degrades to O(n). Use self-balancing variants.',
  'Red-black tree and AVL tree: self-balancing BSTs. O(log n) guaranteed. Used internally by TreeMap (Java), std::map (C++), SortedDictionary (C#).',
  'Heap (priority queue): O(log n) insert and extract-min/max. O(1) peek. Used for scheduling, Dijkstra, top-K problems.',
  'Trie (prefix tree): O(m) lookup where m is key length. Used for autocomplete, spell checking, IP routing tables.',
  'Graph: nodes and edges. Adjacency list (sparse graphs) or adjacency matrix (dense graphs). Model networks, dependencies, social connections.',
  'Stack (LIFO): push/pop O(1). Used for function calls, undo operations, expression parsing, DFS.',
  'Queue (FIFO): enqueue/dequeue O(1). Used for BFS, task scheduling, message processing, breadth-first traversal.',
  'Bloom filter: probabilistic set membership. Can say "definitely not in set" or "probably in set". No false negatives. Space efficient.',

  // Algorithms
  'Binary search: O(log n) on sorted data. Cut search space in half each step. while (lo <= hi) { mid = (lo+hi)/2; ... }',
  'Two pointers: use two indices to scan from both ends. Palindrome check, sorted array pair sum, container with most water.',
  'Sliding window: maintain a window over a sequence. Expand right, shrink left. Maximum sum subarray, longest substring without repeats.',
  'BFS (Breadth-First Search): explore level by level using a queue. Finds shortest path in unweighted graphs.',
  'DFS (Depth-First Search): explore as deep as possible using recursion or stack. Used for cycle detection, topological sort, connected components.',
  'Dynamic programming: break problems into overlapping subproblems. Memoize results. Bottom-up (tabulation) or top-down (recursion + cache).',
  'Greedy algorithms: make locally optimal choices hoping for global optimum. Works for interval scheduling, Huffman coding, Kruskal\'s MST.',
  'Merge sort: O(n log n) guaranteed, stable. Divide-and-conquer. Good for linked lists and external sorting.',
  'Quick sort: O(n log n) average, O(n²) worst case. In-place. Fastest in practice due to cache locality. Use median-of-three pivot.',
  'Dijkstra\'s algorithm: shortest path from one node to all others in weighted graph. O((V+E) log V) with min-heap. Non-negative weights only.',
  'Topological sort: order nodes in a DAG so every edge goes from earlier to later. Used for build systems, task dependencies, course prerequisites.',
], [
  { name: 'Hash Map', type: 'concept', relation: 'part_of' },
  { name: 'Binary Search', type: 'concept', relation: 'part_of' },
  { name: 'Dynamic Programming', type: 'concept', relation: 'part_of' },
  { name: 'Graph Algorithms', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// GO LANGUAGE
// ════════════════════════════════════════════════════════════════════════

seedTopic('Go', 'technology', [
  'Go is a statically-typed, compiled language by Google. Built for simplicity, concurrency, and fast compilation.',
  'Goroutines: lightweight threads managed by the Go runtime. go func() starts one. Millions can run simultaneously on a few OS threads.',
  'Channels: typed conduits for communication between goroutines. ch := make(chan int). Send: ch <- 42. Receive: val := <-ch.',
  'Select statement: listen on multiple channels simultaneously. Like switch but for channels. Essential for concurrent patterns.',
  'Error handling: functions return (result, error). Check error immediately: if err != nil { return err }. No exceptions.',
  'Interfaces are implicit: any type that implements the methods satisfies the interface. No "implements" keyword. Duck typing at compile time.',
  'Structs with methods: Go has no classes. Define a struct, attach methods with receiver: func (u User) Name() string { ... }.',
  'Slices: dynamic arrays. append() grows them. Backed by arrays. Pass by reference (header). Most common collection type.',
  'Maps: hash tables. m := map[string]int{"a": 1}. Not concurrent-safe — use sync.Map or mutex for concurrent access.',
  'defer: schedule function call to run when the enclosing function returns. Used for cleanup: defer file.Close().',
  'Context: carries deadlines, cancellation signals, and values across API boundaries. ctx context.Context is the first parameter convention.',
  'Go modules: dependency management. go.mod defines module path and dependencies. go get adds packages. go mod tidy cleans unused.',
  'Standard library is exceptional: net/http for HTTP servers, encoding/json for JSON, database/sql for DB, testing for tests. Minimal dependencies needed.',
  'Go produces a single static binary. No runtime dependencies. Copy the binary to any compatible machine and it runs. Perfect for containers.',
  'Table-driven tests: define test cases as a slice of structs, loop through them. Idiomatic Go testing pattern.',
  'Go fmt: canonical formatting. Everyone writes the same style. No debates. Run automatically on save.',
], [
  { name: 'Goroutines', type: 'concept', relation: 'part_of' },
  { name: 'Channels', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// RUST
// ════════════════════════════════════════════════════════════════════════

seedTopic('Rust', 'technology', [
  'Rust is a systems language with memory safety guaranteed at compile time. No garbage collector. Zero-cost abstractions.',
  'Ownership: every value has exactly one owner. When the owner goes out of scope, the value is dropped (freed). No double-free, no leaks.',
  'Borrowing: references (&T for shared, &mut T for exclusive) let you access data without taking ownership. Compiler enforces rules at compile time.',
  'The borrow checker ensures: at any time, either one mutable reference OR any number of shared references. Never both. Prevents data races.',
  'Lifetimes annotate how long references are valid: fn longest<\'a>(x: &\'a str, y: &\'a str) -> &\'a str. Compiler infers most lifetimes.',
  'Pattern matching with match is exhaustive — compiler ensures all cases are handled. Combined with enums, eliminates null pointer errors.',
  'Result<T, E> for recoverable errors, panic! for unrecoverable bugs. The ? operator propagates errors: let data = file.read()?;',
  'Option<T>: Some(value) or None. Replaces null. Must handle the None case explicitly. No null pointer exceptions possible.',
  'Traits: like interfaces but can have default implementations. impl Display for MyType { ... }. Trait bounds constrain generics.',
  'Enums with data: enum Shape { Circle(f64), Rectangle(f64, f64) }. Algebraic data types. match on them for exhaustive handling.',
  'Cargo: build system, package manager, and test runner. cargo build, cargo test, cargo run. Crates.io for packages.',
  'Zero-cost abstractions: iterators, closures, generics compile to the same code you\'d write by hand. High-level code, low-level performance.',
  'async/await in Rust: futures are lazy (don\'t execute until polled). Tokio is the standard async runtime. Use for network services.',
  'Unsafe: escape hatch for raw pointers, FFI, and manual memory management. Contained in unsafe {} blocks. Minimize and audit.',
  'Clippy: official linter. cargo clippy catches common mistakes and suggests idiomatic patterns. Run in CI.',
], [
  { name: 'Ownership', type: 'concept', relation: 'part_of' },
  { name: 'Borrow Checker', type: 'concept', relation: 'part_of' },
  { name: 'Cargo', type: 'technology', relation: 'uses' },
  { name: 'Tokio', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// WEB PERFORMANCE
// ════════════════════════════════════════════════════════════════════════

seedTopic('Web Performance', 'technology', [
  'Core Web Vitals: LCP (Largest Contentful Paint < 2.5s), INP (Interaction to Next Paint < 200ms), CLS (Cumulative Layout Shift < 0.1).',
  'LCP optimization: preload hero image, use next/image, inline critical CSS, server-side render above-the-fold content.',
  'INP optimization: keep JavaScript execution under 50ms per task. Break long tasks with setTimeout or requestIdleCallback.',
  'CLS optimization: set explicit width/height on images and videos. Reserve space for dynamic content. Use font-display: swap.',
  'Code splitting: only load JavaScript needed for the current page. Dynamic import() for below-the-fold components.',
  'Tree shaking: bundler eliminates unused exports. Use ES modules (import/export). Avoid side-effect-heavy modules.',
  'Image optimization: use WebP/AVIF (30-50% smaller than JPEG). Responsive images with srcset. Lazy load below-the-fold images.',
  'Font optimization: subset fonts to only needed characters. Use font-display: swap. Preload critical fonts with <link rel="preload">.',
  'HTTP/2 multiplexing: multiple requests over single connection. No need to bundle all CSS/JS into one file anymore.',
  'Compression: Brotli (br) is 15-25% smaller than gzip. Configure server to serve br for supported browsers, gzip as fallback.',
  'Service workers: cache static assets for offline access. Cache-first strategy for assets, network-first for API calls.',
  'Prefetch and preconnect: <link rel="preconnect" href="https://api.example.com"> for known third-party origins. dns-prefetch for less critical.',
  'Edge computing (Cloudflare Workers, Vercel Edge): run server logic at CDN edge locations. Sub-50ms response times globally.',
  'Bundle analysis: use @next/bundle-analyzer or webpack-bundle-analyzer to find what\'s making your bundle large. Lodash is usually the culprit.',
  'Performance budget: set limits (200KB JS, LCP < 2s). Fail CI build if exceeded. What gets measured gets managed.',
], [
  { name: 'Core Web Vitals', type: 'concept', relation: 'part_of' },
  { name: 'Service Workers', type: 'concept', relation: 'part_of' },
  { name: 'Cloudflare Workers', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// DONE
// ════════════════════════════════════════════════════════════════════════

console.log('\n✅ Knowledge seeding v3 complete!')
console.log('Topics: Neural Networks, LLMs, AI Dev, Databases, DevOps, System Design, Algorithms, Go, Rust, Web Performance')
