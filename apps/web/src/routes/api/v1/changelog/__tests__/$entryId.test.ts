import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockGetChangelogById = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  getChangelogById: (...args: unknown[]) => mockGetChangelogById(...args),
  updateChangelog: vi.fn(),
  deleteChangelog: vi.fn(),
}))

// markdown-tiptap is intentionally NOT mocked — the point of these tests is the
// real contentJson -> markdown serialization, including image nodes.

import { Route } from '../$entryId'

type RouteOpts = {
  server: { handlers: { GET: (...args: unknown[]) => Promise<Response> } }
}
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const ENTRY_ID = 'changelog_01h455vb4pex5vsknk084sn02q' as unknown as ChangelogId

function baseEntry() {
  return {
    id: ENTRY_ID,
    title: 'Dark mode',
    content: 'We shipped dark mode.',
    contentJson: null as unknown,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    displayDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('GET /api/v1/changelog/:entryId — markdown image output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_x', role: 'team' })
  })

  it('renders images from contentJson as markdown that the stored content dropped', async () => {
    mockGetChangelogById.mockResolvedValue({
      ...baseEntry(),
      // Stored markdown column lost the image (client serializer has no spec
      // for the image node); contentJson is the source of truth.
      content: 'We shipped dark mode.',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'We shipped dark mode.' }] },
          {
            type: 'image',
            attrs: { src: 'https://cdn.example.com/dark.png', alt: 'Dark mode', title: null },
          },
        ],
      },
    })

    const res = await GET({ request: new Request('http://t/'), params: { entryId: ENTRY_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.content).toContain('We shipped dark mode.')
    expect(json.data.content).toContain('![Dark mode](https://cdn.example.com/dark.png)')
  })

  it('falls back to the stored content for legacy rows without contentJson', async () => {
    mockGetChangelogById.mockResolvedValue({
      ...baseEntry(),
      content: '# Legacy entry\n\nPlain text.',
      contentJson: null,
    })

    const res = await GET({ request: new Request('http://t/'), params: { entryId: ENTRY_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.content).toBe('# Legacy entry\n\nPlain text.')
  })
})
