import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Channel } from '@/lib/shared/channels'
import type { JSONContent } from '@tiptap/core'

export type LifecycleKind = 'closed' | 'auto_closed'

export interface AgentMessageDeliveryCtx {
  conversationId: ConversationId
  visitorPrincipalId: PrincipalId
  content: string
  contentJson?: JSONContent | null
  agentName: string
  recipient: string
  ctaUrl: string
  workspaceName: string
  logoUrl: string | null
  direction: 'agent_reply' | 'agent_started'
}

export interface CsatDeliveryCtx {
  conversationId: ConversationId
  visitorPrincipalId: PrincipalId
  recipient: string
  promptText: string
  ratingUrls: [string, string, string, string, string]
  workspaceName: string
  logoUrl: string | null
  from?: string
}

export interface LifecycleDeliveryCtx {
  conversationId: ConversationId
  closerPrincipalId?: PrincipalId | null
}

export interface ChannelAdapter {
  id: Channel
  deliverAgentMessage(ctx: AgentMessageDeliveryCtx): Promise<void>
  deliverLifecycleEvent(kind: LifecycleKind, ctx: LifecycleDeliveryCtx): Promise<void>
  deliverCsatRequest(ctx: CsatDeliveryCtx): Promise<void>
}
