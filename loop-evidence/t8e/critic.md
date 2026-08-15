# Critic (2026-08-15, 8e usage `3de751c01` / CP `143184d`)

PASS — live billing replica lists finite usage (`AI tokens this month`);
t1a Plan & billing still shows the trial clock; CP dashboard replica
has `N of 3 Free workspaces`. App `sha256:0651b0c6…` `us-east4-eqdc4a`.
CP `9b70f160` SUCCESS. Instances 17→17.

| Probe                         | Result                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Web `57d9793c` digest         | `sha256:0651b0c6effd94534ca80a9ec28613b61b2c46aa60607a4c1b86d82ea1415e58`     |
| Region                        | `us-east4-eqdc4a` only                                                        |
| Ready                         | gauntlet 200                                                                  |
| t1a `/admin/settings/billing` | 200; “Pro trial ends”; usage hydrates from `fetchPlanUsageFn`                 |
| Replica web                   | `billing-C2BSUyCU.mjs` contains `AI tokens this month`                        |
| Replica CP `9b70f160`         | `dashboard.index` / `workspaces-fn` contain `liveFreeOwned` / Free workspaces |
| Instances                     | 17 → 17                                                                       |

Did not create Neon. Did not pay. Focused tests: app 5/5, CP 8/8.
CP dashboard session was expired; list copy verified on the replica.
