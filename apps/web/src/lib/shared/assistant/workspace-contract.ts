import type { CopilotProposedAction } from './copilot-contract'
import type { JsonValue } from '@/lib/shared/json'

export interface WorkspaceNavigationCard {
  href: string
  label: string
  messageId?: string
}
export interface WorkspaceCopilotFinalPayload {
  threadKey: string
  messageId: string
  text: string
  citations: JsonValue[]
  proposedActions: CopilotProposedAction[]
  navigation: WorkspaceNavigationCard[]
}
export interface WorkspaceCopilotMessage {
  id: string
  sender: 'customer' | 'assistant'
  text: string
  createdAt: string
  payload?: WorkspaceCopilotFinalPayload
}
export interface WorkspaceCopilotThreadSummary {
  key: string
  title: string
  updatedAt: string
}
export interface WorkspaceCopilotThread extends WorkspaceCopilotThreadSummary {
  messages: WorkspaceCopilotMessage[]
}
export interface WorkspaceCopilotAvailability {
  enabled: boolean
  /** Whether this period's AI allowance lets Copilot answer; absent means available. */
  credits?: import('@/lib/shared/billing/ai-credits').AiCreditsState
  /** When a used-up allowance comes back. */
  resetsAt?: string | null
}
