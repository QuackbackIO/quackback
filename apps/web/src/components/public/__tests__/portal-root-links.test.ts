/**
 * Portal links never hard-code `'/'`. The root is Home or the first page in
 * the menu, and the feed may live at `/feedback`, so a link takes the feed's
 * path from portalFeedbackPath, or means the root by PORTAL_LANDING.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', '..', '..')
const PORTAL_CODE = ['components/public', 'routes/_portal', 'lib/client/mutations']

/** A literal root as a link target: `to: '/'`, `to="/"`, `href="/"`. */
const ROOT_LINK = /\b(?:to|href)\s*[:=]\s*\{?\s*(['"])\/\1/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('portal links', () => {
  it('never hard-code the root', () => {
    const offenders = PORTAL_CODE.flatMap((dir) => files(join(SRC, dir)))
      .filter((path) => !path.includes('/mutations/') || /portal-/.test(path))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, at: `${relative(SRC, path)}:${index + 1}` }))
          .filter(({ line }) => ROOT_LINK.test(line))
          .map(({ at }) => at)
      )
    expect(offenders).toEqual([])
  })
})
