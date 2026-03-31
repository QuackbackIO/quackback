import type { WebhookId, PrincipalId } from '@quackback/ids'

export interface Webhook {
  id: WebhookId
  url: string
  events: string[]
  boardIds: string[] | null
  status: 'active' | 'disabled'
  failureCount: number
  lastError: string | null
  lastTriggeredAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: PrincipalId
}

export interface CreateWebhookInput {
  url: string
  events: string[]
  boardIds?: string[]
}

export interface CreateWebhookResult {
  webhook: Webhook
  /** The signing secret - only returned on creation, never stored in plain text retrieval */
  secret: string
}

export interface UpdateWebhookInput {
  url?: string
  events?: string[]
  boardIds?: string[] | null
  status?: 'active' | 'disabled'
}
