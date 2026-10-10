// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PortalPageHeader } from '../portal-page-header'

afterEach(cleanup)

describe('PortalPageHeader', () => {
  it('keeps the large, bold title and the entrance animation', () => {
    const { container } = render(
      <PortalPageHeader size="large" animate title="Changelog" description="Updates" />
    )
    expect(screen.getByRole('heading', { name: 'Changelog' }).className).toContain(
      'sm:text-2xl font-bold'
    )
    expect(container.querySelector('[data-page-header]')?.className).toContain('animate-in')
  })

  it('uses the compact title and no animation by default', () => {
    const { container } = render(<PortalPageHeader title="Profile" />)
    expect(screen.getByRole('heading', { name: 'Profile' }).className).toContain('sm:text-lg')
    expect(container.querySelector('[data-page-header]')?.className).not.toContain('animate-in')
  })

  it('renders the icon tile and the action', () => {
    const { container } = render(
      <PortalPageHeader icon={() => <svg />} title="Profile" action={<button>Go</button>} />
    )
    expect(container.querySelector('[data-page-header-icon]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy()
  })
})

describe('portal routes', () => {
  it('render their title with PortalPageHeader, not the admin PageHeader', () => {
    const dir = join(__dirname, '../../../routes/_portal')
    const offenders = readdirSync(dir).filter(
      (f) => f.endsWith('.tsx') && /shared\/page-header/.test(readFileSync(join(dir, f), 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
