// @vitest-environment happy-dom
/**
 * The code step for keyboard and right-to-left readers: a code reads left to
 * right in every language, and a wrong code leaves focus in the code field
 * (the field is disabled while checking, which used to drop focus to <body>).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { OtpCodeStep } from '../otp-code-step'

afterEach(cleanup)

function step(props: { loading: boolean; error: string }) {
  return (
    <IntlProvider locale="ar" onError={() => {}}>
      <div dir="rtl">
        <OtpCodeStep
          email="sam@acme.test"
          code="123456"
          onCodeChange={vi.fn()}
          onComplete={vi.fn()}
          onSubmit={vi.fn()}
          onResend={vi.fn()}
          onBack={vi.fn()}
          resendCooldown={0}
          {...props}
        />
      </div>
    </IntlProvider>
  )
}

describe('OtpCodeStep accessibility', () => {
  it('lays the code out left to right inside right-to-left copy', () => {
    render(step({ loading: false, error: '' }))
    const input = screen.getByLabelText('Verification code')
    expect(input.getAttribute('dir')).toBe('ltr')
    const container = input.closest('[data-input-otp-container]')
    expect(container?.closest('[dir]')?.getAttribute('dir')).toBe('ltr')
  })

  it('puts focus back in the code field when a check comes back wrong', () => {
    const { rerender } = render(step({ loading: true, error: '' }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender(step({ loading: false, error: 'That code is not right.' }))

    expect(document.activeElement).toBe(screen.getByLabelText('Verification code'))
  })
})
