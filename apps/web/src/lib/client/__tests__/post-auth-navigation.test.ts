// @vitest-environment happy-dom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { navigateAfterAuth } from '../post-auth-navigation'

describe('navigateAfterAuth', () => {
  let assignSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  })

  afterEach(() => {
    assignSpy.mockRestore()
  })

  it('full-navigates (window.location.assign) to a team surface (/admin)', () => {
    const clientNavigate = vi.fn()
    navigateAfterAuth('/admin', clientNavigate)
    expect(assignSpy).toHaveBeenCalledWith('/admin')
    expect(clientNavigate).not.toHaveBeenCalled()
  })

  it('calls clientNavigate for a portal-local destination (/roadmap)', () => {
    const clientNavigate = vi.fn()
    navigateAfterAuth('/roadmap', clientNavigate)
    expect(clientNavigate).toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
  })
})
