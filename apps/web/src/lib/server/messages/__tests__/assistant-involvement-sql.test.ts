import { describe, expect, it } from 'vitest'
import { notHandledByAssistantSql } from '../assistant-involvement-sql'

function sqlText(fragment: unknown): string {
  const chunks = (fragment as { queryChunks?: unknown[] }).queryChunks ?? []
  return chunks
    .flatMap((chunk) => {
      if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        const value = (chunk as { value: unknown }).value
        return Array.isArray(value) ? value : [value]
      }
      return []
    })
    .join('')
}

describe('notHandledByAssistantSql', () => {
  it('excludes conversations with an active Quinn involvement', () => {
    const text = sqlText(notHandledByAssistantSql())
    expect(text).toContain('NOT EXISTS')
    expect(text).toContain("status = 'active'")
  })
})
