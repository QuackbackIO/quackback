# Critic — same-plan 409 (`be3e41b01` / `f4e3844`)

**PASS** — live pair app `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a` and CP `7cecf06d` / `sha256:753d3b86…`. t1a same-plan Pro monthly is **409** `already_on_plan` (not 503). Scale **303** `billing.stripe.com`. t1e Upgrade **303** `cs_test_`. Origin 403. Instances 19→19.

Named critic spawn was unjoinable; orchestrator live-probed the same URLs (`ws-already-on-plan.json`).

## Facts

| Check                                        | Result                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Web / five roles digest                      | `sha256:40be439d1c2d55957265723bef94b9eda49523d3fee8954de7c2385b595a76f2` |
| Region                                       | `us-east4-eqdc4a` only                                                    |
| gauntlet / south / north ready               | 200 `role=web`                                                            |
| t1a plan                                     | `pro`                                                                     |
| t1e plan                                     | `free`                                                                    |
| t1a POST checkout pro monthly (https Origin) | **409** `already_on_plan`                                                 |
| t1a POST checkout scale monthly              | **303** `billing.stripe.com` `/p/session/test_…`                          |
| t1e POST checkout growth monthly             | **303** `checkout.stripe.com` `/c/pay/cs_test_…`                          |
| foreign Origin                               | **403** `invalid_origin`                                                  |
| missing Origin                               | **403** `invalid_origin`                                                  |
| instances                                    | 19 → 19                                                                   |
| paid                                         | no                                                                        |
| Neon                                         | none created                                                              |
| custom domains                               | not started                                                               |
| Stripe key                                   | `sk_test_`                                                                |

`635cdb149` (https Origin) is an ancestor of this image.
