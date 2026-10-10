import { describe, expect, it, vi } from 'vitest'
import { makeSafeDispatch } from '../safe-dispatch'

describe('makeSafeDispatch', () => {
  it('swallows dispatch errors and logs them with the label', async () => {
    const warn = vi.fn()
    const safe = makeSafeDispatch({ warn })
    const err = new Error('bus down')
    await safe('ticket.created', async () => {
      throw err
    })
    expect(warn).toHaveBeenCalledWith({ err, label: 'ticket.created' }, 'webhook failed')
  })

  it('resolves when the dispatch succeeds', async () => {
    const warn = vi.fn()
    const safe = makeSafeDispatch({ warn })
    const fn = vi.fn().mockResolvedValue(undefined)
    await safe('ticket.created', fn)
    expect(fn).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })
})
