# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a` and CP `7cecf06d`
/ `sha256:753d3b86…` (`f4e3844`). Exercised via the same-fire Verify
sweep (`sweep-40be439d.md`) plus workspace same-plan POST
(`ws-already-on-plan.json`). No payment, no Neon, no custom-hostname add.
Instances 19→19.

Fixtures: t1a **Pro paid** (v6); t1e Pro trial. No unpaid Free `ws-*`.
No Scale host. No canceled host.

## Authority (live)

| Layer                  | Result                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| CP catalogue           | `GET /catalogue` 200: four plans; annualDiscountMonths=2.                |
| Overlay, no stored row | t1a/t1e `maxBoards=10` `maxTeamSeats=10` `maxPosts=null`. Not unlimited. |
| Entitlements           | Both `webhooks=true` `workflows=true` `sso=false` `customDomain=true`.   |

## Matrix (wired keys)

`S` = skipped. `L` = agreed.

| State × key                                        | UI                        | Server                     | Signal       |
| -------------------------------------------------- | ------------------------- | -------------------------- | ------------ |
| Pro t1a `maxBoards` 10                             | Usage present             | overlay 10, 1 board        | L            |
| Pro t1a `maxPosts` ∞                               | finite keys only          | null / unlimited           | L            |
| Pro t1a `maxTeamSeats` 10                          | Members 200               | overlay 10                 | L            |
| Pro t1a `sso`                                      | `/new` 200                | entitlements false         | L            |
| Pro t1a `webhooks` / `workflows`                   | grant yes                 | overlay true               | L            |
| Pro t1a `customDomain`                             | Domains card + Add domain | provider add not exercised | S (provider) |
| Trial t1e = Pro numbers                            | overlay Pro               | boards 10, workflows true  | L            |
| Free unpaid / expired / cancel / Scale / self-host | no fixture                | —                          | S            |
| Unwired keys                                       | skip                      | skip                       | S            |
| 4th Free                                           | already live              | not re-issued              | L            |

## Overlay / change-plan

| Probe                     | Result                                   | Signal |
| ------------------------- | ---------------------------------------- | ------ |
| t1a same-plan Pro monthly | workspace **409** `already_on_plan`      | L      |
| t1a Scale monthly         | **303** `billing.stripe.com`             | L      |
| t1e Growth monthly        | **303** `checkout.stripe.com` `cs_test_` | L      |
| Origin missing / foreign  | **403** `invalid_origin`                 | L      |
