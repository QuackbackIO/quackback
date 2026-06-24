// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockEnable = vi.fn()
const mockVerifyTotp = vi.fn()
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { twoFactor: { enable: mockEnable, verifyTotp: mockVerifyTotp } },
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') },
}))

const { TwoFactorEnrollSteps } = await import('../two-factor-enroll-steps')

beforeEach(() => {
  vi.clearAllMocks()
  mockEnable.mockResolvedValue({
    data: { totpURI: 'otpauth://x', backupCodes: ['aaaa-bbbb'] },
    error: null,
  })
  mockVerifyTotp.mockResolvedValue({ error: null })
})

describe('TwoFactorEnrollSteps', () => {
  it('enables on mount and renders the QR step', async () => {
    render(<TwoFactorEnrollSteps password="pw" onComplete={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(mockEnable).toHaveBeenCalledWith({ password: 'pw' }))
    expect(await screen.findByAltText(/QR code/i)).toBeInTheDocument()
  })

  it('verifies the code then shows backup codes and completes', async () => {
    const onComplete = vi.fn()
    render(<TwoFactorEnrollSteps password="pw" onComplete={onComplete} onCancel={() => {}} />)
    await screen.findByAltText(/QR code/i)
    fireEvent.change(screen.getByLabelText(/authenticator code/i), { target: { value: '123456' } })
    await waitFor(() => expect(mockVerifyTotp).toHaveBeenCalledWith({ code: '123456' }))
    expect(await screen.findByText('aaaa-bbbb')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /saved/i }))
    expect(onComplete).toHaveBeenCalled()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<TwoFactorEnrollSteps password="pw" onComplete={() => {}} onCancel={onCancel} />)
    await screen.findByAltText(/QR code/i)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
