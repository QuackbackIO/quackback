import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listGitLabProjects } from '@/integrations/gitlab/server/projects'

function mockFetch(status: number, body: unknown = []) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('listGitLabProjects', () => {
  const projects = [{ id: 7, name_with_namespace: 'Acme / Widgets' }]

  it('lists projects from gitlab.com by default', async () => {
    const fetchMock = mockFetch(200, projects)
    vi.stubGlobal('fetch', fetchMock)

    const result = await listGitLabProjects('tok')

    expect(result).toEqual([{ id: '7', name: 'Acme / Widgets' }])
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/gitlab\.com\/api\/v4\/projects/)
  })

  it('lists projects from a custom HTTPS instance', async () => {
    const fetchMock = mockFetch(200, projects)
    vi.stubGlobal('fetch', fetchMock)

    await listGitLabProjects('tok', 'https://gitlab.example.com/')

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/gitlab\.example\.com\/api\/v4\/projects/
    )
  })
})
