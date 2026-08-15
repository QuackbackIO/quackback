# PASS — live restore at 3 Free is 402 `free_workspace_owner_cap`; switcher list fail-closed.

Independent of the builder session. No payment, no Neon, no deploy, no wipe of t1a/t1e/t7. Named critic spawn unjoinable; orchestrator re-exercised live.

## Pair

- App web `932a38f9` `sha256:895b942d…` region only `us-east4-eqdc4a` (source.image + `multiRegionConfig`).
- CP `7cecf06d` sfo.
- Five ready URLs **200** `role=web` (gauntlet, south, north, sup, hc).

## Switcher

| Call                                              | Result                                         |
| ------------------------------------------------- | ---------------------------------------------- |
| GET `/api/v1/internal/workspaces` no/dummy bearer | **401** `unauthorized`                         |
| GET list t7s                                      | **200**, 0 siblings (t7s/t7h different owners) |
| POST open extras                                  | **400** `Invalid input`                        |
| POST open t1a / t7h from t7s                      | **403** `not_owner`                            |
| GET list at 3 live Free (temps)                   | **200**, 2 siblings, no `ws-*` URL             |

## Restore-at-cap (temps, no Neon)

t7s owner live-Free **1**. Two live temps + one trash → live-Free **3**. `_internal_restoreInstance` **402** `free_workspace_owner_cap`; trash `deleted_at` still set. Soft-delete one live temp → live-Free **2**. Temps deleted.

Instances **19→19**. Leftover `inst_cap8a_*` **0**. Fixtures remain.

`loop-evidence/this-fire/t8a-restore-critic.json`.
