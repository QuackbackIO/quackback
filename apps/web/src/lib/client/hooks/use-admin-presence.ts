import { useConversationStream } from './use-conversation-stream'

/**
 * Keep a team member marked "online" for conversation routing on ANY admin page (not
 * just the Conversations inbox), via a presence-only SSE that carries no conversation
 * events. The agent stays online for the whole admin session; offline re-queue
 * only fires when they leave the admin entirely. Pass enabled=false to skip it
 * (public routes, or when the support inbox feature is off).
 */
export function useAdminPresence(enabled: boolean): void {
  // An automated browser (navigator.webdriver — Playwright/Selenium/etc.) must
  // not mark the agent online: a headless health check or e2e run holding an
  // admin session would otherwise flip presence and pull conversation routing
  // toward a bot. It also means the app-wide SSE doesn't pin the network open
  // under test runners (Playwright's networkidle would never settle).
  const automated = typeof navigator !== 'undefined' && navigator.webdriver === true
  useConversationStream({
    enabled: enabled && !automated,
    buildUrl: async () => '/api/chat/stream?scope=presence',
    onEvent: () => {},
  })
}
