/**
 * How the read-only refusal reaches each caller that is not a portal or widget
 * page: the REST API answers 403 with the neutral line (never a 500), and an
 * MCP tool returns it as a tool error with its code.
 */
import { describe, expect, it } from 'vitest'
import { handleDomainError } from '@/lib/server/domains/api/responses'
import { errorResult } from '@/lib/server/mcp/tools/helpers'
import {
  BOARD_READ_ONLY_CODE,
  BOARD_READ_ONLY_MESSAGE,
  BoardReadOnlyError,
} from '../plan-limits.board-guard'

describe('the read-only refusal on each surface', () => {
  it('is a 403 with the neutral line on the REST API', async () => {
    const response = handleDomainError(new BoardReadOnlyError())
    expect(response.status).toBe(403)
    const body = JSON.stringify(await response.json())
    expect(body).toContain(BOARD_READ_ONLY_MESSAGE)
    expect(body).not.toMatch(/plan|billing|upgrade/i)
  })

  it('is a tool error with the neutral line and its code on MCP', () => {
    const result = errorResult(new BoardReadOnlyError())
    expect(result.isError).toBe(true)
    const text = result.content.map((c) => ('text' in c ? c.text : '')).join('')
    expect(text).toContain(BOARD_READ_ONLY_MESSAGE)
    expect(text).toContain(BOARD_READ_ONLY_CODE)
  })

  it('never mentions plans or billing', () => {
    expect(BOARD_READ_ONLY_MESSAGE).toBe("This board isn't taking new feedback right now.")
  })
})
