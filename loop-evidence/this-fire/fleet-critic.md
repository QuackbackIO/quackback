# PASS — `635cdb149` already live; t1e Upgrade 303 `cs_test_`

Independent 2026-08-15. No deploy, pay, Neon, or custom domains.

- Web `c5d64208` SUCCESS `ghcr.io/quackbackio/quackback@sha256:25319ded06a84cc0b6be9c95a5c738186210a7cc04ffff382c189dfee439ab86` region only `us-east4-eqdc4a`. Worker `086ed99a`, hourly `b48414aa`, daily `518eae03`, migrator `e7d2d36a` same digest.
- Five health URLs 200 (gauntlet ready, south, north, both `ws-*` health).
- Owner `POST https://northfa99f0.quackback.co.uk/api/billing/session` `Origin: https://northfa99f0.quackback.co.uk` `action=checkout&planId=growth&billingPeriod=monthly` → **303** `checkout.stripe.com` `/c/pay/cs_test_…` (not `cs_live_`).
- Foreign Origin and missing Origin → **403** `invalid_origin`.
- t1a remains Growth paid (`plan_id=growth`, sub active, item present, outbox v4 delivered). Payment not repeated.
- Instances 19→19 (two existing t7 rows already present). t1a/t1e remain.

`loop-evidence/this-fire/probe-303-t7.json`.
