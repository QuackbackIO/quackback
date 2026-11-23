// @vitest-environment happy-dom
/**
 * The wide logo, with its dark mode version when the workspace has one: both
 * are in the page and the stylesheet shows one, by the same `.dark` class
 * that turns the portal dark, forced or by the visitor's preference. Nothing
 * waits for a script, so the right logo is there on the first paint.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { WideLogo } from '../wide-logo'
import { portalWideLogoDarkUrl } from '@/lib/shared/portal-wide-logo'

afterEach(cleanup)

describe('WideLogo', () => {
  it('draws the logo alone when there is no dark mode version', () => {
    const { container } = render(<WideLogo src="/l.svg" alt="Acme" className="h-8" />)
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', '/l.svg')
    expect(imgs[0]!.className).toBe('h-8')
  })

  it('draws both, the logo hidden where the portal is dark and its dark version shown only there', () => {
    const { container } = render(
      <WideLogo src="/l.svg" darkSrc="/d.svg" alt="Acme" className="h-8" />
    )
    const [light, dark] = [...container.querySelectorAll('img')]
    expect(light).toHaveAttribute('src', '/l.svg')
    expect(light!.className.split(' ')).toEqual(expect.arrayContaining(['h-8', 'dark:hidden']))
    expect(dark).toHaveAttribute('src', '/d.svg')
    expect(dark!.className.split(' ')).toEqual(
      expect.arrayContaining(['h-8', 'hidden', 'dark:block'])
    )
    // Both name the brand; only one is ever shown, so it is read out once.
    expect(light).toHaveAttribute('alt', 'Acme')
    expect(dark).toHaveAttribute('alt', 'Acme')
  })
})

describe('portalWideLogoDarkUrl', () => {
  const branding = {
    headerDisplayMode: 'custom_logo',
    headerLogoUrl: '/l.svg',
    headerLogoDarkUrl: '/d.svg',
  }
  it('is the dark version only while the header shows the wide logo', () => {
    expect(portalWideLogoDarkUrl(branding)).toBe('/d.svg')
    expect(portalWideLogoDarkUrl({ ...branding, headerDisplayMode: 'logo_and_name' })).toBeNull()
    expect(portalWideLogoDarkUrl({ ...branding, headerLogoUrl: null })).toBeNull()
    expect(portalWideLogoDarkUrl({ ...branding, headerLogoDarkUrl: null })).toBeNull()
    expect(portalWideLogoDarkUrl(null)).toBeNull()
  })
})
