# Live Chat AI Layer — Design

Status: **design only (not implemented)**. This document plans the AI layer for
widget live chat: an agent **copilot** (reply suggestions + conversation
summaries) and a customer-facing **resolution agent** (KB-grounded answers with
human handoff). It builds entirely on infrastructure that already exists in the
repo, and is gated behind feature flags (default off), so it can ship
incrementally without touching the working non-AI chat.

## 1. Goals & non-goals

- **Copilot (phase 1)** — agent-facing, low risk. The human stays in control:
  AI drafts a reply or summarizes the thread; the agent edits and sends.
- **Resolution agent (phase 2)** — customer-facing. Answers common questions
  from the help center / feedback posts before a human is involved, and hands
  off cleanly when it can't help or the visitor asks for a person.
- **Non-goals:** autonomous actions in external systems (refunds, account
  changes), voice/vision, multi-step "agentic" tool use. Those are explicitly
  out of scope for v1 and called out in §11.

## 2. Reuse — what already exists

No new AI vendor integration is required; the chat AI features compose existing
modules:

| Capability               | Existing module                                                                                                         | Use in chat AI                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| LLM client               | `domains/ai/config.ts` → `getOpenAI()` (+ `stripCodeFences`)                                                            | chat completions for suggestions / answers          |
| Retry/backoff            | `domains/ai/retry.ts` → `withRetry`                                                                                     | wrap every model call                               |
| Cost + budget            | `domains/ai/usage-log.ts`, `usage-counter.ts`; `settings/tier-enforce.ts` → `enforceAiTokenBudget`, `assertTierFeature` | meter tokens, gate by plan, cap spend               |
| KB retrieval (RAG)       | `domains/help-center/help-center-search.service.ts` → `hybridSearch(query, limit)`                                      | ground answers/suggestions in published articles    |
| Embeddings               | `domains/embeddings/embedding.service.ts` → `generateEmbedding`                                                         | optional: retrieve similar past conversations/posts |
| Summarization precedent  | `domains/summary/summary.service.ts` (`openai.chat.completions.create({ model: SUMMARY_MODEL })`)                       | mirror for conversation summary                     |
| Classification precedent | `domains/sentiment/sentiment.service.ts`                                                                                | mirror for intent/confidence scoring                |
| Real-time delivery       | `realtime/chat-channels.ts` (`publishChatEvent`) + the SSE route                                                        | stream AI output to clients                         |
| Background work          | BullMQ queue (`events/process.ts`, `domains/*/queues/*`)                                                                | run resolution-agent answers off the request path   |
| Chat domain              | `domains/chat/{chat.service,chat.query,chat.convert}.ts`, `policy/chat.ts`                                              | send AI messages, read transcript, gate access      |

## 3. Architecture

```
Visitor message ──► sendVisitorMessage (existing)
                      │
                      ├─(resolution agent on)─► enqueue AI-answer job (BullMQ)
                      │        │
                      │        ├─ retrieve: hybridSearch(KB) + recent posts
                      │        ├─ LLM: answer + confidence + needsHuman
                      │        ├─ if confident → sendAiMessage(conversation)  ──► SSE
                      │        └─ else → mark needs-human, notify agents (existing)
                      │
Agent opens thread ──► copilot (on demand)
                      ├─ "Summarize" → LLM(transcript) → ephemeral panel
                      └─ "Suggest reply" → retrieve KB + transcript → LLM draft
                                          → prefilled composer (agent edits/sends)
```

### 3a. Agent copilot (phase 1)

Two on-demand, agent-initiated actions in the admin thread (`routes/admin/chat.tsx`):

- **Summarize conversation** — `summarizeConversationFn(conversationId)`
  (team-gated). Loads the transcript via `listMessages`, calls the LLM (mirror
  `summary.service`), returns a short summary. Rendered in a collapsible panel
  in the thread header / visitor sidebar. Ephemeral (not persisted) for v1; can
  be cached on the conversation row later.
- **Suggest reply** — `suggestReplyFn(conversationId)` (team-gated). Retrieves
  relevant KB passages (`hybridSearch` on the latest visitor message) + the
  recent transcript, prompts the LLM for a draft grounded in those passages,
  and returns `{ draft, citations }`. The agent clicks "Use" → the draft fills
  the existing composer (`setReply`), which they edit before sending. **The AI
  never sends on the agent's behalf in phase 1.**

Both are request/response server functions (no new persistence). Streaming is a
nice-to-have (token-by-token via SSE) but not required for phase 1.

### 3b. Resolution agent (phase 2)

A customer-facing first responder. When enabled and triggered, it answers from
the KB before a human engages.

- **Trigger.** Configurable per workspace (see §6): `always` (answer every new
  visitor message until handoff) or `offline-only` (only when no agent is
  online — reuses `isAnyAgentOnline()` from `realtime/presence.ts`). The trigger
  fires inside `sendVisitorMessage`'s post-commit hook (alongside the existing
  `notifyVisitorMessage`), enqueueing a BullMQ job so the visitor's send latency
  is unaffected.
- **Answer pipeline (BullMQ worker).**
  1. Retrieve: `hybridSearch(latestVisitorMessage, 5)` over published articles
     (+ optionally top similar posts via `generateEmbedding`).
  2. Prompt the LLM with: system prompt (persona, "only answer from the
     provided sources, otherwise say you'll get a human"), the retrieved
     passages, and the recent transcript.
  3. Parse a structured result `{ answer, confidence: 0..1, needsHuman: bool,
citedArticleSlugs: string[] }` (JSON, `stripCodeFences`).
  4. If `confidence ≥ threshold` and `!needsHuman`: persist an AI message
     (`senderType:'agent'`, `aiGenerated:true`) via a new
     `sendAiMessage(conversationId, answer, { citations })`, which publishes the
     `message` event (visitor sees it live). Optionally append article links.
  5. Else: leave the conversation for a human, set `conversation.aiHandled` →
     `'escalated'`, and fire the existing agent notification (`notifyVisitorMessage`).
- **Handoff & escape hatches.** Always render a "Talk to a human" affordance in
  the widget. A visitor message matching escalation intents (or any message
  after N AI turns) forces `needsHuman`. An agent replying at any time
  permanently disables the bot for that conversation (`aiHandled:'human'`).

## 4. Data model changes

Minimal, additive (one migration):

- `chat_messages.ai_generated boolean default false` — distinguishes AI-authored
  agent messages for rendering (an "AI" badge) and analytics. AI messages still
  use `senderType:'agent'` with a dedicated AI principal (a `service` principal,
  e.g. display name "AI Assistant") so attribution + the existing `restrict` FK
  hold without policy changes.
- `conversations.ai_handled text` — `null` | `'bot'` | `'escalated'` | `'human'`
  — drives the trigger logic and reporting (deflection rate).
- Optional later: `conversations.ai_summary text` + `ai_summary_at` to cache the
  copilot summary.

`ChatMessageDTO` gains `aiGenerated: boolean`; the stream `message` event already
carries the full DTO, so clients render the AI badge with no protocol change.
Copilot phase 1 needs **no** schema changes.

## 5. LLM integration

- Use `getOpenAI()` (returns `null` when unconfigured → AI features degrade to
  off, never throw). Wrap calls in `withRetry`.
- Models: a dedicated `CHAT_AI_MODEL` constant (mirroring `SUMMARY_MODEL`), with
  the cheap/fast tier for suggestions and a stronger tier for the resolution
  agent — configurable.
- Cost: log every call through `usage-log.ts`; enforce `enforceAiTokenBudget`
  before each call so a workspace can't exceed their AI budget. Gate the whole
  feature with `assertTierFeature('liveChatAi')` (a new `TierFeatureFlags` key)
  for cloud/plan gating, in addition to the per-workspace feature flag.

## 6. Settings & flags

- **Feature flags** (`FeatureFlags`, default off): `liveChatCopilot`,
  `liveChatAiAgent` — separate so copilot can ship before the customer-facing
  agent. Surfaced in Labs like `liveChat`.
- **`LiveChatConfig` additions** (agent-only, not in the public projection
  except where the widget needs it):
  - `ai?: { copilotEnabled; agentEnabled; trigger: 'always' | 'offline-only';
confidenceThreshold; persona?; maxBotTurns; knowledgeSources: ('articles' |
'posts')[] }`.
  - The widget only needs to know "an AI may respond" to show an AI badge / the
    "Talk to a human" button — project just that boolean.

## 7. Prompt design (sketch)

- **System (resolution agent):** role + tone (from `persona`), strict grounding
  ("Answer ONLY using the numbered sources below. If they don't contain the
  answer, set needsHuman=true and don't guess."), output contract (JSON).
- **Context:** retrieved KB passages (numbered, with slugs for citation) + last
  N transcript turns. Cap context tokens to control cost.
- **Citations:** require the model to return `citedArticleSlugs`; the widget
  renders them as the existing article links (reuse the deflection UI).
- **Copilot suggest-reply** is the same retrieval + a "draft a reply the agent
  can edit" instruction; returns prose, not JSON.

## 8. Safety & guardrails

- **Prompt injection:** visitor messages are untrusted input. Keep them in a
  clearly delimited user block; never let retrieved/visitor text alter the
  system instruction; the model only ever produces a chat message or a JSON
  verdict — it has no tools/actions in v1, so injection can't trigger side
  effects.
- **No fabricated commitments:** grounding + low-confidence → handoff. Surface
  citations so answers are auditable.
- **PII / data:** the transcript already lives in our DB; we send only the
  minimal recent window to the LLM. Respect the existing AI provider config; if
  unconfigured, no data leaves.
- **Abuse / cost:** per-conversation max bot turns; `enforceAiTokenBudget`;
  reuse the chat rate-limit follow-up (see project memory) so a visitor can't
  drive unbounded LLM spend.
- **Always-available human path:** the "Talk to a human" control is never gated.

## 9. Real-time UX

- AI messages flow through the existing `message` stream event → both the widget
  and the agent inbox render them live, with an "AI" badge (`aiGenerated`).
- Show the existing typing indicator while the bot is "thinking" (publish a
  `typing` event with `side:'agent'` from the worker).
- Copilot suggestions stream into a panel (optional); the summary renders in the
  thread sidebar.

## 10. Rollout plan (phased, flagged, default off)

1. **Copilot summary** — lowest risk, no schema, no customer exposure.
2. **Copilot suggest-reply** — agent edits before sending.
3. **AI agent (suggest-only)** — bot drafts an answer but posts it as a
   _copilot suggestion_ to the agent, not to the visitor (shadow mode to
   measure quality).
4. **AI agent (autonomous, offline-only)** — bot answers directly when no agent
   is online, with handoff. Measure deflection + CSAT.
5. **AI agent (always-on)** — first responder, opt-in per workspace.

Each phase is independently shippable behind its flag and measurable
(deflection rate via `ai_handled`, CSAT delta, token cost via usage logs).

## 11. Open questions / risks

- **AI principal identity:** create one `service` principal per workspace for AI
  authorship vs. a global sentinel — affects display + the anon-merge path.
- **Knowledge freshness:** `hybridSearch` only sees published articles; decide
  whether to also index resolved conversations/posts.
- **Streaming over SSE:** worth the complexity for the resolution agent, or is a
  single message after a "typing" delay enough? (Start without streaming.)
- **Eval harness:** before autonomous mode, a test set of representative
  questions + expected handoff behavior, mirroring the AI test dirs under
  `domains/{summary,sentiment}/__tests__`.
- **Tier gating:** confirm whether AI chat is OSS-available (BYOK, like the rest
  of the AI features) or a paid entitlement; wire `assertTierFeature`
  accordingly.

## 12. Estimated surface (when implemented)

New: `domains/chat/chat.ai.ts` (copilot + agent pipeline), a BullMQ
`chat-ai-queue`, `sendAiMessage` in `chat.service.ts`, 2-4 server functions,
one migration (`ai_generated`, `ai_handled`), flag + `LiveChatConfig.ai`
settings, an "AI" badge + "Talk to a human" affordance in the widget, and a
"Summarize / Suggest reply" affordance in the admin thread. All composing the
modules in §2 — no new infrastructure.
