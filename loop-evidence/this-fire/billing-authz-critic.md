# PASS — named billing session refusals (`cb3c65420`)

Live pair web `932a38f9` / `sha256:895b942d…` `us-east4-eqdc4a`.
No pay, no Neon. Instances 19→19.

| Probe                   | Result                           |
| ----------------------- | -------------------------------- |
| No cookie, https Origin | **401** `unauthorized`           |
| t1a session on t1e host | **401** `unauthorized` (was 500) |
| t1e same-plan Growth    | **409** `already_on_plan`        |
| Foreign Origin          | **403** `invalid_origin`         |

`this-fire/billing-authz.json`.
