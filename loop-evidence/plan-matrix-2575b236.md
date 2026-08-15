# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `59da45c2` / `sha256:2575b236…` `us-east4-eqdc4a` and CP `69cb0353`
/ `sha256:d22ba5cf…` (`449bd98`). Exercised via the same-fire Verify
sweep (`sweep-2575b236.md`). No payment, no Neon, no custom-hostname add.
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
| Pro t1a `maxTeamSeats` 10                          | Members 200               | 1 of 10                    | L            |
| Pro t1a `sso`                                      | `/new` 200                | entitlements false         | L            |
| Pro t1a `webhooks` / `workflows`                   | grant yes                 | overlay true               | L            |
| Pro t1a `customDomain`                             | Domains card + Add domain | provider add not exercised | S (provider) |
| Trial t1e = Pro numbers                            | overlay Pro               | boards 10, workflows true  | L            |
| Free unpaid / expired / cancel / Scale / self-host | no fixture                | —                          | S            |
| Unwired keys                                       | skip                      | skip                       | S            |
| 4th Free                                           | already live              | not re-issued              | L            |

## Overlay / change-plan

| Probe                     | Result                     | Signal |
| ------------------------- | -------------------------- | ------ |
| Projection, no stored row | not unlimited              | L      |
| Trial = Pro               | t1e boards 10              | L      |
| Paid Pro overlay          | t1a v6 `effectivePlan=pro` | L      |
| Change to other paid plan | Scale 303 confirm          | L      |
| Same-plan Pro             | 503 named unavailable copy | L      |
| Fourth Free               | live earlier               | L      |

## HIGH paragraphs

None on this pair.

## Instance count

19 before, 19 after. t1a and t1e remain.
