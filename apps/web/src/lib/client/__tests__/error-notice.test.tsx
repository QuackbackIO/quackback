// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNEXPECTED_ERROR_MESSAGE,
  liftErrorReference,
  withErrorReference,
} from '@/lib/shared/error-reference'

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const { toastError } = await import('../error-notice')
const { errorText } = await import('../error-text')

const hidden = () =>
  liftErrorReference(new Error(withErrorReference(UNEXPECTED_ERROR_MESSAGE, 'D264-C488')))

function at(path: string) {
  window.history.replaceState(null, '', path)
}

afterEach(() => {
  toast.error.mockReset()
  at('/')
})

describe('toastError', () => {
  it('toasts a message written for people exactly as before', () => {
    at('/admin/roadmap')
    toastError(new Error('A roadmap with this name already exists'), "Couldn't create roadmap")
    expect(toast.error).toHaveBeenCalledWith('A roadmap with this name already exists')
  })

  it('uses the fallback when the thrown value is not an error', () => {
    toastError(undefined, "Couldn't create roadmap")
    expect(toast.error).toHaveBeenCalledWith("Couldn't create roadmap")
  })

  it('gives the team the action, the sentence, the reference and a way to copy it', () => {
    at('/admin/roadmap')
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, onLine: true, clipboard: { writeText } })

    toastError(hidden(), "Couldn't create roadmap")

    const [title, options] = toast.error.mock.calls[0]
    expect(title).toBe("Couldn't create roadmap")
    expect(JSON.stringify(options.description)).toContain(UNEXPECTED_ERROR_MESSAGE)
    expect(JSON.stringify(options.description)).toContain('D264-C488')
    expect(options.action.label).toBe('Copy')
    options.action.onClick()
    expect(writeText).toHaveBeenCalledWith('D264-C488')
    vi.unstubAllGlobals()
  })

  it('keeps the same failure quiet for a portal visitor', () => {
    at('/roadmap')
    toastError(hidden(), "Couldn't submit your post")
    expect(toast.error).toHaveBeenCalledWith("Couldn't submit your post")
  })
})

describe('errorText', () => {
  it('is one line carrying the reference for the team, and the fallback for a visitor', () => {
    at('/admin/settings/team')
    expect(errorText(hidden(), "Couldn't send invites")).toBe(
      `Couldn't send invites. ${UNEXPECTED_ERROR_MESSAGE} (Ref D264-C488)`
    )
    at('/')
    expect(errorText(hidden(), "Couldn't post comment")).toBe("Couldn't post comment")
  })
})
