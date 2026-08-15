# PASS (0 HIGH)

Verify sweep of live Development pair after already_on_plan app
`be3e41b01` / CP `f4e3844`. Rows 1–32 (A–G). No payment, no Neon, no
deploy, no wipe, no live custom-hostname add. Facts:
`sweep-40be439d.json`, `domains-40be439d.json`.

Live: app `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a` (worker
`9cd49fe5`, hourly `2634ef48`, daily `057206ec`, migrator `def8cdde`).
CP `7cecf06d` / `sha256:753d3b86…` sfo. Commits app `be3e41b01`, CP
`f4e3844`.

| #   | Surface                 | Result                                                                                                                                                       | Signal             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1   | Create / Open           | Owner Open consume 200 + session cookie on both friendly hosts.                                                                                              | LOW                |
| 2   | Cloud identity          | General 200. Logo src `/api/storage/…` 200.                                                                                                                  | LOW                |
| 3   | Onboarding Ready        | Getting-started 200. Launch plan heading.                                                                                                                    | LOW                |
| 4   | Public board            | `/?sort=trending` 200 both tenants.                                                                                                                          | LOW                |
| 5   | Admin                   | Inbox 200. Cross-tenant cookie 307 sign-in.                                                                                                                  | LOW                |
| 6   | Settings nav            | Cloud General + Plan & billing + Emails present. Domains card live.                                                                                          | LOW                |
| 7   | General → CP            | Identity extras fail closed. Wipe extras/`yes` 400.                                                                                                          | LOW                |
| 8   | Billing → CP            | t1e checkout 303 `cs_test_` names t1e. t1a portal + Change-to-Scale 303 `billing.stripe.com`. Same-plan Change-to-Pro **409** `already_on_plan`. Origin 403. | LOW                |
| 9   | Domains surface         | `/admin/settings/domains` 200 t1a/t1e: Custom domain + Add domain; no Growth lock; no HC local writer. Did not add a hostname.                               | skipped (provider) |
| 10  | Emails (cloud)          | Channels 200. No SES/key fields.                                                                                                                             | LOW                |
| 11  | Free baseline           | t1e Free + Pro trial overlay. t1a Pro paid v6.                                                                                                               | LOW                |
| 12  | Upgrade                 | t1e 303 `cs_test_` `livemode=false`. Did not pay.                                                                                                            | LOW                |
| 13  | Portal                  | t1a 303 hosted portal. t1e portal 403 `billing_action_unavailable`.                                                                                          | LOW                |
| 14  | Change / downgrade      | Growth→Pro + cancel already live earlier. This sweep: Scale confirm 303; same-plan Pro **409**. Did not pay again.                                           | LOW                |
| 15  | Limits                  | No stored row. Overlay t1a/t1e Pro `maxBoards=10` seats 10. Not unlimited.                                                                                   | LOW                |
| 16  | Entitlements            | Pro/trial `webhooks=true` `workflows=true` `sso=false`.                                                                                                      | LOW                |
| 17  | 3-Free cap              | t1a live-Free 0 (paid); t1e 1 (trial). Fourth create not issued.                                                                                             | skipped            |
| 18  | Isolation               | Foreign cookie on admin 307. Extras `instanceId` 400. t1e checkout names t1e. t1a-cookie POST on t1e billing 500 (unnamed).                                  | LOW                |
| 19  | Rename / assets         | Logo `/api/storage/…` 200 relative.                                                                                                                          | LOW                |
| 20  | Fail closed             | OTT replay/expiry/wrong-host invalid, no session. Origin 403. Webhook no/bad sig 400. Replay unchanged v6/v2.                                                | LOW                |
| 21  | Self-host               | No self-host host.                                                                                                                                           | skipped            |
| 22  | Fleet                   | Five health 200. Digest `40be439d`; web `us-east4-eqdc4a` only. CP `7cecf06d` sfo.                                                                           | LOW                |
| 23  | Soft-delete / restore   | Unauth delete/restore 500. No row removed.                                                                                                                   | LOW                |
| 24  | Switcher                | Sibling lists empty.                                                                                                                                         | LOW                |
| 25  | Transfer / leave        | Ownership GET 200; no-bearer 401; stranger 403 `not_teammate`; owner leave 403.                                                                              | LOW                |
| 26  | Seats                   | Overlay seats 10. Members 200.                                                                                                                               | LOW                |
| 27  | SSO downgrade           | No Scale host. `/sso/new` 200 (Pro `sso=false`).                                                                                                             | skipped            |
| 28  | Visible usage           | Four plan names + Change to on t1a billing.                                                                                                                  | LOW                |
| 29  | Export / wipe / account | Wipe extras 400. Account delete 401 no session.                                                                                                              | LOW                |
| 30  | Plan cards              | Catalogue 200 four plans; annual 2 months.                                                                                                                   | LOW                |
| 31  | Invoices                | t1a 200 hosted https (2); t1e zero.                                                                                                                          | LOW                |
| 32  | Change to X             | t1a Change-to-Scale 303 Stripe confirm. Same-plan Pro **409** `already_on_plan`.                                                                             | LOW                |

## HIGH

None.

## LOW notes

- Unauthenticated CP delete/restore still 500.
- CP dashboard OTP listed a 6-digit code but verify did not set a session.
- t1a session POST to t1e `/api/billing/session` returned 500 instead of 401/403.
- Sweep helper `t1aIsPaid=false` is a leftover-item-table quirk; `plan_id=pro`, projection v6 active, live-Free count 0.

## Instance count

19 before, 19 after. Same id set. t1a and t1e remain.
