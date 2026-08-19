# Dependency-graph snapshot

A regression harness that pins the codebase's **import graph** at three
altitudes, so that during long build phases a new dependency edge or a new
cycle shows up as a red CI diff a human must adjudicate. It is the structural
sibling of [`../authz-matrix`](../authz-matrix): snapshot-what-is, not an
aspirational lint. If an edge exists today it is in the snapshot; the test
only fails on **change**.

The generated, reviewable output is [`GRAPH.md`](./GRAPH.md).

## The three altitudes

1. **Workspace packages** (`apps/web` + `packages/*`). Edges carry their
   evidence: `declared` (a `workspace:*` dependency in package.json),
   `imported` (an `@quackback/*` specifier actually appears in the source),
   or both. One invariant is a hard test rule rather than a snapshot line:
   **no package imports app code** (no `@/` alias, no `apps/` specifier, no
   relative path escaping its own workspace).
2. **`apps/web/src` buckets**: the top-level directories, with `lib` split
   into `lib/client` / `lib/server` / `lib/shared`, and root-level files
   (`router.tsx`, `server.ts`, ...) as `(root)`. The snapshot records the
   bucket-to-bucket adjacency as it is. In particular `components ->
lib/server` is the legitimate TanStack Start server-function pattern, not
   a violation.
3. **Server domains** (`lib/server/domains/<domain>`): domain-to-domain
   import edges, plus the strongly connected components of that graph listed
   under a **Cycles** heading. An existing cycle is recorded, not fixed; a
   new one is a visible diff.

## What counts as an edge

[`scan.ts`](./scan.ts) parses every non-test `.ts`/`.tsx` file with the
TypeScript AST (no type-checker; the whole tree scans in about 1.5s) and
extracts:

- static `import ... from 'x'`, **including type-only imports** (a type
  dependency is still compile-time coupling)
- `export ... from 'x'` re-exports
- dynamic `import('x')` with a string-literal argument; non-literal dynamic
  imports cannot be resolved statically and are skipped

The `@/` alias resolves to `apps/web/src`, `@quackback/*` to the workspace
packages, and Vite query suffixes (`?url`, `?raw`) are stripped. Bare npm
specifiers are ignored. Self-edges are omitted at every altitude.
`__tests__`, `*.test.*`, `dist`, and `node_modules` are never scanned.

[`graph.ts`](./graph.ts) builds the three graphs, computes strongly
connected components (Tarjan, fully deterministic ordering), and renders
`GRAPH.md` stable-sorted so diffs stay minimal.

## The CI gate

`__tests__/graph.test.ts` regenerates the document from the live tree and
compares it to the committed `GRAPH.md`; a mismatch fails with the diff. It
also asserts the hard rules directly: the package-graph invariant above, an
acyclic package graph, and that the listed cycles are exactly the multi-node
SCCs. `__tests__/scan.test.ts` pins the extraction rules on synthetic
snippets so the scanner itself cannot drift silently.

## When the test goes red

You added, removed, or moved an import across a boundary. Decide whether the
new edge (or cycle) is intended; if it is, regenerate and commit the diff:

```bash
bunx vitest run apps/web/src/lib/server/policy/dep-graph -u
```

Treat the `GRAPH.md` diff as an architecture change, not a formality. A new
entry under **Cycles** deserves particular scrutiny: cycles are recorded when
they already exist, but adding one should be a deliberate decision.
