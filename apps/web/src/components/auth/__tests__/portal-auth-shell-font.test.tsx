// @vitest-environment happy-dom
/**
 * The sign-in pages sit outside the portal layout, so the shell loads the
 * workspace's font itself: the uploaded family's fallback, and the font-face
 * rules, come with the theme styles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const loaded = vi.hoisted(() => [] as Array<[unknown, unknown]>)
let settings: Record<string, unknown> = {}

vi.mock('@/lib/client/hooks/use-branding-font', () => ({
  useBrandingFont: (css: unknown, font: unknown) => {
    loaded.push([css, font])
  },
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => settings,
}))
vi.mock('../portal-brand-mark', () => ({ PortalBrandMark: () => null }))

const { PortalAuthShell } = await import('../portal-auth-shell')

afterEach(() => {
  cleanup()
  loaded.length = 0
})

describe('PortalAuthShell fonts', () => {
  it('loads the custom font fallback and writes its @font-face rules', () => {
    settings = {
      customCss: '',
      brandingConfig: {
        light: { fontSans: '"Inter", sans-serif' },
        customFont: {
          family: 'Sohne',
          fallback: 'lora',
          files: [{ key: 'fonts/2026/10/a.woff2', weight: 400, style: 'normal' }],
        },
      },
    }
    const { container } = render(<PortalAuthShell heading="Sign in">form</PortalAuthShell>)
    expect(loaded.at(-1)?.[1]).toBe('"Lora", ui-serif, Georgia, serif')
    expect(container.innerHTML).toContain('@font-face')
  })

  it('loads the chosen font for a workspace without an upload', () => {
    settings = {
      customCss: '',
      brandingConfig: { light: { fontSans: '"Lora", ui-serif, Georgia, serif' } },
    }
    render(<PortalAuthShell heading="Sign in">form</PortalAuthShell>)
    expect(loaded.at(-1)?.[1]).toBe('"Lora", ui-serif, Georgia, serif')
  })
})
