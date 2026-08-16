import { describe, it, expect } from 'vitest'
import { resolveWorkflowCloseSpam } from '../settings.workflows'
import { DEFAULT_WORKFLOW_CLOSE_SPAM } from '@/lib/shared/workflows/close-spam'

describe('resolveWorkflowCloseSpam', () => {
  it('defaults to disabled', () => {
    expect(resolveWorkflowCloseSpam(null)).toEqual(DEFAULT_WORKFLOW_CLOSE_SPAM)
    expect(resolveWorkflowCloseSpam('{}')).toEqual(DEFAULT_WORKFLOW_CLOSE_SPAM)
  })

  it('returns the stored metadata setting merged over defaults', () => {
    const meta = JSON.stringify({ workflowCloseSpam: { enabled: true } })
    expect(resolveWorkflowCloseSpam(meta)).toEqual({ enabled: true })
  })

  it('is independent of the abandoned-auto-close sibling key', () => {
    const meta = JSON.stringify({
      workflowAbandonedAutoClose: { enabled: true },
      workflowCloseSpam: { enabled: true },
    })
    expect(resolveWorkflowCloseSpam(meta).enabled).toBe(true)
  })

  it('falls back to defaults on unparseable metadata', () => {
    expect(resolveWorkflowCloseSpam('not json')).toEqual(DEFAULT_WORKFLOW_CLOSE_SPAM)
  })
})
