/**
 * The widget loads in a hidden iframe on every page that embeds it, so it
 * ships no animation library. Its views animate with CSS (tw-animate-css
 * `animate-in`) and its exits with the Web Animations API
 * (components/widget/widget-presence.tsx). One framer-motion import in any
 * of these files would pull the library's shared chunk (about 27 KB brotli)
 * back into the widget. This is a source-level guard because that
 * regression shows up as a size increase, not a behavioral test failure.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')

const widgetFiles = [
  'routes/widget/index.tsx',
  'components/widget/widget-shell.tsx',
  'components/widget/widget-home.tsx',
  'components/widget/widget-home-animated.tsx',
  'components/widget/widget-messages.tsx',
  'components/widget/widget-overview.tsx',
  'components/widget/widget-presence.tsx',
  // The messenger's reply buttons and CSAT row: the widget preloads the
  // thread they render in.
  'components/shared/conversation/block-affordance.tsx',
]

describe('widget animation', () => {
  it.each(widgetFiles)('%s does not import framer-motion', (relPath) => {
    const source = readFileSync(join(ROOT, relPath), 'utf8')
    expect(source).not.toMatch(/from 'framer-motion'/)
    expect(source).not.toMatch(/import\('framer-motion'\)/)
  })
})
