# PASS — per-owner 3-Free cap `c5a484d`; focused tests 35/35.

Not deployed. Artifact is CP `saas` `c5a484d`. No live create.

## Tests

```
bun test src/lib/server/functions/__tests__/instance-fn.test.ts \
  src/lib/server/functions/__tests__/create-without-a-plan.test.ts
```

35 pass, 0 fail, 101 expect() calls.

## Bar

- 1–3 Free succeed (`per-owner Free workspace cap`, `create-without-a-plan`)
- 4th Free 402 `free_workspace_owner_cap`, no insert, no plan picker
- Paid owner can create another (paid omitted from count)
- Delete/upgrade frees a slot (count drops)
- Trial is Free (`countsTowardFreeWorkspaceCap`)
- Count is `ownerEmail` via `countLiveFreeOwnedBy`
- Create path still has no checkout / plan picker
