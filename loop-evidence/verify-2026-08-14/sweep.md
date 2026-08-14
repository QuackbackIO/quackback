# Verify sweep 2026-08-14 — FAIL (one HIGH)

Read-only hosted sweep of live Development pair. Instances 16 → 16.
No payment, no Neon, no deploy. Facts: `facts.json`.

Live: app `683a4b07` / `sha256:139a4a8c…` `us-east4-eqdc4a`. CP `f135274f` / `71e59d9`.

| #   | Surface            | Result                                                                                                    | Signal               |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Create / Open      | Setup auto-create already live; OTT consume 200 + session on both `ws-*`                                  | LOW (proved earlier) |
| 2   | Cloud identity     | General 200; “Quackback URL” present on t1a/t1e                                                           | LOW                  |
| 3   | Onboarding Ready   | Not re-shown (starter already completed)                                                                  | skipped              |
| 4   | Public board       | `/` 307 `/?sort=trending` on both friendly hosts; `/feedback` 404                                         | LOW                  |
| 5   | Admin              | `/admin` 307 `/admin/feedback`; inbox 200                                                                 | LOW                  |
| 6   | Settings nav       | General + Plan & billing 200 on cloud t1a                                                                 | LOW                  |
| 7   | General → CP       | General 200; identity already via `updateCloudIdentityFn`                                                 | LOW                  |
| 8   | Billing → CP       | t1e checkout 303 `cs_test_`; t1a portal 303 `billing.stripe.com`; foreign/missing Origin 403              | LOW                  |
| 9   | Domains surface    | No cloud custom-domain card. Help Center 200. Provider just unblocked in docs; live add skipped           | skipped (provider)   |
| 10  | Emails (cloud)     | `/admin/settings/emails` 404; channels 200. No platform mail keys exercised                               | LOW                  |
| 11  | Free baseline      | t1e `plan_id=free` + trial overlay `effectivePlan=pro`. No unpaid non-trial `ws-*`                        | LOW                  |
| 12  | Upgrade            | t1e owner 303 test Checkout; did not pay                                                                  | LOW                  |
| 13  | Portal             | t1a 303 portal                                                                                            | LOW                  |
| 14  | Change / downgrade | Not exercised (Stripe-live owns pay)                                                                      | skipped              |
| 15  | Limits             | **No `settings.tier_limits` row** on t1a/t1e. Projection present. `getTierLimits` inherited OSS unlimited | **HIGH**             |
| 16  | Entitlements       | SSO/webhooks gated via projection entitlements; numeric overlay was unlimited                             | HIGH (same root)     |
| 17  | 3-Free cap         | CP `c5a484d` not deployed                                                                                 | skipped              |
| 18  | Isolation          | t1e checkout metadata not re-paid; foreign Origin 403                                                     | LOW                  |
| 19  | Rename / assets    | old friendly `northe0d78f` 308 → `northfa99f0`                                                            | LOW                  |
| 20  | Fail closed        | foreign/missing Origin 403 `invalid_origin`                                                               | LOW                  |
| 21  | Self-host          | not re-walked this fire; tests remain                                                                     | skipped              |
| 22  | Fleet              | five health 200; digest `139a4a8c`; web not on sfo                                                        | LOW                  |

## HIGH

Cloud t1a (Growth projection v4) and t1e (trial Pro v2) have `settings.tier_limits` null. `getTierLimits()` treated that as OSS unlimited and `overlayProjectedLimits` kept nulls, so a projected `maxBoards` of 3/10 was not enforced. LOOP-VERIFY: default (no row) is unlimited only when cloud is off.

Fix merged: `b0c13a366` / `31330d85b` (`resolveEffectiveTierLimits`). Tests 19/19. Not in the live image yet.

## Instance count

16 before, 16 after.
