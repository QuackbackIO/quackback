import { describe, expect, it } from 'vitest'
import { builtinModules, isBuiltin } from 'node:module'
import { NODE_BUILTIN_SPECIFIER, isClientProtectedSpecifier } from '../client-import-protection'

describe('NODE_BUILTIN_SPECIFIER', () => {
  it('matches every Node built-in, bare and node:-prefixed', () => {
    const missed = builtinModules.filter(
      (m) => !NODE_BUILTIN_SPECIFIER.test(m) || !NODE_BUILTIN_SPECIFIER.test(`node:${m}`)
    )
    expect(missed).toEqual([])
  })

  it.each(['punycode/punycode.js', 'urlpattern', 'cryptography', 'react', 'fs/x', '@scope/url'])(
    'leaves the npm package %j alone',
    (spec) => {
      expect(isBuiltin(spec)).toBe(false)
      expect(NODE_BUILTIN_SPECIFIER.test(spec)).toBe(false)
    }
  )

  it('refuses any node: specifier, built-in or not, since no browser loads one', () => {
    for (const spec of ['node:anything', 'node:', 'node:fs\n']) {
      expect(NODE_BUILTIN_SPECIFIER.test(spec)).toBe(true)
    }
  })

  it('feeds isClientProtectedSpecifier', () => {
    expect(isClientProtectedSpecifier('node:url')).toBe(true)
    expect(isClientProtectedSpecifier('crypto')).toBe(true)
    expect(isClientProtectedSpecifier('pino/file')).toBe(true)
    expect(isClientProtectedSpecifier('react')).toBe(false)
  })
})
