PASS — t1e still Scale; Growth is scheduled at period end; t1a stays Pro; instances 19.

Independent critic 2026-08-15T10:57:21Z. Read-only health + `railway run` CP SELECT + Stripe retrieve (no pay, no schedule create/update/release, no workspace). Stripe key `sk_test_` only.

| Check                                  | Result                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| t1e `plan_id` / outbox `effectivePlan` | **scale** / **scale** (outbox v7 delivered)                  |
| Stripe sub current item                | still **scale** (Growth not current)                         |
| Stripe schedule                        | **active** `livemode=false` 2 phases: **scale** → **growth** |
| t1a `plan_id`                          | **pro**                                                      |
| `cp_instances`                         | **19**                                                       |
| Ready                                  | north 200, south 200 (`role=web`)                            |
| Stripe secret                          | `sk_test_` (not live)                                        |

`loop-evidence/this-fire/t1e-downgrade-critic.json`.
