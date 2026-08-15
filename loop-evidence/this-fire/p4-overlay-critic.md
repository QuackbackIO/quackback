# PASS — live `fd136d22` / `sha256:cf2a5726…` copies Pro feature flags from the projection

Independent live critic 2026-08-15T18:32Z. Exercised Development after Docker `31900766203` (`4bddea06f`) and fleet redeploy from `ghcr.io/quackbackio/quackback@sha256:cf2a5726bbad7411bfb7409ddf497af27c156f93cf18bd1be37172d852189132`. Did not pay, create Neon, start custom domains, wipe, or redeploy again. Sessions minted via `railway run` on CP `f06ac2e2` + tenant `one-time-token:` + `/auth/open-handoff`. Cookies stayed in `/tmp`.

## 1. Live image

- Web `fd136d22` **SUCCESS** `meta.imageDigest` **exactly** `sha256:cf2a5726bbad7411bfb7409ddf497af27c156f93cf18bd1be37172d852189132`. `multiRegionConfig` keys only `us-east4-eqdc4a`.
- Worker `59e32c58`, hourly `e4f6f888`, daily `b2b962d7`, migrator `eac0ac73` same image.
- Docker `31900766203` success, `headSha` `4bddea06f9d7336341f38cdebe0d8a09ed5df975` (P4 `482f44938` + import-protection `4bddea06f`). Prior `31900508741` FAILED import-protection.
- CP unchanged `9030705d` / `sha256:d84fd27c…`. P3 critic already **PASS**.
- Health 200 `role=web`: gauntlet, `south63792f`, `sup9ca3a708`.

## 2. Overlay copies analyticsExports

| Host              | Plan | `GET /api/export`                                                                                                            |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `south63792f` t1a | Pro  | **200** `text/csv` (was 402 on the prior image)                                                                              |
| `sup9ca3a708` t7  | Free | **402** `tier_limit_exceeded` `features.analyticsExports` “Data export is not available on your plan. Upgrade to enable it.” |

## 3. Overlay copies integrations + same UpgradeOffer

| Host    | `/admin/settings/integrations`                                         |
| ------- | ---------------------------------------------------------------------- |
| t1a Pro | **200** catalog chrome (Slack / GitHub). No “Upgrade to Pro”.          |
| t7 Free | **200** in-route **Upgrade to Pro** · “Integrations is a Pro feature…” |

No DefaultErrorPage.

## 4. Branding save is TierLimitError, not 500

t7 Branding, change preset (Cozy) → Save. Two `POST /_serverFn/…` **200** TSR envelopes (not HTTP 500), messages:

- “Custom colours is not available on your plan. Upgrade to enable it.”
- “Custom CSS is not available on your plan. Upgrade to enable it.”

No `Failed to update branding config` / `DATABASE_ERROR`. That is `wrapDbError` rethrowing `TierLimitError`. The client still toasted “Branding saved” because the TSR envelope is HTTP 200; the UpgradeOffer modal did not open. Integrations already carries the same offer. Named LOW, not a miss of this unit.

Shots: `p4-overlay/01-t7-branding.png`, `03-t7-branding-after-save.png`.
