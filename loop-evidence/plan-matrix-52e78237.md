# FAIL

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `93838859` / `sha256:52e78237…` `us-east4-eqdc4a` and CP `6f0b0fee`.
No payment, no Neon, instances 17→17. Overlay facts from
`sweep-52e78237.json`. Code: CP `definitions.ts` + `PLAN_GRANTS`,
workspace `PLAN_CATALOGUE` + `resolveEffectiveTierLimits`.

Fixtures: t1a Growth paid (boards 1/3, seats 1/1, posts 0/50);
t1e Pro trial (boards 1/10, seats 1/10, posts 0/∞).
No unpaid Free `ws-*`. No Scale host. No canceled host.
Self-host not re-walked.

## Authority drifts (HIGH)

| Advertised (CP catalogue cards)                      | Enforcement (`definitions.ts` / grants)                                      | Why HIGH                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Free/Growth: “Unlimited … posts”                     | Free/Growth `maxPosts=50`                                                    | Card grants what the plan then 402s                   |
| Growth: “integrations · API & webhooks”              | `integrations=false`; `apiAccess` unwired; `webhooks` grant yes / feature no | Dual-layer + sticker lie                              |
| Growth: “No seat minimums · 5 free lite seats”       | `maxTeamSeats=1` (humans); Stripe qty still 1                                | Seat sticker ≠ cap                                    |
| Pro: “1M API req/mo”                                 | `apiRequestsPerMonth=250_000`                                                | Sticker vs code                                       |
| Growth `PLAN_GRANTS` includes `webhooks`+`mcpServer` | `GROWTH_TIER_LIMITS.features` both false                                     | Overlay follows entitlements (`webhooks=true` on t1a) |

`PLAN_CATALOGUE.grants` matches `PLAN_GRANTS` (including Growth webhooks/mcp).
Numeric overlay on live t1a/t1e matches `definitions.ts`. Stored
`tier_limits` null + projection present is **not** unlimited.

## Matrix (wired keys)

`S` = skipped (unwired, no Scale host, not at cap, or 8e not live).
`H` = HIGH. `L` = LOW / agreed.

| State × key                                                                   | UI                                                   | Server                                                    | Signal                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| Growth t1a `maxBoards` 3                                                      | Create still offered (1 of 3; no `N of M` on boards) | not at cap                                                | H (missing `N of M`)   |
| Growth t1a `maxPosts` 50                                                      | no `N of M`                                          | 0 of 50, not at cap                                       | H (sticker unlimited)  |
| Growth t1a `maxTeamSeats` 1                                                   | Members Invite still shown at 1/1; no `used / limit` | chokepoint `enforceSeatLimit` exists; live 402 not posted | H (UI unlocked at cap) |
| Growth t1a `maxStatusComponents` 10                                           | not sampled                                          | not at cap                                                | S                      |
| Growth t1a `maxCustomRoles` 0                                                 | not sampled                                          | create would 402                                          | S                      |
| Growth t1a `maxSendingDomains` 1                                              | Emails 404                                           | not at cap                                                | S                      |
| Growth t1a `aiTokensPerMonth`                                                 | no usage chrome                                      | not exercised                                             | S (8e)                 |
| Growth t1a `apiRequests*`                                                     | unwired                                              | skip                                                      | S                      |
| Growth t1a `customDomain`                                                     | Help Center local writer **shown** (Verify row 9)    | local `setHelpCenterDomain` still writes on live image    | H                      |
| Growth t1a `sso`                                                              | `/new` form reachable (list gated)                   | entitlements `sso=false`                                  | H (UI not locked)      |
| Growth t1a `webhooks`                                                         | grant yes                                            | overlay `webhooks=true`; feature flag false unused        | H (grant vs feature)   |
| Growth t1a `mcpServer`                                                        | same drift                                           | grant yes / feature no                                    | H                      |
| Growth t1a `integrations` / `customColors` / `customCss` / `analyticsExports` | card says integrations                               | features false                                            | H (sticker)            |
| Growth t1a `aiDrafts`                                                         | grant yes                                            | not live-clicked                                          | L (matches grants)     |
| Growth t1a `workflows` / `aiInsights` / `auditLog`                            | grant no                                             | entitlements false                                        | L                      |
| Trial t1e = Pro numbers                                                       | overlay 10/∞/10/25/5/3                               | matches Pro                                               | L                      |
| Trial t1e `sso`                                                               | Scale-only, `/new` reachable                         | `sso=false`                                               | H (UI)                 |
| Trial t1e `workflows`                                                         | grant yes                                            | overlay true                                              | L                      |
| Free unpaid                                                                   | no live unpaid `ws-*`                                | —                                                         | S                      |
| Trial expired / canceled                                                      | no fixture                                           | —                                                         | S                      |
| Scale                                                                         | catalogue/code only                                  | no host                                                   | S                      |
| Self-host                                                                     | not re-walked                                        | OSS unlimited                                             | S                      |
| `ipAllowlist` / `aiFeedbackExtraction` / `aiAssistant` / `apiAccess`          | unwired                                              | skip                                                      | S                      |
| 4th Free create                                                               | already live `free_workspace_owner_cap`              | not re-issued                                             | L                      |

## Overlay / change-plan

| Probe                          | Result                                          | Signal                   |
| ------------------------------ | ----------------------------------------------- | ------------------------ |
| Projection, no stored row      | t1a/t1e resolved not unlimited                  | L                        |
| Trial = Pro                    | t1e `maxBoards=10` `workflows=true` `sso=false` | L                        |
| Upgrade lifts cap              | not re-paid                                     | S (Stripe-live owns pay) |
| Downgrade 402                  | no canceled fixture                             | S                        |
| Extra resource still deletable | not downgraded                                  | S                        |

## HIGH paragraphs

1. **Catalogue vs enforcement.** Live `GET /catalogue` cards say unlimited posts on Free/Growth, Growth integrations+API+webhooks, Pro 1M API, Growth “no seat minimums / 5 lite seats”. `definitions.ts` is 50 posts, Growth 1 human seat, integrations/customColors false, API 10k/250k. A customer who trusts the card is then 402’d (or the reverse for Growth webhooks).

2. **Growth webhooks/mcp dual layer.** `PLAN_GRANTS` Growth includes both; `GROWTH_TIER_LIMITS.features` is false. Overlay follows entitlements (`t1a entitlementsWebhooks=true`). One helper allows, the other would refuse.

3. **Missing `N of M`.** Finite wired limits (boards, seats, posts, status, roles, sending domains, AI tokens) do not show `N of M` on Plan & billing / Members. Invite is still offered on t1a at 1 of 1. Track 8e.

4. **Cloud Help Center local writer.** t1a Help Center Domains still shows “TLS terminates at your own reverse proxy”. `POST /identity/domains` 404. Fixer `ce57a0bcc` is committed, **not in this live image**.

5. **SSO `/new` reachable on Growth and trial Pro.** Entitlement is Scale-only. List may gate; the create form 200s.

## Instance count

17 before, 17 after. t1a and t1e remain.
