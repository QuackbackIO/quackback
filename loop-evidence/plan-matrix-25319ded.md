# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `c5d64208` / `sha256:25319ded…` `us-east4-eqdc4a` and CP `1931dc38`
/ `sha256:79030f27…` (`64ca931`). Exercised via the same-fire Verify
sweep (`sweep-25319ded.md` / `sweep.json`). No payment, no Neon,
instances 17→17.

Fixtures: t1a Growth paid; t1e Pro trial. No unpaid Free `ws-*`. No Scale
host. No canceled host. Self-host not re-walked.

## Authority (live)

| Layer                            | Result                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| CP catalogue vs `definitions.ts` | Live `GET /catalogue` 200: four plans; annualDiscountMonths=2.                         |
| Growth grant vs feature          | Overlay t1a `webhooks=true` `sso=false` `workflows=false`. Matches Growth grants.      |
| Overlay, no stored row           | t1a `maxBoards=3` `maxTeamSeats=1` `maxPosts=50`; t1e `10`/`10`/`null`. Not unlimited. |

Website marketing copy still lists older unlimited-post / uncapped-seat
stickers. Workspace cards use the CP catalogue (aligned). Recorded, not a
workspace HIGH.

## Matrix (wired keys)

`S` = skipped (unwired, no fixture, or not at cap). `L` = agreed.

| State × key                                                                  | UI                                      | Server                    | Signal       |
| ---------------------------------------------------------------------------- | --------------------------------------- | ------------------------- | ------------ |
| Growth t1a `maxBoards` 3                                                     | Usage `N of M` on billing               | 1 of 3, not at cap        | L            |
| Growth t1a `maxPosts` 50                                                     | Usage card lists finite keys            | 1 of 50                   | L            |
| Growth t1a `maxTeamSeats` 1                                                  | Members 200                             | 1 of 1                    | L            |
| Growth t1a status/roles/sending/AI                                           | not at cap                              | not at cap                | S            |
| Growth t1a `apiRequests*`                                                    | unwired                                 | skip                      | S            |
| Growth t1a `customDomain`                                                    | HC local writer absent                  | provider skipped          | S (provider) |
| Growth t1a `sso`                                                             | `/new` 200                              | entitlements `sso=false`  | L            |
| Growth t1a `webhooks` / `mcpServer`                                          | grant yes                               | overlay entitlements true | L            |
| Trial t1e = Pro numbers                                                      | overlay Pro                             | boards 10, workflows true | L            |
| Trial t1e `sso`                                                              | `/new` 200                              | `sso=false`               | L            |
| Free unpaid / expired / canceled / Scale / self-host                         | no fixture                              | —                         | S            |
| Unwired `ipAllowlist` / `aiFeedbackExtraction` / `aiAssistant` / `apiAccess` | skip                                    | skip                      | S            |
| 4th Free create                                                              | already live `free_workspace_owner_cap` | not re-issued             | L            |

## Overlay / change-plan

| Probe                                           | Result                | Signal |
| ----------------------------------------------- | --------------------- | ------ |
| Projection, no stored row                       | t1a/t1e not unlimited | L      |
| Trial = Pro                                     | t1e boards 10         | L      |
| Upgrade lifts / downgrade 402 / extra deletable | not re-paid           | S      |
| Fourth Free                                     | live earlier          | L      |

## HIGH paragraphs

None on this pair.

## Instance count

17 before, 17 after. t1a and t1e remain.
