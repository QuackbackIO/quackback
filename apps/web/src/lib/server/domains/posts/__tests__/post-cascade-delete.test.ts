/**
 * Tests for cascade delete service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectFrom = vi.fn()
const mockSelectWhere = vi.fn()
const mockInnerJoin = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        mockSelectFrom(table)
        return {
          innerJoin: (...args: unknown[]) => {
            mockInnerJoin(...args)
            return { where: mockSelectWhere }
          },
          where: mockSelectWhere,
        }
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: mockUpdateWhere }
      },
    }),
  },
  eq: vi.fn((_col, val) => `eq:${val}`),
  and: vi.fn((...args: unknown[]) => `and:${args.join(',')}`),
  inArray: vi.fn((_col, vals) => `inArray:${vals}`),
  postExternalLinks: {
    id: 'pel.id',
    postId: 'pel.postId',
    integrationId: 'pel.integrationId',
    integrationType: 'pel.integrationType',
    externalId: 'pel.externalId',
    externalUrl: 'pel.externalUrl',
    status: 'pel.status',
  },
  integrations: {
    id: 'int.id',
    status: 'int.status',
    config: 'int.config',
    secrets: 'int.secrets',
  },
}))

const mockArchiveExternalIssue = vi.fn()
vi.mock('@/lib/server/integrations/archive', () => ({
  archiveExternalIssue: (...args: unknown[]) => mockArchiveExternalIssue(...args),
}))

const mockDecryptSecrets = vi.fn()
vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: (...args: unknown[]) => mockDecryptSecrets(...args),
  encryptSecrets: vi.fn((v: unknown) => JSON.stringify(v)),
}))

import { executeCascadeDelete, type CascadeChoice } from '../post.cascade-delete'

const POST_ID = 'post_test123' as PostId

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard joined row returned from the single links+integrations query */
function linkRow(
  id: string,
  integrationType: string,
  externalId: string,
  opts?: {
    integrationId?: string
    externalUrl?: string | null
    integrationSecrets?: string | null
    integrationConfig?: Record<string, unknown> | null
  }
) {
  return {
    id,
    integrationId: opts?.integrationId ?? 'int-1',
    integrationType,
    externalId,
    externalUrl: opts?.externalUrl ?? null,
    integrationSecrets:
      opts && 'integrationSecrets' in opts ? opts.integrationSecrets : 'encrypted-blob',
    integrationConfig: opts?.integrationConfig ?? {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeCascadeDelete', () => {
  it('returns empty array when no choices have shouldArchive=true', async () => {
    const choices: CascadeChoice[] = [{ linkId: 'link-1', shouldArchive: false }]
    const results = await executeCascadeDelete(POST_ID, choices)
    expect(results).toEqual([])
    expect(mockSelectFrom).not.toHaveBeenCalled()
  })

  it('returns empty array for empty choices', async () => {
    const results = await executeCascadeDelete(POST_ID, [])
    expect(results).toEqual([])
  })

  it('returns failure when link is not found for this post', async () => {
    // Link query returns nothing (link doesn't belong to this post)
    mockSelectWhere.mockResolvedValueOnce([])

    const results = await executeCascadeDelete(POST_ID, [{ linkId: 'link-1', shouldArchive: true }])
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('Link not found')
  })

  it('returns failure when integration secrets are not available', async () => {
    mockSelectWhere.mockResolvedValueOnce([
      linkRow('link-1', 'linear', 'LIN-1', { integrationSecrets: null }),
    ])

    const results = await executeCascadeDelete(POST_ID, [{ linkId: 'link-1', shouldArchive: true }])
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      linkId: 'link-1',
      integrationType: 'linear',
      externalId: 'LIN-1',
      success: false,
      error: 'Integration secrets not available',
    })
  })

  it('uses DB-stored link data, not client-supplied values', async () => {
    mockSelectWhere.mockResolvedValueOnce([
      linkRow('link-1', 'github', '42', {
        externalUrl: 'https://github.com/org/repo/issues/42',
        integrationConfig: { cloudId: 'abc' },
      }),
    ])

    mockDecryptSecrets.mockReturnValue({ accessToken: 'ghp_test' })
    mockArchiveExternalIssue.mockResolvedValue({ success: true, action: 'closed' })
    mockUpdateWhere.mockResolvedValue(undefined)

    const results = await executeCascadeDelete(POST_ID, [{ linkId: 'link-1', shouldArchive: true }])

    expect(mockDecryptSecrets).toHaveBeenCalledWith('encrypted-blob')
    expect(mockArchiveExternalIssue).toHaveBeenCalledWith('github', {
      externalId: '42',
      externalUrl: 'https://github.com/org/repo/issues/42',
      accessToken: 'ghp_test',
      integrationConfig: { cloudId: 'abc' },
    })
    expect(results[0]).toMatchObject({
      linkId: 'link-1',
      integrationType: 'github',
      externalId: '42',
      success: true,
    })
  })

  it('updates link status to action value on success', async () => {
    mockSelectWhere.mockResolvedValueOnce([linkRow('link-1', 'linear', 'LIN-1')])

    mockDecryptSecrets.mockReturnValue({ accessToken: 'tok' })
    mockArchiveExternalIssue.mockResolvedValue({ success: true, action: 'archived' })
    mockUpdateWhere.mockResolvedValue(undefined)

    await executeCascadeDelete(POST_ID, [{ linkId: 'link-1', shouldArchive: true }])

    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'archived' })
  })

  it('updates link status to error on failure', async () => {
    mockSelectWhere.mockResolvedValueOnce([linkRow('link-1', 'linear', 'LIN-1')])

    mockDecryptSecrets.mockReturnValue({ accessToken: 'tok' })
    mockArchiveExternalIssue.mockResolvedValue({ success: false, error: 'Auth expired' })
    mockUpdateWhere.mockResolvedValue(undefined)

    const results = await executeCascadeDelete(POST_ID, [{ linkId: 'link-1', shouldArchive: true }])

    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'error' })
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('Auth expired')
  })

  it('preserves link metadata when promise rejects (allSettled fallback)', async () => {
    mockSelectWhere.mockResolvedValueOnce([
      linkRow('link-A', 'github', '10', { integrationId: 'int-1' }),
      linkRow('link-B', 'linear', 'LIN-5', { integrationId: 'int-2' }),
    ])

    mockDecryptSecrets.mockReturnValue({ accessToken: 'tok' })

    mockArchiveExternalIssue
      .mockResolvedValueOnce({ success: true, action: 'closed' })
      .mockRejectedValueOnce(new Error('Unexpected DB crash'))

    mockUpdateWhere.mockResolvedValue(undefined)

    const results = await executeCascadeDelete(POST_ID, [
      { linkId: 'link-A', shouldArchive: true },
      { linkId: 'link-B', shouldArchive: true },
    ])

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      linkId: 'link-A',
      integrationType: 'github',
      externalId: '10',
      success: true,
    })
    expect(results[1]).toEqual({
      linkId: 'link-B',
      integrationType: 'linear',
      externalId: 'LIN-5',
      success: false,
      error: 'Unexpected DB crash',
    })
  })

  it('filters out choices with shouldArchive=false', async () => {
    mockSelectWhere.mockResolvedValueOnce([linkRow('link-1', 'linear', 'LIN-1')])

    mockDecryptSecrets.mockReturnValue({ accessToken: 'tok' })
    mockArchiveExternalIssue.mockResolvedValue({ success: true, action: 'archived' })
    mockUpdateWhere.mockResolvedValue(undefined)

    const results = await executeCascadeDelete(POST_ID, [
      { linkId: 'link-1', shouldArchive: true },
      { linkId: 'link-2', shouldArchive: false },
    ])
    expect(results).toHaveLength(1)
    expect(mockArchiveExternalIssue).toHaveBeenCalledTimes(1)
  })

  it('uses access_token fallback when accessToken is not present', async () => {
    mockSelectWhere.mockResolvedValueOnce([linkRow('link-1', 'notion', 'page-1')])

    mockDecryptSecrets.mockReturnValue({ access_token: 'notion_secret' })
    mockArchiveExternalIssue.mockResolvedValue({ success: true, action: 'archived' })
    mockUpdateWhere.mockResolvedValue(undefined)

    await executeCascadeDelete(POST_ID, [{ linkId: 'link-1', shouldArchive: true }])

    expect(mockArchiveExternalIssue).toHaveBeenCalledWith(
      'notion',
      expect.objectContaining({ accessToken: 'notion_secret' })
    )
  })
})
