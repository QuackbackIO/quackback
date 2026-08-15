# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) Scale fixture on existing t1e
against live pair `e20c0eef` / `sha256:895b942d…` `us-east4-eqdc4a`
and CP `3a9bc4ee`. No payment, no Neon, no IdP add. Instances 19→19.

Fixtures: t1e **Scale paid**; t1a **Pro paid** unchanged; t7 Free
unchanged.

## Authority (live)

| Layer                  | Result                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Overlay, no stored row | Scale `maxBoards/maxPosts/maxTeamSeats` **null**. Not unlimited OSS (projection present). |
| Entitlements           | `sso` `auditLog` `workflows` `webhooks` `mcp` true.                                       |
| Same-plan Scale        | **409** `already_on_plan`.                                                                |
| Portal                 | **303** `billing.stripe.com`.                                                             |
| SSO UI                 | `/sso/new` **200** create fields; no “not included”.                                      |
| Inbox                  | **200**.                                                                                  |

Did not add an IdP or downgrade. Unwired keys skipped.
