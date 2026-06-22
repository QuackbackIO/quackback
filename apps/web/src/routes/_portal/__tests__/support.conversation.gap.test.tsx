// @vitest-environment happy-dom
/**
 * Differential-coverage test for the portal support thread route beforeLoad —
 * the support-surface access gate (redirect when denied, pass when granted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
  redirect: (opts: unknown) => Object.assign(new Error('redirect'), { redirect: opts }),
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useRouteContext: () => ({}),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({}), useQueryClient: () => ({}) }))
vi.mock('react-intl', () => ({
  FormattedMessage: () => null,
  useIntl: () => ({ formatMessage: () => '' }),
}))
vi.mock('@heroicons/react/24/outline', () => ({ ChatBubbleLeftRightIcon: () => null }))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/components/ui/back-link', () => ({ BackLink: () => null }))
vi.mock('@/components/shared/empty-state', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/chat/visitor-chat-thread', () => ({ VisitorChatThread: () => null }))
vi.mock('@/components/auth/auth-popover-context', () => ({ useAuthPopoverSafe: () => null }))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalImageUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/server/functions/chat', () => ({
  getChatPresenceFn: vi.fn(),
  getSupportSurfaceAccessFn: m.access,
}))
vi.mock('@/lib/shared/chat/presence', () => ({ CHAT_PRESENCE_POLL_MS: 1000 }))
vi.mock('@/lib/client/queries/portal-support', () => ({
  PORTAL_CHAT_PRESENCE_QUERY_KEY: ['p'],
  PORTAL_MY_CONVERSATIONS_QUERY_KEY: ['c'],
}))

const { Route } = await import('../support.$conversationId')
const beforeLoad = (Route as unknown as { options: { beforeLoad: () => Promise<void> } }).options
  .beforeLoad

beforeEach(() => vi.clearAllMocks())

describe('support thread beforeLoad', () => {
  it('redirects when support-surface access is denied', async () => {
    m.access.mockResolvedValueOnce({ granted: false })
    await expect(beforeLoad()).rejects.toThrow('redirect')
  })
  it('passes when access is granted', async () => {
    m.access.mockResolvedValueOnce({ granted: true })
    await expect(beforeLoad()).resolves.toBeUndefined()
  })
})
