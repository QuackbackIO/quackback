/**
 * Differential-coverage test for createWidgetIdentifyTokenFn — the inline
 * handler always rejects, steering callers to /api/widget/identify.
 */
import { describe, it, expect, vi } from 'vitest'

type AnyHandler = (a?: { data?: unknown }) => Promise<unknown>
const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const c: Record<string, unknown> = {
      validator: () => c,
      inputValidator: () => c,
      handler: (fn: AnyHandler) => {
        handlers.push(fn)
        return c
      },
    }
    return c
  },
}))

await import('../widget')

describe('createWidgetIdentifyTokenFn', () => {
  it('throws to redirect callers to the dedicated endpoint', async () => {
    expect(() => handlers[0]({ data: { email: 'a@b.com' } })).toThrow(/\/api\/widget\/identify/)
  })
})
