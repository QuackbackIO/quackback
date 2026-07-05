/**
 * Unit tests for POST /api/import/detect (§I3): normalizes a UserVoice
 * export or a Canny API pull into the wizard's canonical CSV.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockDetectUserVoiceExport: vi.fn(),
  mockNormalizeUserVoiceExport: vi.fn(),
  mockNormalizeCannyExport: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/import/adapters/uservoice/adapter', () => ({
  detectUserVoiceExport: hoisted.mockDetectUserVoiceExport,
  normalizeUserVoiceExport: hoisted.mockNormalizeUserVoiceExport,
}))

vi.mock('@/lib/server/domains/import/adapters/canny/adapter', () => ({
  normalizeCannyExport: hoisted.mockNormalizeCannyExport,
}))

import { handleImportDetect } from '../detect'

type FakeFile = { name: string; type: string; size: number; text: () => Promise<string> }

const csvFile = (csv: string): FakeFile => ({
  name: 'export.csv',
  type: 'text/csv',
  size: csv.length,
  text: async () => csv,
})

function makeRequest(fields: Record<string, string | FakeFile>) {
  const form = { get: (key: string) => fields[key] ?? null }
  return { headers: new Headers(), formData: async () => form } as unknown as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin' },
  })
})

describe('POST /api/import/detect', () => {
  it('rejects non-admins', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member' },
    })
    const res = await handleImportDetect(makeRequest({ source: 'uservoice' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for an unsupported source', async () => {
    const res = await handleImportDetect(makeRequest({ source: 'zendesk' }))
    expect(res.status).toBe(400)
  })

  describe('source=uservoice', () => {
    it('returns 400 when no file is provided', async () => {
      const res = await handleImportDetect(makeRequest({ source: 'uservoice' }))
      expect(res.status).toBe(400)
    })

    it('returns 400 when the file does not look like a UserVoice export', async () => {
      hoisted.mockDetectUserVoiceExport.mockReturnValue(false)
      const res = await handleImportDetect(
        makeRequest({ source: 'uservoice', file: csvFile('title,content\nA,B\n') })
      )
      expect(res.status).toBe(400)
      expect(hoisted.mockNormalizeUserVoiceExport).not.toHaveBeenCalled()
    })

    it('normalizes a detected export and returns the canonical CSV + voters', async () => {
      hoisted.mockDetectUserVoiceExport.mockReturnValue(true)
      hoisted.mockNormalizeUserVoiceExport.mockReturnValue({
        csv: 'title,content\nDark mode,Please\n',
        voters: { '1': [{ email: 'alice@example.com' }] },
        caveats: ['votes-only caveat'],
      })

      const res = await handleImportDetect(
        makeRequest({
          source: 'uservoice',
          file: csvFile('ideaId,ideaTitle,userEmailAddress\n1,Dark mode,alice@example.com\n'),
        })
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { csv: string; voters: unknown; caveats: string[] }
      expect(body.csv).toContain('Dark mode')
      expect(body.caveats).toEqual(['votes-only caveat'])
    })
  })

  describe('source=canny', () => {
    it('returns 400 when no API key is provided', async () => {
      const res = await handleImportDetect(makeRequest({ source: 'canny' }))
      expect(res.status).toBe(400)
      expect(hoisted.mockNormalizeCannyExport).not.toHaveBeenCalled()
    })

    it('fetches and normalizes via the Canny API', async () => {
      hoisted.mockNormalizeCannyExport.mockResolvedValue({
        csv: 'title,content\nDark mode,Please\n',
        voters: {},
        caveats: [],
      })

      const res = await handleImportDetect(makeRequest({ source: 'canny', apiKey: 'canny-key' }))

      expect(res.status).toBe(200)
      expect(hoisted.mockNormalizeCannyExport).toHaveBeenCalledWith({ apiKey: 'canny-key' })
    })
  })
})
