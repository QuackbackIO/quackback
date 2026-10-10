import { describe, it, expect, vi } from 'vitest'

const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn(async () => new Response('{}')) }))
vi.mock('@/lib/server/content/ssrf-guard', () => ({ safeFetch }))

import {
  gitlabFetch,
  GITLAB_MAX_RESPONSE_BYTES,
  GITLAB_REQUEST_TIMEOUT_MS,
} from '@/integrations/gitlab/server/fetch'

describe('gitlabFetch', () => {
  it('pins every request through the SSRF guard with GitLab-sized limits', async () => {
    await gitlabFetch('https://gitlab.example.com/api/v4/user', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(safeFetch).toHaveBeenCalledWith('https://gitlab.example.com/api/v4/user', {
      headers: { Authorization: 'Bearer tok' },
      timeoutMs: GITLAB_REQUEST_TIMEOUT_MS,
      maxResponseBytes: GITLAB_MAX_RESPONSE_BYTES,
      onOverflow: 'error',
    })
  })

  it('lets a caller shorten the timeout but never lift the body cap', async () => {
    await gitlabFetch('https://gitlab.com/api/v4/user', { timeoutMs: 1000 })

    expect(safeFetch).toHaveBeenLastCalledWith(
      'https://gitlab.com/api/v4/user',
      expect.objectContaining({ timeoutMs: 1000, maxResponseBytes: GITLAB_MAX_RESPONSE_BYTES })
    )
  })
})
