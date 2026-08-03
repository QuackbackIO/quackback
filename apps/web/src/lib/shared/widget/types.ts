// ---- Metadata ----

/** Key-value string pairs attached to a widget session. Stored on posts created via the widget. */
export type WidgetMetadata = Record<string, string>

// ---- SDK Event Payloads ----

export interface WidgetEventMap {
  ready: Record<string, never>
  open: Record<string, never>
  close: Record<string, never>
  'post:created': {
    id: string
    title: string
    board: { id: string; name: string; slug: string }
    statusId: string | null
  }
  vote: {
    postId: string
    voted: boolean
    voteCount: number
  }
  'comment:created': {
    postId: string
    commentId: string
    parentId: string | null
  }
  identify: {
    success: boolean
    user: { id: string; name: string; email: string } | null
    anonymous: boolean
    error?: string
  }
  'ticket:created': {
    id: string
    subject: string
    statusId: string
    statusCategory: 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
  }
  'ticket:replied': {
    ticketId: string
    threadId: string
  }
  'ticket:resolved': {
    ticketId: string
    statusId: string
    alreadyResolved: boolean
  }
  /** Fires when the user reopens one of their previously-solved tickets. */
  'ticket:reopened': {
    ticketId: string
    statusId: string
    /** True when the ticket was already in an open category; no transition occurred. */
    alreadyOpen: boolean
  }
  /** Fires when the widget ticket description is updated in-place. */
  'ticket:description_updated': {
    ticketId: string
    updatedAt: string
  }
}

export type WidgetEventName = keyof WidgetEventMap

// ---- SDK -> Iframe Messages ----

export interface WidgetInboundMessages {
  'quackback:identify': { anonymous: true } | Record<string, unknown> | null
  'quackback:metadata': WidgetMetadata
  'quackback:locale': string
  'quackback:open':
    | {
        view?: 'home' | 'new-post' | 'support'
        title?: string
        board?: string
        ticketId?: string
      }
    | undefined
}

// ---- Iframe -> SDK Messages ----

export interface WidgetOutboundMessages {
  'quackback:ready': Record<string, never>
  'quackback:close': Record<string, never>
  'quackback:navigate': { url: string }
  'quackback:identify-result': {
    success: boolean
    user: { id: string; name: string; email: string; avatarUrl: string | null } | null
    error?: string
  }
  'quackback:auth-change': {
    user: { id: string; name: string; email: string; avatarUrl: string | null } | null
  }
  'quackback:event': {
    name: WidgetEventName
    payload: WidgetEventMap[WidgetEventName]
  }
}
