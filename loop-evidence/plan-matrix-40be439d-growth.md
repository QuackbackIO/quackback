# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a` and CP `7cecf06d`
/ `sha256:753d3b86…` (`f4e3844`), **after** t1e Growth payment.
Sweep: `sweep-40be439d-growth.md`. No payment this sweep. Instances 19→19.

Fixtures: t1a **Pro paid** (v6); t1e **Growth paid** (v5). No unpaid
Free `ws-*`. No Scale host. No canceled host.

## Authority (live)

| Layer                  | Result                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| CP catalogue           | `GET /catalogue` 200: four plans; annualDiscountMonths=2.                                           |
| Overlay, no stored row | t1a Pro `maxBoards=10` `maxTeamSeats=10` `maxPosts=null`. t1e Growth `3` / `1` / `50`.              |
| Entitlements           | t1a `webhooks=true` `workflows=true` `sso=false`. t1e `webhooks=true` `mcp=true` `workflows=false`. |

## Matrix (wired keys)

`S` = skipped. `L` = agreed.

| State × key                                        | UI            | Server                       | Signal       |
| -------------------------------------------------- | ------------- | ---------------------------- | ------------ |
| Pro t1a `maxBoards` 10                             | Usage present | overlay 10                   | L            |
| Pro t1a `maxPosts` ∞                               | finite keys   | null                         | L            |
| Pro t1a `maxTeamSeats` 10                          | Members 200   | overlay 10                   | L            |
| Pro t1a `sso`                                      | `/new` 200    | entitlements false           | L            |
| Pro t1a `webhooks` / `workflows`                   | grant yes     | overlay true                 | L            |
| Growth t1e `maxBoards` 3                           | overlay 3     | not Pro leftover             | L            |
| Growth t1e `maxPosts` 50                           | overlay 50    | not unlimited                | L            |
| Growth t1e `maxTeamSeats` 1                        | overlay 1     | Growth seat                  | L            |
| Growth t1e `webhooks` / `mcp`                      | grant yes     | true / true                  | L            |
| Growth t1e `workflows`                             | grant no      | false                        | L            |
| Pro t1a `customDomain`                             | Domains card  | provider add not exercised   | S (provider) |
| Free unpaid / expired / cancel / Scale / self-host | no fixture    | —                            | S            |
| Unwired keys                                       | skip          | skip                         | S            |
| 4th Free                                           | already live  | not re-issued; both owners 0 | L            |

## Overlay / change-plan

| Probe                    | Result                              | Signal |
| ------------------------ | ----------------------------------- | ------ |
| t1a same-plan Pro        | workspace **409** `already_on_plan` | L      |
| t1e same-plan Growth     | workspace **409** `already_on_plan` | L      |
| t1e Scale monthly        | **303** `billing.stripe.com`        | L      |
| t1a + t1e portal         | **303** `billing.stripe.com`        | L      |
| Origin missing / foreign | **403** `invalid_origin`            | L      |
