import { describe, it, expect } from 'vitest'
import { resolveWorkflowAbandonedAutoClose } from '../settings.workflows'
import { DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE } from '@/lib/shared/workflows/abandoned-auto-close'

describe('resolveWorkflowAbandonedAutoClose', () => {
  it('defaults to disabled, 5 minute wait, keep-if-email-captured on', () => {
    expect(resolveWorkflowAbandonedAutoClose(null)).toEqual(DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE)
    expect(resolveWorkflowAbandonedAutoClose('{}')).toEqual(DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE)
  })

  it('returns the stored metadata setting merged over defaults', () => {
    const meta = JSON.stringify({
      workflowAbandonedAutoClose: { enabled: true, waitMinutes: 15 },
    })
    expect(resolveWorkflowAbandonedAutoClose(meta)).toEqual({
      ...DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE,
      enabled: true,
      waitMinutes: 15,
    })
  })

  it('preserves sibling metadata keys (does not require exclusive ownership)', () => {
    const meta = JSON.stringify({
      officeHours: { enabled: true },
      workflowAbandonedAutoClose: { enabled: true },
    })
    expect(resolveWorkflowAbandonedAutoClose(meta).enabled).toBe(true)
  })

  it('falls back to defaults on unparseable metadata rather than throwing', () => {
    expect(resolveWorkflowAbandonedAutoClose('not json')).toEqual(
      DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE
    )
  })

  it('ignores an invalid stored shape (out-of-range waitMinutes) and falls back to defaults', () => {
    const meta = JSON.stringify({ workflowAbandonedAutoClose: { waitMinutes: 999 } })
    expect(resolveWorkflowAbandonedAutoClose(meta)).toEqual(DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE)
  })
})
