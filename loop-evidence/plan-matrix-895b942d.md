# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) against live pair
app `932a38f9` / `sha256:895b942d…` `us-east4-eqdc4a` and CP `7cecf06d`
/ `sha256:753d3b86…`. Sweep: `sweep-895b942d.md`. Free t7 still
`plan-matrix-free-t7.md` (no plan-definition change). Instances 19→19.

Fixtures: t1a **Pro paid**; t1e **Growth paid**; t7 **Free unpaid**.
No Scale / cancel host.

## Authority (live)

| Layer   | Result                                                                 |
| ------- | ---------------------------------------------------------------------- |
| Overlay | t1a Pro 10 / ∞ / 10. t1e Growth 3 / 50 / 1. t7 Free 2 / 50 / 1.        |
| Grants  | t1a webhooks+workflows. t1e webhooks+mcp, workflows false. t7 all off. |

## Change-plan / isolation

| Probe                | Result                       | Signal |
| -------------------- | ---------------------------- | ------ |
| t1a same-plan Pro    | **409** `already_on_plan`    | L      |
| t1e same-plan Growth | **409** `already_on_plan`    | L      |
| t1a Scale            | **303** `billing.stripe.com` | L      |
| Foreign session POST | **401** `unauthorized`       | L      |
| Origin missing       | **403** `invalid_origin`     | L      |
