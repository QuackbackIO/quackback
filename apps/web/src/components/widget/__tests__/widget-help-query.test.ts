import { describe, expect, it } from 'vitest'
import { INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'
import { shouldLeaveUnavailableHelpCategory } from '../widget-help-query'

describe('shouldLeaveUnavailableHelpCategory', () => {
  it('leaves once the live session list no longer contains the id', () => {
    expect(shouldLeaveUnavailableHelpCategory('secret', [{ id: 'public' }], 1)).toBe(true)
    expect(shouldLeaveUnavailableHelpCategory('public', [{ id: 'public' }], 1)).toBe(false)
  })

  it('waits until the current session list is in', () => {
    expect(shouldLeaveUnavailableHelpCategory('secret', undefined, 1)).toBe(false)
  })

  it('does not bounce on the anonymous first paint', () => {
    expect(
      shouldLeaveUnavailableHelpCategory('secret', [{ id: 'public' }], INITIAL_SESSION_VERSION)
    ).toBe(false)
  })
})
