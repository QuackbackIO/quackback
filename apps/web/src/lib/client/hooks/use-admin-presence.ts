import { useConversationStream } from './use-conversation-stream'

/**
 * Keep a team member marked "online" for chat routing on ANY admin page (not
 * just the Conversations inbox), via a presence-only SSE that carries no chat
 * events. The agent stays online for the whole admin session; offline re-queue
 * only fires when they leave the admin entirely. Pass enabled=false to skip it
 * (public routes, or when the support inbox feature is off).
 */
export function useAdminPresence(enabled: boolean): void {
  useConversationStream({
    enabled,
    buildUrl: async () => '/api/chat/stream?scope=presence',
    onEvent: () => {},
  })
}
