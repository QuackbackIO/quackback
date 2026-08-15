# PASS (0 HIGH)

Verify sweep of live Development pair after widget-install Outlet
`40e1e6bf1`. Rows 1–32 (A–G) only. No payment, no Neon, no deploy, no
wipe. Facts: `sweep-27e0c23d.json`.

Live: app `532dbe27` / `sha256:27e0c23d…` `us-east4-eqdc4a` (worker
`c4854a60`, hourly `51b82597`, daily `810ae26b`, migrator `3d64955e`).
CP `1931dc38` / `sha256:79030f27…` sfo. Commits app `40e1e6bf1`, CP
`64ca931`.

| #   | Surface                 | Result                                                                                                                                                                      | Signal             |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Create / Open           | Owner Open consume 200 + session cookie on both friendly hosts. No named-create.                                                                                            | LOW                |
| 2   | Cloud identity          | General 200. Identity `platformHostname` is the friendly label. Logo src stays `/api/storage/…`.                                                                            | LOW                |
| 3   | Onboarding Ready        | `/admin/getting-started` 200. t1a product-feedback first-win already reached.                                                                                               | LOW                |
| 4   | Public board            | `GET /?sort=trending` 200 on both tenants. Not a 5xx.                                                                                                                       | LOW                |
| 5   | Admin                   | Inbox 200. Cross-tenant admin cookie 307 sign-in.                                                                                                                           | LOW                |
| 6   | Settings nav            | Cloud General + Plan & billing + Emails present (t1a/t1e).                                                                                                                  | LOW                |
| 7   | General → CP            | Identity extras fail closed. Wipe extras/`yes` 400. Served General JS has export + wipe.                                                                                    | LOW                |
| 8   | Billing → CP            | t1e checkout 303 `cs_test_` `livemode=false` names t1e. t1a portal and Change-to-Pro/Scale 303 `billing.stripe.com`. Foreign/missing Origin 403 `invalid_origin`.           | LOW                |
| 9   | Domains surface         | Help Center Domains 200, no TLS-terminates / local writer. CP domains gateway 404 (not wired).                                                                              | skipped (provider) |
| 10  | Emails (cloud)          | Channels 200. No SES/key fields.                                                                                                                                            | LOW                |
| 11  | Free baseline           | t1e `plan_id=free` + trial overlay Pro. t1a Growth paid. Second trial not issued.                                                                                           | LOW                |
| 12  | Upgrade                 | t1e retrieve `instanceId` is t1e; `livemode=false`. Did not pay.                                                                                                            | LOW                |
| 13  | Portal                  | t1a 303 hosted portal. t1e portal 403 `billing_action_unavailable` (no paid item).                                                                                          | LOW                |
| 14  | Change / downgrade      | t1a Change to Pro / Scale 303 Stripe confirm. Did not complete a change.                                                                                                    | skipped            |
| 15  | Limits                  | Stored `tier_limits` null. Overlay t1a `maxBoards=3` / seats 1; t1e `10` / `10`. Not unlimited.                                                                             | LOW                |
| 16  | Entitlements            | Growth `sso=false` `webhooks=true`; trial Pro `workflows=true` `sso=false`. Full matrix is §H.                                                                              | LOW                |
| 17  | 3-Free cap              | t1a live-Free 0 (paid); t1e 1 (trial counts as Free). Fourth create not issued.                                                                                             | skipped            |
| 18  | Isolation               | Foreign cookie 307 sign-in. Billing extras `instanceId` 400. t1e checkout names t1e.                                                                                        | LOW                |
| 19  | Rename / assets         | Old friendly `northe0d78f` 308 → `northfa99f0` (path preserved). Logo `GET /api/storage/…` 200, src relative.                                                               | LOW                |
| 20  | Fail closed             | Replay / expiry / wrong-workspace OTT: invalid copy, no session cookie. Origin 403. Webhook no/bad sig 400. Replay deduped; projection versions unchanged (t1a v4, t1e v2). | LOW                |
| 21  | Self-host               | No self-host host in this sweep.                                                                                                                                            | skipped            |
| 22  | Fleet                   | Five health URLs 200. Digest `27e0c23d` on all five app roles; web region only `us-east4-eqdc4a`. CP `1931dc38` sfo.                                                        | LOW                |
| 23  | Soft-delete / restore   | Unauth delete/restore 500 (no row removed). Owner delete not exercised.                                                                                                     | LOW                |
| 24  | Switcher                | Sibling lists empty (one live workspace each).                                                                                                                              | LOW                |
| 25  | Transfer / leave        | Ownership GET 200; no-bearer 401. Did not write `ownerEmail`.                                                                                                               | LOW                |
| 26  | Seats                   | Overlay `maxTeamSeats` 1 (Growth) / 10 (trial Pro). Members 200.                                                                                                            | LOW                |
| 27  | SSO downgrade           | No Scale host.                                                                                                                                                              | skipped            |
| 28  | Visible usage           | Billing has trial end + four plan names + Change to. Usage `N of M` present. CP dashboard OTP this sweep did not set a session.                                             | LOW                |
| 29  | Export / wipe / account | General danger JS has export + wipe. Wipe extras/`yes` 400. CP account delete 401 without session. Did not POST a real wipe.                                                | LOW                |
| 30  | Plan cards              | Catalogue GET 200 four plans; annual discount 2 months.                                                                                                                     | LOW                |
| 31  | Invoices                | t1a GET 200 one invoice, View is https hosted; t1e zero. No 5xx.                                                                                                            | LOW                |
| 32  | Change to X             | Paid t1a cards 303 Stripe confirm (not a generic portal 409).                                                                                                               | LOW                |

## HIGH

None.

## LOW notes

- CP sign-in OTP this sweep did not set a session (`email_otp_did_not_set_session`). CP `N of 3` and account-delete-with-live-workspaces were already proved on this same CP image (`1931dc38`).
- Unauthenticated CP delete/restore still 500 rather than a named 401.
- t1e portal 403 `billing_action_unavailable` is expected (trial, no paid subscription).

## Instance count

19 before, 19 after. Same id set. t1a and t1e remain. `added=[]` `removed=[]`.
