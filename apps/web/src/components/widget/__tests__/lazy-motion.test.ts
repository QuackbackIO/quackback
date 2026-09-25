/**
 * The widget loads framer-motion's smaller `domAnimation` feature bundle
 * under one `LazyMotion` boundary (routes/widget/index.tsx), not the full
 * `motion` component bundle (~38 KB gz vs ~26 KB gz; see check:widget-bundle).
 * `m` components read the shared feature bundle from that boundary; a
 * `motion` component ignores it and drags its own copy back in, silently
 * reinflating the widget bundle. This is a source-level guard because that
 * regression shows up as a size increase, not a behavioral test failure.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')

const widgetMotionFiles = [
  'routes/widget/index.tsx',
  'components/widget/widget-shell.tsx',
  'components/widget/widget-home-animated.tsx',
  'components/widget/widget-messages.tsx',
  'components/widget/widget-overview.tsx',
]

describe('widget framer-motion usage', () => {
  it.each(widgetMotionFiles)('%s uses m, not motion', (relPath) => {
    const source = readFileSync(join(ROOT, relPath), 'utf8')
    expect(source).not.toMatch(/<motion\./)
    expect(source).not.toMatch(/from 'framer-motion'[^\n]*\bmotion\b/)
  })

  it('routes/widget/index.tsx wraps the page in LazyMotion(domAnimation)', () => {
    const source = readFileSync(join(ROOT, 'routes/widget/index.tsx'), 'utf8')
    expect(source).toMatch(/import\s*\{[^}]*\bLazyMotion\b[^}]*\}\s*from\s*'framer-motion'/)
    expect(source).toMatch(/import\s*\{[^}]*\bdomAnimation\b[^}]*\}\s*from\s*'framer-motion'/)
    expect(source).toMatch(/<LazyMotion features={domAnimation}>/)
  })
})
