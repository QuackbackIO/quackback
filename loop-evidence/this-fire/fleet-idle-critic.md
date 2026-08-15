# PASS — `635cdb149` already live; t7 Upgrade 303; no deploy

Independent 2026-08-15T11:16Z. Named critic spawn unjoinable; orchestrator
re-ran this probe with a fresh mint (not the Verify cookies). Did not pay,
deploy, create Neon, start custom domains, mint a live key, wipe, or create
a workspace.

- Web `e20c0eef` SUCCESS `ghcr.io/quackbackio/quackback@sha256:895b942d58b548021837e4abcbdf96156410de149b23fcb2f29041ccaac8e1ab` region only `us-east4-eqdc4a`. Worker `adc52e84`, hourly `e232e3f8`, daily `7f893013`, migrator `141d5a5d` same digest. CP `b7ae7455` (`8e4c00a`, sfo). `635cdb149` is an ancestor of `cb3c65420`.
- Ready 200 `role=web`: gauntlet, south63792f, northfa99f0, sup9ca3a708.
- t7 owner `POST /api/billing/session` Growth monthly → **303** `checkout.stripe.com` (not `cs_live_`).
- t1a same-plan Pro → **409** `already_on_plan`. t1e same-plan Scale → **409** `already_on_plan`.
- Foreign Origin → **403** `invalid_origin`. t1a cookie on t1e → **401** `unauthorized`.
- Unauth t1a delete/restore → **303** `https://cp.quackback.co.uk/auth/login`.
- t1a **pro**, t1e **scale**, Stripe `sk_test_`. Instances **19→19**.

`loop-evidence/this-fire/fleet-idle-critic.json`.
