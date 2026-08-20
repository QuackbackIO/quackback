/**
 * The gate: `apps/web/src` does not import the BullMQ package.
 *
 * This is the successor to `queue/create-worker.ts`, a seam that refused to
 * construct a `Worker` under pooled tenancy. That seam survived seven rounds of
 * attack and twenty-one bypass shapes; it is gone because the eight modules it
 * guarded now run on the Postgres job tier. What replaces it is simpler and
 * strictly stronger — you cannot construct a `Worker` without importing the
 * package — so every bypass the seam had to enumerate is unrepresentable here.
 *
 * The corpus below is the point of the file. A gate whose only assertion is
 * "the tree is clean" passes identically when the scanner reads nothing, and
 * this codebase has caught nineteen tests that could not have failed. So each
 * spelling that puts the module in the graph is planted and asserted, each
 * near-miss is pinned as a negative, and the walk is measured against the tree
 * it claims to cover.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describeBannedImport,
  findBannedImports,
  findBannedImportsInText,
  isBannedSpecifier,
  walkAllTsFiles,
} from '../scan'
import { walkSourceFiles } from '../../source-files'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src

const found = findBannedImports(SRC_ROOT)

describe('the gate', () => {
  it('finds no import of the queue package anywhere under apps/web/src', () => {
    // Deliberately not "no `new Worker`". The package is the noun: a module in
    // the graph is one edit away from a consumer whose run loop inherits
    // whichever request armed it, which is the leak the deleted seam existed to
    // remove and the reason the ban has no adjudicated-importer exemption.
    expect(found.map(describeBannedImport)).toEqual([])
  })
})

describe('the scanner is looking at something', () => {
  it('walks the real tree, and reaches files the ledger scanners skip', () => {
    const walked = walkAllTsFiles(SRC_ROOT)
    expect(walked.length).toBeGreaterThan(1000)

    // The scope claim, measured rather than asserted: this walk covers the
    // tests that `walkSourceFiles` filters out. A test importing the package
    // keeps it in the graph and gives the next `Worker` somewhere to live.
    const ledgerScope = new Set(walkSourceFiles(SRC_ROOT))
    const testsOnly = walked.filter((f) => !ledgerScope.has(f))
    expect(testsOnly.length).toBeGreaterThan(100)
    expect(testsOnly.some((f) => f.includes('__tests__'))).toBe(true)
  })

  it('reads the files that a grep would silently skip', () => {
    // This environment's `grep` passes `-I`, so a file containing a NUL byte is
    // skipped without a word. If that population were empty the parser-based
    // implementation would be a preference; it is not empty, so it is the
    // difference between a gate and a gate with four blind spots.
    const withNul = walkAllTsFiles(SRC_ROOT).filter((f) => readFileSync(f).includes(0))
    expect(withNul.length).toBeGreaterThan(0)
  })
})

describe('every spelling that puts the package in the graph', () => {
  function scan(source: string): string[] {
    return findBannedImportsInText('planted.ts', source).map((f) => `${f.kind}:${f.specifier}`)
  }

  const cases: Array<[string, string, string]> = [
    ['a static named import', `import { Worker } from 'bullmq'\n`, 'import:bullmq'],
    ['a bare side-effect import', `import 'bullmq'\n`, 'import:bullmq'],
    ['a default import', `import bull from 'bullmq'\n`, 'import:bullmq'],
    ['a namespace import', `import * as bull from 'bullmq'\n`, 'import:bullmq'],
    ['a re-export', `export { Worker } from 'bullmq'\n`, 'export-from:bullmq'],
    [
      'a dynamic import',
      `export async function boot() { const { Worker } = await import('bullmq'); return Worker }\n`,
      'dynamic-import:bullmq',
    ],
    ['a require call', `export const bull = require('bullmq')\n`, 'require:bullmq'],
    [
      'a TS import-equals',
      `import bull = require('bullmq')\nexport default bull\n`,
      'import-equals:bullmq',
    ],
    // Type-only counts. The module is still in the graph conceptually, and the
    // `type` keyword is exactly one edit away from not being there.
    [
      'a type-only import',
      `import type { Job } from 'bullmq'\nexport type J = Job\n`,
      'import:bullmq',
    ],
    [
      'an inline type modifier',
      `import { type Job } from 'bullmq'\nexport type J = Job\n`,
      'import:bullmq',
    ],
    ['a type-only re-export', `export type { Job } from 'bullmq'\n`, 'export-from:bullmq'],
    ['an import in type position', `export type J = import('bullmq').Job\n`, 'import-type:bullmq'],
    // A subpath is the same package with the barrel stepped around.
    [
      'a subpath import',
      `import { Worker } from 'bullmq/dist/esm/classes/worker'\n`,
      'import:bullmq/dist/esm/classes/worker',
    ],
    [
      'a subpath dynamic import',
      `export const w = () => import('bullmq/dist/esm/classes/worker.js')\n`,
      'dynamic-import:bullmq/dist/esm/classes/worker.js',
    ],
    [
      'a specifier carrying a build-tool query suffix',
      `import 'bullmq?url'\n`,
      'import:bullmq?url',
    ],
  ]

  for (const [label, source, expected] of cases) {
    it(`catches ${label}`, () => {
      expect(scan(source)).toContain(expected)
    })
  }

  it('reports the line, so a failure names where to look', () => {
    const source = `// header\n\nimport { logger } from './logger'\nimport { Worker } from 'bullmq'\n`
    expect(findBannedImportsInText('planted.ts', source)).toEqual([
      { file: 'planted.ts', line: 4, kind: 'import', specifier: 'bullmq', typeOnly: false },
    ])
  })

  it('records type-only rather than excusing it', () => {
    const [f] = findBannedImportsInText('planted.ts', `import type { Job } from 'bullmq'\n`)
    expect(f.typeOnly).toBe(true)
  })
})

describe('precision: what it must not report', () => {
  // Thirty-odd files in this tree name the package in prose — the migration
  // that removed it is the reason they exist. A check that flags those is a
  // check a reader learns to ignore.
  const NEGATIVES = `/**
 * The eight queues moved off BullMQ; nothing imports 'bullmq' any more.
 */
// import { Worker } from 'bullmq'
import { other } from 'bullmq-pro'
import { local } from './bullmq'
import { sibling } from '@/lib/server/queue/bullmq-shim'
const label = 'bullmq'
const message = \`still no import of 'bullmq' here\`
export const names = [label, message, 'bullmq/dist/classes/worker']
export function mock() {
  // Mocking a module nothing imports has no effect; the import itself is what
  // this bans, and any real consumer is caught at its own import site.
  vi.doMock('bullmq', () => ({}))
}
declare const vi: { doMock: (m: string, f: () => unknown) => void }
`

  it('reports nothing for comments, strings, siblings and relative look-alikes', () => {
    expect(findBannedImportsInText('negatives.ts', NEGATIVES)).toEqual([])
  })

  it('does not treat a longer package name as the banned one', () => {
    expect(isBannedSpecifier('bullmq')).toBe(true)
    expect(isBannedSpecifier('bullmq/dist/x')).toBe(true)
    expect(isBannedSpecifier('bullmq-pro')).toBe(false)
    expect(isBannedSpecifier('@quackback/bullmq')).toBe(false)
    expect(isBannedSpecifier('./bullmq')).toBe(false)
    expect(isBannedSpecifier('nest-bullmq')).toBe(false)
  })
})

describe('scanning a tree', () => {
  function withTree(files: Record<string, string>, run: (found: string[]) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'no-bullmq-'))
    try {
      for (const [rel, body] of Object.entries(files)) {
        const abs = join(dir, rel)
        mkdirSync(join(abs, '..'), { recursive: true })
        writeFileSync(abs, body)
      }
      run(findBannedImports(dir).map(describeBannedImport))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('goes red on a planted importer and names it', () => {
    withTree(
      {
        'lib/clean.ts': `export const ok = 1\n`,
        'lib/queue/offender.ts': `import { Worker } from 'bullmq'\nexport const W = Worker\n`,
      },
      (results) => {
        expect(results).toEqual(["lib/queue/offender.ts:1 — import of 'bullmq'"])
      }
    )
  })

  it('goes red on a planted importer inside a test file', () => {
    // `walkSourceFiles` would not have seen this one. The seam it replaced was
    // reintroduced-in-a-test shaped: a fake `Worker`, a mock of the package,
    // and a consumer to assert on.
    withTree(
      {
        'lib/__tests__/reintroduced.test.ts': `const bull = await import('bullmq')\nexport default bull\n`,
      },
      (results) => {
        expect(results).toEqual([
          "lib/__tests__/reintroduced.test.ts:1 — dynamic-import of 'bullmq'",
        ])
      }
    )
  })

  it('goes red on an importer in a file carrying NUL bytes', () => {
    // The control for the `grep -I` hole. Four files under apps/web/src carry
    // raw NUL bytes today, every one of them a separator inside a template
    // literal, which is what this fixture copies. So this is the shape a
    // text-search ban would miss in silence, not a hypothetical.
    const body =
      `import { Worker } from 'bullmq'\n` +
      `export const key = (a: string, b: string) => \`\${a}\u0000\${b}\`\n` +
      `export { Worker }\n`
    expect(body.includes('\u0000'), 'the fixture carries no NUL byte').toBe(true)
    withTree({ 'lib/nul.ts': body }, (results) => {
      expect(results).toEqual(["lib/nul.ts:1 — import of 'bullmq'"])
    })
  })

  it('CONTROL: a tree with no importer is green', () => {
    // Without this, every assertion above passes on a scanner that reports
    // every file it reads.
    withTree(
      {
        'lib/clean.ts': `import { logger } from './logger'\nexport const ok = logger\n`,
        'lib/__tests__/clean.test.ts': `import { ok } from '../clean'\nexport default ok\n`,
      },
      (results) => {
        expect(results).toEqual([])
      }
    )
  })

  it('skips node_modules and dist, where the package legitimately lives', () => {
    withTree(
      {
        'node_modules/bullmq/index.ts': `export class Worker {}\nimport 'bullmq'\n`,
        'dist/bundle.ts': `import { Worker } from 'bullmq'\nexport { Worker }\n`,
        'lib/clean.ts': `export const ok = 1\n`,
      },
      (results) => {
        expect(results).toEqual([])
      }
    )
  })
})
