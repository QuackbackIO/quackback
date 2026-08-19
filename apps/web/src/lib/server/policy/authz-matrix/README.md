# Authorization matrix

A regression harness that pins **who can reach every authorization surface** in
the app — server functions, the public REST API, the MCP tools, and the SSE
stream — against every class of caller. It exists so that a change to one auth
path can't silently widen access on another.

The generated, reviewable output is [`MATRIX.md`](./MATRIX.md).

## Why it can't drift

Everything is derived from the **real code**, not a hand-kept list:

1. [`scan.ts`](./scan.ts) parses the source with the TypeScript AST and reads the
   authorization off every gate: the permission a `requireAuth` /
   `withApiKeyAuth` call enforces, the scope/role an MCP tool asserts, and any
   inline `isAdmin` / `isTeamMember` check in a route or function file.
2. [`classifications.ts`](./classifications.ts) supplies human intent for the
   sites a permission can't describe on its own — bare `requireAuth()` end-user
   actions, public REST reads, the `requireTeamAuth` alias, and inline checks
   (a real `SECONDARY_GATE` vs a `NOT_A_GATE` refinement behind an existing gate).
3. [`principals.ts`](./principals.ts) defines the nine caller classes, with each
   one's permissions resolved through the **same** runtime resolver a live
   request uses (`resolveActorPermissions`).
4. [`resolve.ts`](./resolve.ts) joins the scan against the classifications, and
   [`matrix.ts`](./matrix.ts) evaluates each surface against each class and
   renders `MATRIX.md`.

A widened gate changes what the scanner reads; a changed role preset changes
what a class holds. Either way the derived output moves, and the change shows up
as a diff in `MATRIX.md` for a reviewer to sign off on.

## The nine principal classes

`admin`, `member`, `portal_user`, `anon_widget`, `unverified_widget`,
`verified_widget`, `scoped_api_key`, `full_api_key`, `oauth_client`.

One collapse is encoded honestly rather than hidden:

- **Widget classes** (anon / unverified / verified) hold the same empty teammate
  permission set — they differ only in identity and the end-user policy layer
  (audience / segments), which the `policy/__tests__` modules cover.

**API-key scopes are enforced.** A key's authority is its owner's permission
set intersected with its stored scopes: MCP resolves a key's scopes from
storage and every tool asserts its scope, and REST maps each permission gate
onto the same scope vocabulary (`domains/api-keys/api-key-scopes.ts`) and
requires the mapped scope. The `scoped_api_key` class models a read-only key
through that mapping; `full_api_key` models a legacy key with NULL stored
scopes, which keeps full owner authority (deliberate back-compat).

## The CI gates

- **Completeness** (`__tests__/reconciliation.test.ts`) fails when a scanned
  gate has no expectation: an unparseable gate, an unclassified bare or inline
  site, or a stale classification with no live site. This catches a gate that
  was _widened or changed_.
- **Entry-point inventory** (`MATRIX.md` §4) pins every entry point that holds
  no `requireAuth` / `withApiKeyAuth` / `requireTeamAuth` gate. A gate that was
  never written can't be scanned, so this snapshot is what catches a _new route
  or function that forgot to gate_ — it shows up as a diff to review. Together
  the two cover issue #314's "CI fails when a new route/function/tool is added
  without an auth expectation."
- **Golden snapshot** (`__tests__/matrix.test.ts`) fails when `MATRIX.md` no
  longer matches the derived matrix, and asserts the per-class allow/deny
  outcomes directly.

The one thing still done by hand rather than pinned: the 136 ungated entry
points are listed but not individually attested as safe-to-be-public. Turning
that inventory into per-endpoint intent (`PUBLIC` / `PRE_AUTH` / `SIGNATURE` /
`DELEGATED`) is the natural next step.

## Adding coverage when you add a surface

Most of the time you do **nothing** — the scanner picks it up:

| You add…                                                                                             | What to do                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `requireAuth({ permission: PERMISSIONS.X })` or `withApiKeyAuth(req, { permission: PERMISSIONS.X })` | Nothing — the permission is the expectation.                                                                                                                                 |
| A bare `requireAuth()` (end-user action)                                                             | Add an `END_USER` entry to `BARE_GATE_CLASSIFICATIONS` keyed `file::surface`.                                                                                                |
| A bare `withApiKeyAuth(req)` public read                                                             | Add a `PUBLIC_DATA` entry.                                                                                                                                                   |
| An MCP tool                                                                                          | Nothing — declare `scope` (+ `teamOnly: true` if team-only) on its `registerTool` definition (per-branch `requireScope` / `requireTeamRole` in the handler is also scanned). |
| An inline `isAdmin` / `isTeamMember` in a route/function                                             | Classify it in `INLINE_CLASSIFICATIONS` as `SECONDARY_GATE` (a real access decision, with `roleBar: 'admin'                                                                  | 'team'`) or `NOT_A_GATE` (a refinement behind an existing gate), with a one-line rationale. |
| An entry point with **no** gate (a public read, webhook, or pre-auth flow)                           | Nothing to add, but `MATRIX.md` §4 gains a row — confirm in review that it's genuinely meant to be reachable without a gate.                                                 |

When a gate changes, run the suite; the completeness test names exactly what is
unclassified or stale. Then regenerate and review the snapshot:

```bash
bunx vitest run apps/web/src/lib/server/policy/authz-matrix -u
```

Treat the `MATRIX.md` diff as an access-control change, not a formality.
