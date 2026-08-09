import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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

/** lib/server files importing bullmq, split by whether they construct a Worker. */
function bullmqImporters(): { constructing: string[]; typeOnly: string[] } {
  const constructing: string[] = []
  const typeOnly: string[] = []
  for (const full of walkSourceFiles(SERVER_ROOT)) {
    const content = fs.readFileSync(full, 'utf8')
    if (!content.includes("from 'bullmq'")) continue
    const rel = path.relative(SERVER_ROOT, full).split(path.sep).join('/')
    if (WORKER_FACTORY_MODULES.includes(rel)) continue
    const constructs = content.includes('new Worker') || /\bcreateQueueWorker\s*[(<]/.test(content)
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
