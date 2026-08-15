# PASS — t1e is Scale paid; `/sso/new` unlocked; t1a stays Pro.

Independent of the builder session. No second Stripe mutation, no IdP add, no Neon.

## Pair

- App `e20c0eef` / `sha256:895b942d…` `us-east4-eqdc4a`.
- CP `3a9bc4ee` / `sha256:aed43943…`.
- Gateway Scale confirm **200** `billing.stripe.com` (builder). Stripe `always_invoice` test-mode item update. `customer.subscription.updated` + `invoice.paid` processed.

## Live

| Check                                  | Result                                            |
| -------------------------------------- | ------------------------------------------------- |
| t1e `plan_id` / effective              | **scale** / **scale** outbox v6 delivered         |
| t1e `entitlements.sso`                 | **true**                                          |
| t1a `plan_id`                          | **pro**                                           |
| t1e `/admin/settings/security/sso/new` | **200**, create fields present, no “not included” |
| Fail-open unit                         | 3/3 `hooks-before` tier-downgrade                 |
| Instances                              | **19→19**                                         |

Did not add an IdP or downgrade. Full SSO-enforce→downgrade still later.

Facts: `t1e-scale-upgrade.json`, `t1e-scale-verify.json`, `t1e-scale-critic.json`.
