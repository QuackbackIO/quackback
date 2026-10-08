// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let logoUrl: string | null = null

vi.mock('@/lib/client/hooks/use-settings-queries', () => ({
  useSettingsLogo: () => ({ data: { url: logoUrl } }),
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useUploadWorkspaceLogo: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteWorkspaceLogo: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/components/ui/image-cropper', () => ({ ImageCropper: () => null }))

const { LogoUploader } = await import('../logo-uploader')

const scrollIntoView = vi.fn()

beforeEach(() => {
  logoUrl = null
  scrollIntoView.mockReset()
  Element.prototype.scrollIntoView = scrollIntoView
})
afterEach(cleanup)

describe('LogoUploader', () => {
  it('shows an Upload logo control at rest when there is no logo', () => {
    render(<LogoUploader workspaceName="Fernhill" />)
    const control = screen.getByRole('button', { name: 'Upload logo' })
    expect(control.className).not.toContain('opacity-0')
    expect(control.textContent).toBe('Upload logo')
  })

  it('offers Change once a logo is set', () => {
    logoUrl = 'https://example.com/logo.png'
    render(<LogoUploader workspaceName="Fernhill" />)
    expect(screen.getByRole('button', { name: 'Change logo' }).textContent).toBe('Change')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('brings itself into view and highlights when asked to focus', () => {
    const { container } = render(<LogoUploader workspaceName="Fernhill" focus />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-logo-highlight="true"]')).toBeTruthy()
  })

  it('stays put and unhighlighted otherwise', () => {
    const { container } = render(<LogoUploader workspaceName="Fernhill" />)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(container.querySelector('[data-logo-highlight="true"]')).toBeNull()
  })
})
