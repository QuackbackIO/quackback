# Module-scope mutable state

The §4.4 scanner. A third source-scanning policy invariant beside `dep-graph`
and `authz-matrix`, with the same shape: derive from the tree, reconcile against
a checked-in golden, fail CI on any difference.

| file                             | what it is                                                            |
| -------------------------------- | --------------------------------------------------------------------- |
| `scan.ts`                        | finds every module-scope mutable-state site, via the TypeScript AST   |
| `ledger.ts`                      | the decision record: one entry per site, with a category and a reason |
| `check.ts`                       | reconciles the two, and tests the categories it can test              |
| `MODULE-STATE.md`                | generated golden snapshot                                             |
| `__tests__/scan.test.ts`         | the adversarial corpus — what the scanner must and must not see       |
| `__tests__/module-state.test.ts` | the gate itself                                                       |

## Why this exists rather than "we fixed the twenty"

Module-scope mutable state is what survives a request. In a pooled process that
also means it survives a **workspace**, so every such site is either workspace-keyed,
holds nothing workspace-derived, or is a cross-workspace capability nobody wrote down.
`SAAS-HOSTING-STACK.md` §4.4 rates this control above the twenty fixes it
accompanies, and the reasoning is one line: _"without it, singleton twenty-one
lands three weeks after twenty is fixed."_

The scanner earned that billing on its first run. It found
`auth/resolved-claims-stash.ts`, which is not on §4's hand-written list and is
the same class as the entry heading it: a stash of freshly-validated IdP claims
keyed by `providerId + accountId`, where neither half is unique across
workspaces, feeding role provisioning.

## What counts as a site

Five shapes, because a rule that only knows about top-level `let` is trivially
routed around.

| kind            | shape                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `binding`       | module-scope `let` / `var`                                                                                                        |
| `container`     | module-scope `const` bound to a mutable container **that is actually mutated**                                                    |
| `factory`       | module-scope `const` bound to a call of a function — local **or imported from a scanned module** — that closes over mutable state |
| `instance`      | module-scope `new X(...)`, unless `X` is an enumerated value type                                                                 |
| `class-static`  | a mutable `static` field on a module-scope class **or class expression**                                                          |
| `global-assign` | assignment to `globalThis.x` / `global.x`                                                                                         |

### Six bypasses, found by attacking round 1

Every one of these produced **no site** in the first version, and three were
then planted as a real file in server code with the gate still green — one
containing §4.1's top-listed hazard verbatim. They are pinned in
`__tests__/scan.test.ts` under _"bypasses found by attacking the first version
of this scanner"_.

| shape                                                       | why it slipped                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Object.freeze({ m: new Map() })`, written via `X.m.set(…)` | freezing is shallow, and the mutation matcher only knew identifiers, not property chains |
| `const c = new Lru()` (local class holding a `Map`)         | `new` was only a site for `Map`/`Set`                                                    |
| `const s = makeStash()` where `makeStash` is **imported**   | the callee was resolved from `sf.statements` only                                        |
| `const R = class { static seen = new Map() }`               | the class-static rule matched declarations, not expressions                              |
| `const alias = backing; alias.set(…)`                       | `backing` read as never-written, so it was suppressed as frozen                          |
| `Object.assign(state, …)` as the only write                 | nothing about it looks like `x.y = …`                                                    |

The `Object.freeze` one is the sharpest, because it is the exact class the
suppression story rests on: 80 of 97 constructed containers are dropped as
"nothing writes to it", and this is the spelling that makes a write look like a
constant.

`new X(...)` becoming a site on its own is what closes the second row without
needing to know what a constructor does. It costs five ledger lines — including
`AsyncLocalStorage`, the store that carries workspace identity, and the `db`
`Proxy` — and the exemption list (`PURE_CONSTRUCTORS`, plus any `Intl.*`) is
short, enumerated, and restricted to types that cannot carry state.

### The ~45 frozen constants are not reported at all

§4 counts "about 45 other module-scope `Set`/`Map` instances [that] are frozen
constants and are safe". They are not state; they are a lookup table spelled
with `new Set`. Reporting them would mean 45 ledger lines that say nothing, and
a ledger nobody reads is a ledger that gets a real entry appended to it
unnoticed.

So a container is a site only if something **mutates** it, and the scanner
decides that from the source rather than from a label — mutating method calls,
property assignment, increment, `delete`, searched in the declaring file and
repo-wide for an exported binding. Add a `.set()` to a constant and it becomes a
ledgered site on the next CI run.

## The categories, and which ones are verified

The cheap way to defeat a ledger is to write the reassuring word next to the
dangerous code. Three of the six categories are therefore checked against the
source.

| category               | meaning                                                                                       | verified?                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `workspace-keyed`      | partitioned by the active workspace                                                           | **yes** — initializer must be `new WorkspaceKeyedCache`                                                    |
| `workspace-scoped-key` | keyed by something that already identifies one workspace                                      | **yes** — `keyedBy` must name a token present in the file                                                  |
| `refuses-pooled`       | only correct single-workspace, and the code refuses to run pooled                             | **yes** — must import `isPooledTenancy` from `tenancy/mode` (or read `config.isPooledTenancy`), unshadowed |
| `content-addressed`    | the value is a function of the key, so a cross-workspace hit is byte-identical to a recompute | no                                                                                                         |
| `fleet-wide`           | holds only values identical for every workspace                                               | no                                                                                                         |
| `process-lifetime`     | a latch, a timer, a connection handle                                                         | no                                                                                                         |

`refuses-pooled` started as `text.includes('isPooledTenancy')` and was defeated
on the first attack: swapping the import for a local
`const isPooledTenancy = (): boolean => false` leaves the string in the file and
the check green while the guard is gone. Certification by mention, the same
shape as Piece 5's unconditional-witness helper. It is now structural, with five
cases pinning it — including an import of the same name from a different module.

What the check still does not prove is that the guard covers the _site_. That
claim lives where it can be observed: `__tests__/singletons-not-shared.test.ts`
asserts the relay does not attempt leadership under pooled tenancy and the
readiness probe never reads the migration status.

## Why the TypeScript AST and not a regex

Piece 5's `Vary: Host` guard and Piece 3's migration linter were both attacked
through their tokenizers — braces inside strings, comments eating line content,
template literals, a dollar-quoted string with an unbalanced apostrophe.
`dep-graph/scan.ts` already made the right call for the same reason. With a
parser those bypasses do not exist rather than being defended against: a `let`
inside a string is a string, a `{` inside a template literal is a character, and
a commented-out declaration is trivia. `__tests__/scan.test.ts` asserts each
anyway, because a structural claim still deserves a witness.

## Adding an entry

Run the suite; the failure names the site. Then classify it honestly.

If the honest category is `process-lifetime`, `fleet-wide` or
`content-addressed`, the reason must say **what a cross-workspace hit would return
and why that is the same thing the requesting workspace would have computed**. If
you cannot write that sentence, the answer is a `WorkspaceKeyedCache`.

Regenerate `MODULE-STATE.md` by running the suite and copying the rendered doc
(`renderLedgerDoc`) — it is a golden, so a content change is a visible diff and
a reviewer can see the ledger did not quietly widen.

## Scope

`SERVER_ROOTS` in `check.ts`. `lib/shared` is included deliberately: server code
imports it, so a `let` declared there and re-exported through a server module
would be module-scope state the scanner never saw — the "re-exported state"
bypass. `components/` and `lib/client` are excluded, because module-scope state
in a browser bundle lives in one user's tab.

## Known limits

- **Mutation is matched by name, not by symbol.** A same-named local inside
  another function counts as a mutation. The direction is safe (a spurious
  ledger line, never a missed site), and resolving symbols would mean a full
  type-checker pass on every CI run. Cross-file mutation is restricted to files
  that actually import the name.
- **Factory resolution follows first-party imports only.** A callee from
  `node_modules` cannot be analysed, which is why `new X(...)` is a site on its
  own rather than a judgement about what the constructor does. A plain _call_
  into a third-party module (`logger.child(...)`) is still not a site — there
  are hundreds of those and flagging them would drown the ledger.
- **Two initializer spellings still miss**, with zero live instances of either:
  `(0, makeStash)()` and `{ ...makeStash() }`. Recorded rather than chased —
  each round's remainder has been narrower and further from real code, and
  precision has stayed clean throughout.
- **The three unverified categories are human claims.** The ledger makes them
  visible and reviewable; it does not make them true. That is what the reason
  field and the golden diff are for.
- **A computed global key is not seen.** `globalThis[expr] = new Map()`, where
  `expr` is anything but a string or template literal, produces no site. This is
  a silent recall hole and it is deliberate: the site would have to be named
  `globalThis.<unknown>`, which could never be reconciled against the ledger, so
  the entry would be permanently either stale or unledgered — worse than a miss.
  The literal forms (`globalThis.x`, `globalThis['x']`, ``globalThis[`x`]``)
  all collapse to one site id and are covered.
- **A factory whose state escapes through something other than a returned
  function or object is not seen.** The return-shape rule exists so that
  `findAppDir()` — a `let` walking up a directory tree, returning a string —
  does not bury the four real instances. A factory that stashes its closure
  somewhere else on the way out would slip through.
