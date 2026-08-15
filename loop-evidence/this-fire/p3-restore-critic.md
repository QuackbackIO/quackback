# PASS — restore at 3-Free stays on the dashboard with a notice, not raw JSON

Independent live critic 2026-08-15T18:01Z. Exercised `https://cp.quackback.co.uk` deploy `9030705d` (`sha256:d84fd27c2d2d10ffba14a36b732540d462d396cd5f34a3102a962a9a40928741`, sfo) from CP `c208c06` (`fix(create): keep restore refusals on the dashboard`). App pair unchanged `7057e905` / `sha256:27c538ec…`. Did not deploy, pay, create Neon, start custom domains, wipe a real workspace, merge, or change `ownerEmail`. Temps `inst_p3cap_*` had no provision; leftover after = 0. Instances **20→20**.

## 1. Live image

`railway deployment list` on control-plane `f06ac2e2`:

| field              | value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| id                 | `9030705d-f750-4029-b6cf-8887f95b3bb8`                                    |
| status             | **SUCCESS**                                                               |
| `meta.imageDigest` | `sha256:d84fd27c2d2d10ffba14a36b732540d462d396cd5f34a3102a962a9a40928741` |
| `meta.cliMessage`  | keep restore refusals on the dashboard                                    |
| regions            | `sfo` only                                                                |
| created            | 2026-08-15T17:37:36.902Z                                                  |

Health 200 `role=web`: gauntlet, `sup9ca3a708`.

## 2. Unauthenticated restore is still a 303, not JSON

| Call                                                       | Result                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| POST `/api/instances/t1a/restore` no cookie                | **303** `https://cp.quackback.co.uk/auth/login`, empty body, not JSON |
| GET `/dashboard?notice=free_workspace_owner_cap` no cookie | **307** `/login`, not JSON                                            |

## 3. Restore at the 3-Free cap stays on the list

t7s owner (`guerrillamailblock.com`, live-Free **1**). Two live Free temps + one soft-deleted temp in the same org (no Neon). Session minted from the existing mailbox magic link (`/verify-magic-link` → `__Secure-better-auth.session_token`).

| Call                                                    | Result                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/instances/<trash>/restore` with owner cookie | **303** `https://cp.quackback.co.uk/dashboard?notice=free_workspace_owner_cap`                                                        |
| Body                                                    | empty, **not** `{"error":…,"status":402}`                                                                                             |
| Follow GET that Location                                | **200** `text/html`                                                                                                                   |
| Page                                                    | `Your workspaces`, `role="alert"`, copy **“You already own 3 live Free workspaces. Delete one or upgrade one to a paid plan first.”** |
| Trash row                                               | still `deleted_at` set (restore did not apply)                                                                                        |

t1a / t1e / t7s / t7h still present. No leftover `inst_p3cap_*`.
