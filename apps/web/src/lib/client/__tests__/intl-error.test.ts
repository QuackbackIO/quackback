import { describe, it, expect, vi, afterEach } from 'vitest'
import { ReactIntlErrorCode } from 'react-intl'
import { onIntlError } from '../intl-error'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('onIntlError', () => {
  // Locale catalogs load asynchronously, so during SSR and the first
  // client render the message map is empty and react-intl reports a
  // MISSING_TRANSLATION for every key before falling back to the inline
  // English defaultMessage. That fallback is intentional, so the handler
  // must stay quiet rather than flooding the server log / console.
  it('swallows MISSING_TRANSLATION without logging', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    onIntlError({
      code: ReactIntlErrorCode.MISSING_TRANSLATION,
      message: 'Missing message: "portal.feedback.header.titlePlaceholder" for locale "pt-br"',
    } as Parameters<typeof onIntlError>[0])
    expect(spy).not.toHaveBeenCalled()
  })

  it('surfaces every other intl error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = {
      code: ReactIntlErrorCode.FORMAT_ERROR,
      message: 'bad ICU syntax',
    } as Parameters<typeof onIntlError>[0]
    onIntlError(err)
    expect(spy).toHaveBeenCalledWith(err)
  })
})
