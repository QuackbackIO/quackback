# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `371883f5` / `sha256:71f78ecb…` `us-east4-eqdc4a` and CP `1931dc38`
/ `sha256:79030f27…` (`64ca931`). No payment, no Neon, instances 17→17.

Fixtures: t1a Growth paid; t1e Pro trial. No unpaid Free `ws-*`. No Scale
host. No canceled host. Self-host not re-walked.

## Authority (live)

| Layer                            | Result                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CP catalogue vs `definitions.ts` | Live `GET /catalogue` 200: Free/Growth `2/3 boards · 50 posts`; no unlimited posts; no Growth integrations/webhooks; no Pro `1M API`. |
| Growth grant vs feature          | `GROWTH_TIER_LIMITS.features.webhooks/mcpServer` **true**; `PLAN_GRANTS` Growth matches.                                              |
| `PLAN_CATALOGUE.grants`          | Matches `PLAN_GRANTS` (Growth includes webhooks+mcp; SSO Scale-only).                                                                 |
| Overlay, no stored row           | Verify: t1a `maxBoards=3` `maxTeamSeats=1`; t1e `10`/`10`. Not unlimited.                                                             |

Website marketing copy still lists older unlimited-post / uncapped-seat stickers.
Workspace cards use the CP catalogue (aligned). Recorded, not a workspace HIGH.

## Matrix (wired keys)

`S` = skipped (unwired, no fixture, or not at cap). `L` = agreed. `H` = HIGH.

| State × key                                                                  | UI                                                                  | Server                                       | Signal       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- | ------------ |
| Growth t1a `maxBoards` 3                                                     | Usage `1 of 3` (Verify hydrated)                                    | not at cap                                   | L            |
| Growth t1a `maxPosts` 50                                                     | Usage card lists finite keys                                        | 0 of 50, not at cap                          | L            |
| Growth t1a `maxTeamSeats` 1                                                  | Members `Team seats` + `1 of 1`; Invite present but disabled at cap | `enforceSeatLimit` exists                    | L            |
| Growth t1a status/roles/sending/AI                                           | Usage / not at cap                                                  | not at cap                                   | S            |
| Growth t1a `apiRequests*`                                                    | unwired                                                             | skip                                         | S            |
| Growth t1a `customDomain`                                                    | HC local writer **absent** (Verify row 9)                           | CP domains 404; provider skipped             | S (provider) |
| Growth t1a `sso`                                                             | `/new` 200 copy “not included”; no Issuer fields                    | entitlements `sso=false`                     | L            |
| Growth t1a `webhooks` / `mcpServer`                                          | grant yes                                                           | features **true**; overlay entitlements true | L            |
| Growth t1a integrations / colors / css / exports                             | not on catalogue card                                               | features false                               | L            |
| Trial t1e = Pro numbers                                                      | Usage `1 of 10` boards                                              | overlay Pro                                  | L            |
| Trial t1e `sso`                                                              | same locked `/new`                                                  | `sso=false`                                  | L            |
| Trial t1e `workflows`                                                        | grant yes                                                           | overlay true                                 | L            |
| Free unpaid / expired / canceled / Scale / self-host                         | no fixture                                                          | —                                            | S            |
| Unwired `ipAllowlist` / `aiFeedbackExtraction` / `aiAssistant` / `apiAccess` | skip                                                                | skip                                         | S            |
| 4th Free create                                                              | already live `free_workspace_owner_cap`                             | not re-issued                                | L            |

## Overlay / change-plan

| Probe                                           | Result                                   | Signal |
| ----------------------------------------------- | ---------------------------------------- | ------ |
| Projection, no stored row                       | t1a/t1e not unlimited                    | L      |
| Trial = Pro                                     | t1e boards 10, workflows true, sso false | L      |
| Upgrade lifts / downgrade 402 / extra deletable | not re-paid                              | S      |
| Fourth Free                                     | live earlier                             | L      |

## HIGH paragraphs

None on this pair.

## Instance count

17 before, 17 after. t1a and t1e remain.
