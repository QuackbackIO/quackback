/**
 * Test agent V2's client-safe request and payload contract. The wire is
 * TanStack AI's AG-UI protocol (the final payload rides the terminal
 * RUN_FINISHED's standard `result` slot); this module carries the payload
 * SHAPES only. The payloads are an explicit allowlist: hidden prompts,
 * instruction bodies, reasoning, tool arguments, and tool results must never
 * cross this boundary.
 */
import type { AssistantResponseLength, AssistantTone } from './config'

/** Matches the production conversation window and per-message model boundary. */
export const ASSISTANT_TEST_MAX_MESSAGES = 40
export const ASSISTANT_TEST_MAX_CONTENT_CHARS = 4_000

export const ASSISTANT_TEST_CHANNELS = ['widget', 'email'] as const
export type AssistantTestChannel = (typeof ASSISTANT_TEST_CHANNELS)[number]

// Which peer agent a test turn exercises. `agent` runs the customer-facing
// `customer_support` role on the chosen channel; `copilot` runs the
// teammate-facing `copilot_qa` role on the `copilot` surface.
export const ASSISTANT_TEST_AGENTS = ['agent', 'copilot'] as const
export type AssistantTestAgent = (typeof ASSISTANT_TEST_AGENTS)[number]

export interface AssistantTestMessage {
  sender: 'customer' | 'assistant'
  content: string
}

export interface AssistantTestRequest {
  messages: AssistantTestMessage[]
  channel?: AssistantTestChannel
  agent?: AssistantTestAgent
}

export interface AssistantTestCitation {
  // Mirrors ASSISTANT_CITATION_TYPES (citation-types.ts); a client-safe copy so
  // this shared contract never imports the server domain leaf.
  type: 'article' | 'post' | 'snippet' | 'summary' | 'ticket' | 'changelog' | 'document' | 'webpage'
  id: string
  title: string
  url: string
}

export interface AssistantTestEscalation {
  reason: string
  mode: 'handoff'
}

export interface AssistantTestTrace {
  promptVersion: string
  configRevision: number
  // Copilot answers are working notes with no tone/length presets (D11), so
  // those two fields are present only for the customer-facing `customer_support`
  // role.
  role: 'customer_support' | 'copilot_qa'
  tone?: AssistantTone
  responseLength?: AssistantResponseLength
  appliedGuidance: Array<{ id: string; name: string }>
  toolCalls: Array<{
    name: string
    outcome: 'read' | 'simulated' | 'proposed' | 'executed' | 'failed'
  }>
}

export interface AssistantTestFinalPayload {
  text: string
  citations: AssistantTestCitation[]
  escalation?: AssistantTestEscalation | null
  trace: AssistantTestTrace
}
