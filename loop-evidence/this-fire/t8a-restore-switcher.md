# Builder — live 8a restore-at-cap + switcher list

Facts: `t8a-restore-switcher.json`. No payment, no Neon, no deploy, no wipe of real rows.

Live pair unchanged: app `932a38f9` / `sha256:895b942d…` `us-east4-eqdc4a`; CP `7cecf06d`. Instances **19→19**. Leftover `inst_cap8a_*` **0**. t1a Pro paid, t1e Growth paid.

t7 support and t7 HC are **different** owners (both `guerrillamailblock.com`). They are not siblings.

| Probe                                             | Result                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET `/api/v1/internal/workspaces` no/dummy bearer | **401** `unauthorized`                                                                      |
| GET list from t7s / t7h                           | **200**, 0 siblings                                                                         |
| POST open extras                                  | **400**                                                                                     |
| POST open t1a or t7h from t7s                     | **403** `not_owner`                                                                         |
| GET list after two same-owner live temps          | **200**, 2 siblings, `Untitled workspace`, no `ws-*` URL                                    |
| t7s live-Free                                     | 1 → 3 (temps) → restore trash **402** `free_workspace_owner_cap` → soft-delete one temp → 2 |
| Product ready on `sup9ca3a708`                    | **200** `role=web`                                                                          |
