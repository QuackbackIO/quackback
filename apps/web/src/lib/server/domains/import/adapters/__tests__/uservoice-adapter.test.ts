import { describe, it, expect } from 'vitest'
import { detectUserVoiceExport, normalizeUserVoiceExport } from '../uservoice/adapter'
import { parseCsvCamelCase } from '../camel-case-csv'

describe('detectUserVoiceExport', () => {
  it('detects the full suggestions export by its hallmark columns', () => {
    expect(detectUserVoiceExport(['ideaId', 'ideaTitle', 'userEmailAddress'])).toBe(true)
  })

  it('rejects a generic CSV', () => {
    expect(detectUserVoiceExport(['title', 'content'])).toBe(false)
  })
})

describe('normalizeUserVoiceExport', () => {
  const csv = [
    'Idea Id,Idea Title,Idea Description,Category Name,Public Status Name,Labels,Voters Count,Created Timestamp,Idea Creator Name,Idea Creator Email Address,User Email Address,Linked Idea Creation Date',
    '1,Dark mode,Please add it,Features,Under Review,"[""ui"",""theme""]",2,2025-07-21 03:37:03,Alice,alice@example.com,alice@example.com,2025-07-21 03:37:03',
    '1,Dark mode,Please add it,Features,Under Review,"[""ui"",""theme""]",2,2025-07-21 03:37:03,Alice,alice@example.com,bob@example.com,2025-07-22 10:00:00',
    '2,Export CSV,Let me export my data,Features,Planned,,1,2025-06-01 00:00:00,Carol,carol@example.com,carol@example.com,2025-06-01 00:00:00',
  ].join('\n')

  it('dedupes rows into one canonical post per idea', () => {
    const { csv: canonicalCsv } = normalizeUserVoiceExport(csv)
    const { rows } = parseCsvCamelCase(canonicalCsv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      title: 'Dark mode',
      content: 'Please add it',
      board: 'Features',
      status: 'Under Review',
      tags: 'ui,theme',
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      voteCount: '2',
      sourceId: '1',
    })
  })

  it('extracts real per-voter records keyed by source_id, deduped by email', () => {
    const { voters } = normalizeUserVoiceExport(csv)
    expect(voters['1']).toHaveLength(2)
    expect(voters['1'].map((v) => v.email).sort()).toEqual(['alice@example.com', 'bob@example.com'])
    expect(voters['2']).toHaveLength(1)
  })

  it('surfaces the votes-only coverage caveat', () => {
    const { caveats } = normalizeUserVoiceExport(csv)
    expect(caveats.some((c) => c.includes('at least one vote'))).toBe(true)
  })

  it('normalizes UserVoice status text to Quackback default status names', () => {
    const { csv: canonicalCsv } = normalizeUserVoiceExport(csv)
    const { rows } = parseCsvCamelCase(canonicalCsv)
    expect(rows[1].status).toBe('Planned')
  })
})
