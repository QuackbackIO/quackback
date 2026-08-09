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

  /**
   * `bullmq` itself, or anything beneath it.
   *
   * Exact equality missed a deep path — `from 'bullmq/dist/esm/classes/worker'`
   * resolves the same package and constructs a live, unwrapped `Worker`, one
   * import line away from the modules that already exist.
   */
  const isBullmqSpecifier = (spec: string): boolean =>
    spec === 'bullmq' || spec.startsWith('bullmq/')

  /**
   * Where a name in this file came from.
   *
   * `constructs` used to be purely name-based, which was harmless only while a
   * recognised bullmq import was a precondition for looking at the file at all.
   * Dropping that precondition — needed to catch the computed specifier — made
   * the NAME the whole test, so `node:worker_threads`, a `Worker` from any
   * other package, and a locally declared `class Worker {}` were all reported
   * as unadjudicated BullMQ construction.
   *
   * That direction matters more than its zero live exposure, because every
   * remedy available to whoever tripped it degrades the seal: adding a
   * worker_threads helper to WORKER_MODULES makes it a queue module that must
   * gate on `shouldRunWorkers()`, adding it to TYPE_ONLY_MODULES asserts it is
   * type-only when it demonstrably constructs, and widening an exclusion list
   * erodes the chokepoint. A seal that false-positives gets disabled.
   *
   * So provenance decides, and the tie-break is deliberate: a name is only
   * DISMISSED when the file demonstrably binds it to something that is not
   * bullmq. An unresolvable binding — a dynamic `import()` of a computed
   * specifier — stays flagged, which is exactly the spelling that hides an
   * import while leaving the construction in plain sight.
   */
  type Origin = 'bullmq' | 'non-bullmq' | 'unresolvable' | 'local'
  const origins = new Map<string, Origin>()

  const specifierOrigin = (spec: string): Origin =>
    isBullmqSpecifier(spec) ? 'bullmq' : 'non-bullmq'

  /** The dynamic `import(...)` inside an initializer, if there is one. */
  const dynamicImportOf = (expr: ts.Expression): ts.CallExpression | null => {
    let found: ts.CallExpression | null = null
    const walk = (n: ts.Node): void => {
      if (found) return
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        found = n
        return
      }
      ts.forEachChild(n, walk)
    }
    walk(expr)
    return found
  }

  /**
   * Record an origin, never downgrading a flagged one.
   *
   * Two scopes can bind the same name — `const bull = await import('bullmq')`
   * in one function and `const bull = await import('ioredis')` in another — and
   * last-write-wins would let the innocent one excuse the other. Evidence that
   * a name COULD be bullmq is not erased by evidence that some other binding of
   * it is not.
   */
  const recordOrigin = (name: string, origin: Origin): void => {
    const existing = origins.get(name)
    if (existing === 'bullmq' || existing === 'unresolvable') return
    origins.set(name, origin)
  }

  /**
   * Bindings are collected from the WHOLE file, not just its top level.
   *
   * `const bull = await import(...)` lives inside a function in every idiomatic
   * spelling — the queue modules all dynamic-import that way. A top-level-only
   * sweep left such a name with no recorded origin at all, which happens to
   * flag it, so the "unresolvable stays flagged" case passed for entirely the
   * wrong reason and could not fail when that rule was inverted.
   */
  const collectBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (!node.initializer) {
        recordOrigin(node.name.text, 'local')
      } else {
        const dyn = dynamicImportOf(node.initializer)
        if (!dyn) {
          recordOrigin(node.name.text, 'local')
        } else {
          const arg = dyn.arguments[0]
          recordOrigin(
            node.name.text,
            arg && ts.isStringLiteral(arg) ? specifierOrigin(arg.text) : 'unresolvable'
          )
        }
      }
    }
    if (ts.isClassDeclaration(node) && node.name) recordOrigin(node.name.text, 'local')
    if (ts.isFunctionDeclaration(node) && node.name) recordOrigin(node.name.text, 'local')
    ts.forEachChild(node, collectBindings)
  }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const origin = specifierOrigin(stmt.moduleSpecifier.text)
      const clause = stmt.importClause
      if (clause?.name) recordOrigin(clause.name.text, origin)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) recordOrigin(bindings.name.text, origin)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) recordOrigin(el.name.text, origin)
      }
      continue
    }
  }
  collectBindings(sf)

  /** The identifier a `new X(...)` / `new a.b.Worker(...)` is rooted at. */
  const rootName = (expr: ts.Expression): string | null => {
    let cur: ts.Expression = expr
    for (;;) {
      if (ts.isParenthesizedExpression(cur)) cur = cur.expression
      else if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression
      else if (ts.isPropertyAccessExpression(cur)) cur = cur.expression
      else if (ts.isElementAccessExpression(cur)) cur = cur.expression
      else break
    }
    return ts.isIdentifier(cur) ? cur.text : null
  }

  /** Dismiss only what the file demonstrably binds to something else. */
  const couldBeBullmq = (expr: ts.Expression): boolean => {
    const root = rootName(expr)
    if (root === null) return true
    const origin = origins.get(root)
    return origin !== 'local' && origin !== 'non-bullmq'
  }

  const visit = (node: ts.Node): void => {
    // import … from 'bullmq' (or 'bullmq/…')
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isBullmqSpecifier(node.moduleSpecifier.text)
    ) {
      imports = true
    }
    // await import('bullmq') / import('bullmq/…')
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      isBullmqSpecifier(node.arguments[0].text)
    ) {
      imports = true
    }
    // new Worker(…) or new bull.Worker(…), unless the name demonstrably came
    // from somewhere that is not bullmq.
    if (ts.isNewExpression(node)) {
      const ctor = node.expression
      if (ts.isIdentifier(ctor) && ctor.text === 'Worker' && couldBeBullmq(ctor)) constructs = true
      if (
        ts.isPropertyAccessExpression(ctor) &&
        ctor.name.text === 'Worker' &&
        couldBeBullmq(ctor.expression)
      ) {
        constructs = true
      }
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

/**
 * lib/server files touching bullmq, split by whether they construct a Worker.
 *
 * A file is adjudicated if it imports bullmq **or** constructs a `Worker` at
 * all. Requiring a recognised import let a computed specifier
 * (`const SPEC = 'bull' + 'mq'`) hide the import while the construction stayed
 * in plain sight — and construction is the thing the seal is actually about, so
 * proving where the class came from should never have been a precondition for
 * asking about it.
 */
export function adjudicate(files: Array<{ rel: string; imports: boolean; constructs: boolean }>): {
  constructing: string[]
  typeOnly: string[]
} {
  const constructing: string[] = []
  const typeOnly: string[] = []
  for (const { rel, imports, constructs } of files) {
    if (!imports && !constructs) continue
    if (WORKER_FACTORY_MODULES.includes(rel)) continue
    ;(constructs ? constructing : typeOnly).push(rel)
  }
  return { constructing: constructing.sort(), typeOnly: typeOnly.sort() }
}

function bullmqImporters(): { constructing: string[]; typeOnly: string[] } {
  const files: Array<{ rel: string; imports: boolean; constructs: boolean }> = []
  for (const full of walkSourceFiles(SERVER_ROOT)) {
    if (!full.endsWith('.ts')) continue
    const rel = path.relative(SERVER_ROOT, full).split(path.sep).join('/')
    files.push({ rel, ...classifyBullmqUsage(fs.readFileSync(full, 'utf8')) })
  }
  return adjudicate(files)
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

  it('ADJUDICATION: a construction with no recognisable import is still listed', () => {
    // The gate, separated from the classifier so it can be tested without a
    // file on disk. The classifier assertion below says the computed-specifier
    // spelling yields `{imports:false, constructs:true}` — that pins the
    // CLASSIFIER. It says nothing about whether the seal then looks at such a
    // file, and reverting the gate to `if (!imports) continue` left the whole
    // suite green because the real tree contains no such file. This is the
    // assertion that actually fails when the gate narrows.
    expect(
      adjudicate([{ rel: 'domains/export/computed.ts', imports: false, constructs: true }])
    ).toEqual({ constructing: ['domains/export/computed.ts'], typeOnly: [] })
  })

  it('ADJUDICATION: a type-only importer is still listed as type-only', () => {
    expect(
      adjudicate([{ rel: 'events/handlers/email.ts', imports: true, constructs: false }])
    ).toEqual({ constructing: [], typeOnly: ['events/handlers/email.ts'] })
  })

  it('ADJUDICATION: a file touching neither is not listed at all', () => {
    expect(adjudicate([{ rel: 'db.ts', imports: false, constructs: false }])).toEqual({
      constructing: [],
      typeOnly: [],
    })
  })

  it('ADJUDICATION: the seam is excluded even though it constructs', () => {
    expect(
      adjudicate([{ rel: 'queue/create-worker.ts', imports: true, constructs: true }])
    ).toEqual({ constructing: [], typeOnly: [] })
  })

  it('reports a Worker construction even with no recognisable bullmq import', () => {
    // `constructs` alone is enough for the seal to demand adjudication, which
    // is what closes the computed-specifier spelling above. Note the dynamic
    // import here is of an unrelated package and binds nothing called Worker,
    // so it neither excuses nor explains the construction.
    const source = `
      export const w = new Worker('q')
      export async function f() { await import('ioredis') }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: true })
  })

  it('ignores a file that touches neither', () => {
    // The precision floor for widening the gate to `imports || constructs`:
    // an ordinary server module must still be invisible to the seal.
    const source = `
      import { db } from '@/lib/server/db'
      export const count = async () => (await db.select()).length
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: false })
  })

  it('catches a deep path into the package', () => {
    // The one that mattered: exact-equality on the specifier missed
    // `bullmq/dist/esm/classes/worker`, which resolves the same package and
    // constructs a live, unwrapped Worker. One import line away from the
    // fifteen modules that already exist.
    const source = `
      import { Worker } from 'bullmq/dist/esm/classes/worker'
      export const w = new Worker('q', async () => {}, {} as never)
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: true, constructs: true })
  })

  it('catches a computed specifier by the construction it cannot hide', () => {
    // `const SPEC = 'bull' + 'mq'` defeats every specifier rule, so the import
    // is genuinely invisible — `imports` is false and stays false. What is not
    // invisible is `new bull.Worker(...)`, and the seal adjudicates on either,
    // so the file is still forced into a list.
    const source = `
      const SPEC = 'bull' + 'mq'
      export async function sixteenth() {
        const bull = await import(SPEC)
        return new bull.Worker('q', async () => {}, {} as never)
      }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: true })
  })

  it('does NOT flag node:worker_threads', () => {
    // The fix has two directions and this is the one that is easy to forget.
    // Dropping the import precondition made the NAME the whole test, and
    // `node:worker_threads` is an ordinary thing to reach for in server code.
    // Every remedy available to whoever tripped this degrades the seal:
    // WORKER_MODULES would make it a queue module that must gate on
    // shouldRunWorkers(), TYPE_ONLY_MODULES would assert it is type-only when
    // it demonstrably constructs, and an exclusion list erodes the chokepoint.
    const source = `
      import { Worker } from 'node:worker_threads'
      export function spawn(script: string) { return new Worker(script, { eval: true }) }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: false })
  })

  it('does NOT flag a Worker reached through another package', () => {
    const source = `
      import * as sdk from 'ioredis'
      export function make() { return new (sdk as unknown as { Worker: new (n: string) => object }).Worker('x') }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: false })
  })

  it('does NOT flag a locally declared class that happens to be called Worker', () => {
    // The sharpest of the three: a file that never mentions bullmq, imports
    // nothing at all, and instantiates its own class.
    const source = `
      class Worker { constructor(readonly name: string) {} }
      export const w = new Worker('local')
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: false })
  })

  it('DOES flag a name it cannot resolve — dismissal requires evidence', () => {
    // The tie-break. A name is dismissed only when the file demonstrably binds
    // it to something that is not bullmq; an unresolvable binding stays
    // flagged, which is precisely the computed-specifier spelling.
    const source = `
      const SPEC = 'bull' + 'mq'
      export async function f() {
        const bull = await import(SPEC)
        return new bull.Worker('q', async () => {}, {} as never)
      }
    `
    expect(classifyBullmqUsage(source)).toEqual({ imports: false, constructs: true })
  })

  it('DOES flag a bare `new Worker(...)` with no binding in the file', () => {
    // No import, no local declaration — nothing to dismiss it with, so it is
    // still adjudicated rather than assumed innocent.
    const source = `export const w = new Worker('q', async () => {}, {} as never)`
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
