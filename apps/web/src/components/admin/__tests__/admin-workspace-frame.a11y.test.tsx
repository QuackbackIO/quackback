// @vitest-environment happy-dom
/**
 * Landmarks in the admin: one <main> (the shell's), which a "Skip to content"
 * link reaches first thing, so a keyboard user does not tab through the rail on
 * every page. Pages inside the shell must not open a second <main>.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { AdminWorkspaceFrame } from '../admin-workspace-frame'

afterEach(cleanup)

const SRC = join(__dirname, '..', '..', '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__') return []
    if (statSync(path).isDirectory()) return files(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

describe('admin landmarks', () => {
  it('offers a skip link to the one main region', () => {
    render(
      <IntlProvider locale="en">
        <AdminWorkspaceFrame sidebar={<nav>rail</nav>} notices={null}>
          <p>page</p>
        </AdminWorkspaceFrame>
      </IntlProvider>
    )
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    const main = screen.getByRole('main')
    expect(skip.getAttribute('href')).toBe(`#${main.id}`)
    expect(main.id).toBeTruthy()
    // First in tab order: before the rail.
    expect(
      skip.compareDocumentPosition(screen.getByText('rail')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('no admin page opens a second <main> inside the shell', () => {
    const roots = [join(SRC, 'routes', 'admin'), join(SRC, 'components', 'admin')]
    const nested = roots
      .flatMap(files)
      .filter((file) => !file.endsWith('admin-workspace-frame.tsx'))
      .filter((file) => /<main[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
    expect(nested).toEqual([])
  })
})
