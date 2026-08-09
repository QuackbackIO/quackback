import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import { walkSourceFiles } from '@/lib/server/policy/source-files'
import {
  closeAllWorkers,
  initAllWorkers,
  getWorkerBootStatus,
  type WorkerEntry,
} from '../worker-registry'

/**
 * The seal: every module under lib/server that constructs a BullMQ Worker,
 * by path. Adding a queue module means registering it in WORKER_REGISTRY and
 * listing it here, so boot and drain can never drift apart again.
 */
const WORKER_MODULES = [
  'domains/conversation/conversation.email-imap-queue.ts',
  'domains/export/export-queue.ts',
  'domains/help-center/help-center-translate-queue.ts',
  'domains/import/import-queue.ts',
  'domains/workflows/workflow-dispatch-queue.ts',
  'domains/workflows/workflow-wait-queue.ts',
  'events/process.ts',
  'events/segment-scheduler.ts',
]

/**
 * Modules allowed to import bullmq WITHOUT constructing a Worker (types
 * only, e.g. Job). Anything else importing bullmq is a new chokepoint
 * bypass and must be adjudicated here or in WORKER_MODULES.
 */
const TYPE_ONLY_MODULES: string[] = []

/**
 * The construction seam itself: infrastructure, not a queue.
 *
 * `queue/create-worker.ts` wraps `new Worker` in `runWithoutLogContext` so a
 * Worker cannot inherit the tenant scope of whichever request armed it. It
 * imports bullmq and constructs, but it owns no queue and belongs in no
 * registry — so it is adjudicated here rather than in WORKER_MODULES, whose
 * members must each be dynamically imported by worker-registry.ts.
 *
 * This list is the answer to the chokepoint comment below, which anticipated
 * exactly this refactor: construction moved behind a helper, so the classifier
 * counts a `createQueueWorker` call as construction too and the fifteen queue
 * modules stay where they were.
 */
const WORKER_FACTORY_MODULES = ['queue/create-worker.ts']

const SERVER_ROOT = path.resolve(__dirname, '../..')

/**
 * Does this source import bullmq, and does it construct a Worker?
 *
 * Parsed, not string-matched. `content.includes("from 'bullmq'")` misses
 * `await import('bullmq')`, which is idiomatic throughout this repo —
 * `startup.ts` and `bootstrap.ts` are full of it — so a sixteenth module could
 * obtain BullMQ dynamically, construct an unwrapped `Worker`, and leave this
 * seal 6/6 green. `new bull.Worker(...)` is the construction spelling that goes
 * with it, and an identifier-only check does not see that either.
 */
export function classifyBullmqUsage(text: string): { imports: boolean; constructs: boolean } {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  let imports = false
  let constructs = false

  const visit = (node: ts.Node): void => {
    // import … from 'bullmq'
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'bullmq'
    ) {
      imports = true
    }
    // await import('bullmq')
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'bullmq'
    ) {
      imports = true
    }
    // new Worker(…) or new bull.Worker(…)
    if (ts.isNewExpression(node)) {
      const ctor = node.expression
      if (ts.isIdentifier(ctor) && ctor.text === 'Worker') constructs = true
      if (ts.isPropertyAccessExpression(ctor) && ctor.name.text === 'Worker') constructs = true
    }
    // …or the seam, which is construction by another name.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createQueueWorker'
    ) {
      constructs = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { imports, constructs }
}

/** lib/server files importing bullmq, split by whether they construct a Worker. */
function bullmqImporters(): { constructing: string[]; typeOnly: string[] } {
  const constructing: string[] = []
  const typeOnly: string[] = []
  for (const full of walkSourceFiles(SERVER_ROOT)) {
    if (!full.endsWith('.ts')) continue
    const { imports, constructs } = classifyBullmqUsage(fs.readFileSync(full, 'utf8'))
    if (!imports) continue
    const rel = path.relative(SERVER_ROOT, full).split(path.sep).join('/')
    if (WORKER_FACTORY_MODULES.includes(rel)) continue
    ;(constructs ? constructing : typeOnly).push(rel)
  }
  return { constructing: constructing.sort(), typeOnly: typeOnly.sort() }
}

describe('worker registry seal', () => {
  // Chokepoint rule: enumerating construction sites alone would go blind the
  // moment worker construction moves behind a helper, so ANY bullmq import
  // under lib/server must be adjudicated into one of the two lists.
  it('every bullmq importer is a registered worker module or on the type-only list', () => {
    const { constructing, typeOnly } = bullmqImporters()
    expect(constructing).toEqual(WORKER_MODULES)
    expect(typeOnly).toEqual(TYPE_ONLY_MODULES)
  })

  it('the construction seam is still the only adjudicated factory', () => {
    // If a second factory appears, the classifier above silently stops seeing
    // whatever it wraps. Pinning the list keeps that a deliberate edit.
    expect(WORKER_FACTORY_MODULES).toEqual(['queue/create-worker.ts'])
    const seam = fs.readFileSync(path.resolve(SERVER_ROOT, 'queue/create-worker.ts'), 'utf8')
    expect(seam).toContain('runWithoutLogContext')
    expect(seam).toContain('new Worker')
  })

  it('the registry dynamically imports every worker module', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../worker-registry.ts'), 'utf8')
    const imported = [...source.matchAll(/import\('@\/lib\/server\/([^']+)'\)/g)].map(
      (m) => `${m[1]}.ts`
    )
    expect([...new Set(imported)].sort()).toEqual(WORKER_MODULES)
  })

  // A worker module that never checks shouldRunWorkers() would spin up its
  // Worker under QUACKBACK_ROLE=web, defeating the whole point of the role
  // split. Grepping the source is cheaper than exercising every module's
  // boot path under each role and catches the same class of regression.
  it('every worker module gates construction on shouldRunWorkers()', () => {
    for (const rel of WORKER_MODULES) {
      const content = fs.readFileSync(path.join(SERVER_ROOT, rel), 'utf8')
      expect(content, `${rel} must gate new Worker(...) on shouldRunWorkers()`).toContain(
        'shouldRunWorkers('
      )
    }
  })
})

describe('closeAllWorkers', () => {
  it('closes every entry even when one rejects', async () => {
    const closed: string[] = []
    const entries: WorkerEntry[] = [
      {
        name: 'a',
        close: async () => {
          closed.push('a')
        },
      },
      {
        name: 'b',
        close: async () => {
          throw new Error('boom')
        },
      },
      {
        name: 'c',
        close: async () => {
          closed.push('c')
        },
      },
    ]
    await expect(closeAllWorkers(entries)).resolves.toBeUndefined()
    expect(closed).toEqual(['a', 'c'])
  })
})

describe('initAllWorkers', () => {
  it('boots every eager entry and isolates a failed init', async () => {
    const inited: string[] = []
    const entries: WorkerEntry[] = [
      {
        name: 'boot-fail',
        init: async () => {
          throw new Error('down')
        },
        close: async () => {},
      },
      {
        name: 'boot-ok',
        init: async () => {
          inited.push('boot-ok')
        },
        close: async () => {},
      },
      // Lazy entry: no init, carries no boot state.
      { name: 'boot-lazy', close: async () => {} },
    ]
    initAllWorkers(entries)
    await vi.waitFor(() => {
      const status = getWorkerBootStatus()
      expect(status.failed).toBe(1)
      expect(status.running).toBe(1)
    })
    expect(inited).toEqual(['boot-ok'])
    const status = getWorkerBootStatus()
    expect(status.pending).toBe(0)
    expect(status.total).toBe(2)
  })
})

describe('the seal sees bullmq however it is obtained', () => {
  // The static check worked — a direct sixteenth module turned it red. The hole
  // was the classifier's `content.includes("from 'bullmq'")`: a module that
  // obtains BullMQ dynamically constructs an unwrapped Worker and the seal
  // stayed 6/6 green. `await import(…)` is idiomatic here, not exotic.
  it('catches a dynamic import constructing through a namespace', () => {
    const source = `
      import { getQueueRedis } from '@/lib/server/queue/redis-config'
      export async function sixteenth() {
        const bull = await import('bullmq')
        return new bull.Worker('critic-16th', async () => {}, { connection: getQueueRedis() })
      }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: true, constructs: true })
  })

  it('catches a static import constructing directly', () => {
    const source = `
      import { Worker } from 'bullmq'
      export const w = new Worker('q', async () => {}, {} as never)
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: true, constructs: true })
  })

  it('catches construction through the seam', () => {
    const source = `
      import { Queue } from 'bullmq'
      import { createQueueWorker } from '@/lib/server/queue/create-worker'
      export const w = createQueueWorker('q', async () => {}, {} as never)
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: true, constructs: true })
  })

  it('still classifies a type-only importer as type-only', () => {
    // Precision: widening the import detector must not turn every bullmq
    // mention into a construction site, or TYPE_ONLY_MODULES becomes unusable.
    const source = `
      import type { Job } from 'bullmq'
      export function handle(job: Job): void { void job }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: true, constructs: false })
  })

  it('ignores a file that does not touch bullmq at all', () => {
    const source = `
      export const w = new Worker('q')
      export async function f() { await import('ioredis') }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: true })
  })

  it('is not fooled by the string "bullmq" in a comment or literal', () => {
    const source = `
      // we deliberately avoid bullmq here: import { Worker } from 'bullmq'
      export const note = "from 'bullmq'"
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: false })
  })
})
