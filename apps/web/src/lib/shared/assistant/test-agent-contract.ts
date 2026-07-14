/**
 * Test agent V2's client-safe request and SSE contract. The payloads are an
 * explicit allowlist: hidden prompts, instruction bodies, reasoning, tool
 * arguments, and tool results must never cross this boundary.
 */
import type { AssistantResponseLength, AssistantTone } from './config'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

export const ASSISTANT_TEST_EVENTS = {
  activity: 'assistant-test.v2.activity',
  delta: 'assistant-test.v2.delta',
  final: 'assistant-test.v2.final',
  error: 'assistant-test.v2.error',
} as const

/** Matches the production conversation window and per-message model boundary. */
export const ASSISTANT_TEST_MAX_MESSAGES = 40
export const ASSISTANT_TEST_MAX_CONTENT_CHARS = 4_000

export const ASSISTANT_TEST_CHANNELS = ['widget', 'email'] as const
export type AssistantTestChannel = (typeof ASSISTANT_TEST_CHANNELS)[number]

export interface AssistantTestMessage {
  sender: 'customer' | 'assistant'
  content: string
}

export interface AssistantTestRequest {
  messages: AssistantTestMessage[]
  channel?: AssistantTestChannel
}

export interface AssistantTestCitation {
  // Mirrors ASSISTANT_CITATION_TYPES (citation-types.ts); a client-safe copy so
  // this shared contract never imports the server domain leaf.
  type: 'article' | 'post' | 'snippet' | 'summary' | 'ticket' | 'changelog'
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
  role: 'customer_support'
  tone: AssistantTone
  responseLength: AssistantResponseLength
  appliedGuidance: Array<{ id: string; name: string }>
  toolCalls: Array<{
    name: string
    outcome: 'read' | 'simulated' | 'proposed' | 'executed' | 'failed'
  }>
}

export interface AssistantTestActivityPayload {
  status: AssistantActivityStatus
}

export interface AssistantTestDeltaPayload {
  text: string
}

export interface AssistantTestFinalPayload {
  text: string
  citations: AssistantTestCitation[]
  escalation?: AssistantTestEscalation | null
  trace: AssistantTestTrace
}

export interface AssistantTestErrorPayload {
  code: string
  message: string
}
