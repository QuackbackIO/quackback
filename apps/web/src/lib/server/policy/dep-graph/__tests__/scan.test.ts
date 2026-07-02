import { describe, it, expect } from 'vitest'
import { extractImports, resolveSrcSpecifier, bucketOf, domainOf } from '../scan'

describe('extractImports', () => {
  it('extracts static import specifiers', () => {
    const refs = extractImports(
      'a.ts',
      `import { x } from './x'\nimport y from '@/lib/shared/y'\nimport '@quackback/ids'\n`
    )
    expect(refs).toEqual([
      { specifier: './x', kind: 'static' },
      { specifier: '@/lib/shared/y', kind: 'static' },
      { specifier: '@quackback/ids', kind: 'static' },
    ])
  })

  it('extracts export-from specifiers', () => {
    const refs = extractImports('a.ts', `export { x } from './x'\nexport * from '../y'\n`)
    expect(refs.map((r) => r.specifier)).toEqual(['./x', '../y'])
    expect(refs.every((r) => r.kind === 'export-from')).toBe(true)
  })

  it('extracts string-literal dynamic imports and skips non-literal ones', () => {
    const refs = extractImports(
      'a.ts',
      `const m = await import('@/lib/server/db')\nconst n = await import(\`./locales/\${l}\`)\n`
    )
    expect(refs).toEqual([{ specifier: '@/lib/server/db', kind: 'dynamic' }])
  })

  it('counts type-only imports (compile-time coupling is still coupling)', () => {
    const refs = extractImports(
      'a.ts',
      `import type { T } from './types'\nexport type { U } from './u'\n`
    )
    expect(refs.map((r) => r.specifier)).toEqual(['./types', './u'])
  })

  it('ignores import-shaped text inside comments and strings', () => {
    const refs = extractImports(
      'a.ts',
      `// import { x } from './commented'\nconst s = "import { y } from './stringed'"\n`
    )
    expect(refs).toEqual([])
  })

  it('parses TSX without choking on JSX syntax', () => {
    const refs = extractImports(
      'a.tsx',
      `import { A } from '@/components/a'\nexport const B = () => <A prop={1 < 2} />\n`
    )
    expect(refs.map((r) => r.specifier)).toEqual(['@/components/a'])
  })
})

describe('resolveSrcSpecifier', () => {
  it('resolves the @/ alias to a src-relative path', () => {
    expect(resolveSrcSpecifier('routes/index.tsx', '@/lib/shared/permissions')).toBe(
      'lib/shared/permissions'
    )
  })

  it('resolves same-dir and parent-dir relative specifiers', () => {
    expect(resolveSrcSpecifier('lib/server/db.ts', './config')).toBe('lib/server/config')
    expect(resolveSrcSpecifier('lib/server/functions/posts.ts', '../domains/posts/service')).toBe(
      'lib/server/domains/posts/service'
    )
  })

  it('resolves root-level files against the src root', () => {
    expect(resolveSrcSpecifier('router.tsx', './routeTree.gen')).toBe('routeTree.gen')
  })

  it('strips vite query suffixes before resolving', () => {
    expect(resolveSrcSpecifier('routes/a.tsx', '@/globals.css?url')).toBe('globals.css')
  })

  it('returns null for bare, package, and src-escaping specifiers', () => {
    expect(resolveSrcSpecifier('routes/a.tsx', 'react')).toBeNull()
    expect(resolveSrcSpecifier('routes/a.tsx', '@quackback/ids')).toBeNull()
    expect(resolveSrcSpecifier('routes/a.tsx', '@tanstack/react-router')).toBeNull()
    expect(resolveSrcSpecifier('server.ts', '../package.json')).toBeNull()
  })
})

describe('bucketOf', () => {
  it('splits lib one level deeper than other top-level directories', () => {
    expect(bucketOf('lib/server/db.ts')).toBe('lib/server')
    expect(bucketOf('lib/client/api.ts')).toBe('lib/client')
    expect(bucketOf('lib/shared/permissions.ts')).toBe('lib/shared')
    expect(bucketOf('components/ui/button.tsx')).toBe('components')
    expect(bucketOf('routes/index.tsx')).toBe('routes')
  })

  it('assigns a directory-index import target like lib/shared to its lib bucket', () => {
    expect(bucketOf('lib/shared')).toBe('lib/shared')
    expect(bucketOf('lib/client')).toBe('lib/client')
  })

  it('assigns root-level files to the (root) bucket', () => {
    expect(bucketOf('router.tsx')).toBe('(root)')
    expect(bucketOf('routeTree.gen.ts')).toBe('(root)')
  })
})

describe('domainOf', () => {
  it('extracts the domain segment for files and import targets under domains/', () => {
    expect(domainOf('lib/server/domains/posts/posts.service.ts')).toBe('posts')
    expect(domainOf('lib/server/domains/users')).toBe('users')
  })

  it('returns null outside lib/server/domains', () => {
    expect(domainOf('lib/server/db.ts')).toBeNull()
    expect(domainOf('components/ui/button.tsx')).toBeNull()
    expect(domainOf('lib/server/domains')).toBeNull()
  })
})
