/**
 * Merge notification recipients for a chat event, deduped by principal. The
 * broad team is rate-limited (only pinged on the first message or when no agent
 * is online); watchers opted into the conversation so they're always included.
 * Union + dedupe by principalId so nobody is notified twice.
 */
export interface ChatRecipient {
  principalId: string
  email: string | null
  name?: string | null
}

export function mergeChatRecipients(
  team: ChatRecipient[],
  watchers: ChatRecipient[]
): ChatRecipient[] {
  const byId = new Map<string, ChatRecipient>()
  for (const r of [...team, ...watchers]) {
    if (!byId.has(r.principalId)) byId.set(r.principalId, r)
  }
  return [...byId.values()]
}
