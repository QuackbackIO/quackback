import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ access: true, helpCenter: true }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (route: unknown) => route }))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: async () => ({ granted: state.access }),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async (feature: string) => feature === 'helpCenter' && state.helpCenter,
}))
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantSettings: async () => ({
    config: { agents: { agent: { knowledge: { articles: true, posts: true } } } },
  }),
}))
vi.mock('@/lib/server/widget/public-endpoint', () => ({ enforcePerIpLimit: async () => null }))
vi.mock('@/lib/server/domains/assistant/public-source', () => ({
  getCustomerCitationSource: async (
    type: string,
    id: string,
    knowledge: { articles: boolean; posts: boolean }
  ) =>
    ['post', 'article'].includes(type) && id === 'source_1' && knowledge.articles && knowledge.posts
      ? { title: `${type} title`, content: 'Private portal text' }
      : null,
}))
import { handleQuinnSource } from '../quinn-source'
const read = (type: string) =>
  handleQuinnSource({
    request: new Request(`https://workspace.test/api/widget/quinn-source?type=${type}&id=source_1`),
  })
beforeEach(() => {
  state.access = true
  state.helpCenter = true
})

it.each(['post', 'article'])(
  'refuses the private portal %s even when the source is public within that portal',
  async (type) => {
    state.access = false
    const response = await read(type)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('Private portal text')
  }
)
it('refuses article text when Help Center is disabled', async () => {
  state.helpCenter = false
  expect((await read('article')).status).toBe(404)
  expect((await read('post')).status).toBe(200)
})
it.each(['post', 'article'])('serves an authorized %s with no-store headers', async (type) => {
  const response = await read(type)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe(`${type} title\n\nPrivate portal text`)
  expect(response.headers.get('cache-control')).toBe('no-store')
})
