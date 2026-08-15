# PASS — t1e test-mode payment + webhook finalize

Independent 2026-08-15. No deploy, no Neon, no live key, no custom domains.

- Live pair unchanged: app `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a`, CP `7cecf06d`.
- Existing t1e `inst_01m00kprbrfzzb19f490wga8q2` (`northfa99f0`) Growth monthly `cs_test_` Checkout paid (`4242`). Browser left Stripe for `northfa99f0.quackback.co.uk`.
- Stripe retrieve: `livemode=false` `status=complete` `payment_status=paid` `kind=workspace_subscription` `instanceId=t1e` `planId=growth` sub `sub_1U4c…` `active`.
- `checkout.session.completed` + `customer.subscription.created` processed (`evt_1U4c…`).
- t1e `plan_id=growth`, item `si_V4mGq…`, org sub `active`. Outbox v5 delivered `effectivePlan=growth` `canManageBilling=true`.
- t1a remains `pro`. Instances **19→19**.

`loop-evidence/this-fire/t1e-pay-verify.json`. Did not pay t1a again.
