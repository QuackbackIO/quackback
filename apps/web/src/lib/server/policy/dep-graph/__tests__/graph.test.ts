import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  buildPackageGraph,
  buildBucketGraph,
  buildDomainGraph,
  stronglyConnectedComponents,
  renderGraphDoc,
} from '../graph'
import { scanTree } from '../scan'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src
const REPO_ROOT = join(SRC_ROOT, '../../..')

const srcFiles = scanTree(SRC_ROOT)
const packages = buildPackageGraph(REPO_ROOT, { 'apps/web': srcFiles })
const buckets = buildBucketGraph(srcFiles)
const domains = buildDomainGraph(srcFiles)

describe('stronglyConnectedComponents', () => {
  it('finds multi-node components and drops singletons', () => {
    const edges = new Map<string, Set<string>>([
      ['a', new Set(['b'])],
      ['b', new Set(['a', 'c'])],
      ['c', new Set(['d'])],
      ['d', new Set(['e'])],
      ['e', new Set(['c'])],
      ['f', new Set(['a'])],
    ])
    expect(stronglyConnectedComponents(['a', 'b', 'c', 'd', 'e', 'f'], edges)).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e'],
    ])
  })

  it('returns no components for an acyclic graph', () => {
    const edges = new Map<string, Set<string>>([
      ['a', new Set(['b', 'c'])],
      ['b', new Set(['c'])],
    ])
    expect(stronglyConnectedComponents(['a', 'b', 'c'], edges)).toEqual([])
  })
})

describe('workspace package graph', () => {
  // Node and edge content is pinned by the GRAPH.md snapshot; only the
  // invariants that must hold regardless of content are asserted here.
  it('HARD RULE: no package imports app code', () => {
    expect(packages.violations).toEqual([])
  })

  it('the package graph is acyclic', () => {
    const edges = new Map<string, Set<string>>()
    for (const e of packages.edges) {
      if (!edges.has(e.from)) edges.set(e.from, new Set())
      edges.get(e.from)!.add(e.to)
    }
    expect(stronglyConnectedComponents(packages.nodes, edges)).toEqual([])
  })
})

describe('src bucket graph', () => {
  it('includes the expected top-level buckets', () => {
    for (const b of ['(root)', 'components', 'lib/client', 'lib/server', 'lib/shared', 'routes']) {
      expect(buckets.nodes, b).toContain(b)
    }
  })

  it('records known-real edges: routes -> components and components -> lib/server', () => {
    // components -> lib/server is the TanStack Start server-function pattern;
    // the snapshot records it as reality, not a violation.
    expect(buckets.edges).toContainEqual({ from: 'routes', to: 'components' })
    expect(buckets.edges).toContainEqual({ from: 'components', to: 'lib/server' })
  })

  it('every edge endpoint is a node and self-edges are omitted', () => {
    for (const e of buckets.edges) {
      expect(buckets.nodes).toContain(e.from)
      expect(buckets.nodes).toContain(e.to)
      expect(e.from).not.toBe(e.to)
    }
  })
})

describe('server domain graph', () => {
  it('includes known domains', () => {
    for (const d of ['posts', 'users', 'settings', 'boards']) {
      expect(domains.nodes, d).toContain(d)
    }
  })

  it('every edge endpoint is a node and self-edges are omitted', () => {
    expect(domains.edges.length).toBeGreaterThan(0)
    for (const e of domains.edges) {
      expect(domains.nodes).toContain(e.from)
      expect(domains.nodes).toContain(e.to)
      expect(e.from).not.toBe(e.to)
    }
  })

  it('cycles listed are exactly the multi-node SCCs of the edge set', () => {
    const edges = new Map<string, Set<string>>()
    for (const e of domains.edges) {
      if (!edges.has(e.from)) edges.set(e.from, new Set())
      edges.get(e.from)!.add(e.to)
    }
    expect(domains.cycles).toEqual(stronglyConnectedComponents(domains.nodes, edges))
  })
})

describe('golden graph document', () => {
  it('matches the committed GRAPH.md snapshot', async () => {
    const doc = renderGraphDoc(packages, buckets, domains)
    await expect(doc).toMatchFileSnapshot(join(__dirname, '../GRAPH.md'))
  })
})
