# PASS (0 HIGH)

Verify sweep of live Development pair. Rows 1–32 (A–G) only. No payment, no Neon, no deploy, no wipe, no §H.
Facts: `sweep.json`. Hydrated shots: `shots/`, `shots.json`. CP session: `cp-session.json`.

Live: app `371883f5` / `sha256:71f78ecb…` `us-east4-eqdc4a` (worker `b56b36fa`, hourly `597ee448`, daily `9bac011c`, migrator `af9e6263`). CP `9aaa6ff2` / `sha256:640d5ac1…` sfo. Commits app `e22e3884e` (8f), CP `940c984` (8f).

| #   | Surface                 | Result                                                                                                                                                                                             | Signal             |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Create / Open           | CP login has no named-create form. Owner Open 302 `ott=` to system-host handoff. Workspace OTT consume 200 + session cookie on both friendly hosts.                                                | LOW                |
| 2   | Cloud identity          | General 200. Hydrated Quackback URL is the friendly label (`south63792f` / `northfa99f0`); field does not print `ws-*`. Logo preload still uses the pinned system host.                            | LOW                |
| 3   | Onboarding Ready        | Starter already completed. `/admin/getting-started` 200 “Your launch plan” with primary **Copy board link**.                                                                                       | LOW                |
| 4   | Public board            | `GET /?sort=trending` 200 titled Feedback on both tenants. `/b/feedback` 404. Not a 5xx and not `/{slug}/feedback` as the cloud URL.                                                               | LOW                |
| 5   | Admin                   | `/admin` 307 `/admin/feedback`; inbox 200.                                                                                                                                                         | LOW                |
| 6   | Settings nav            | Cloud General + Plan & billing + Emails present on t1a/t1e.                                                                                                                                        | LOW                |
| 7   | General → CP            | Identity extras `instanceId` 400; same displayName 200 `projectionToken`. No workspace id required.                                                                                                | LOW                |
| 8   | Billing → CP            | t1e checkout form 303 `cs_test_`; t1a portal and Change-to 303 `billing.stripe.com` confirm; missing/foreign Origin 403 `invalid_origin`.                                                          | LOW                |
| 9   | Domains surface         | No Settings General cloud domains card. `POST /api/v1/internal/identity/domains` 404. Hydrated Help Center → Domains & languages has **no** local reverse-proxy Custom domain writer.              | skipped (provider) |
| 10  | Emails (cloud)          | `/admin/settings/emails` 404; channels 200 Emails. No SES/key fields.                                                                                                                              | LOW                |
| 11  | Free baseline           | t1e `plan_id=free` + trial overlay `effectivePlan=pro`. t1a Growth paid. Second trial `already_started`.                                                                                           | LOW                |
| 12  | Upgrade                 | t1e owner 303 test Checkout; Stripe metadata `instanceId` is t1e; did not pay.                                                                                                                     | LOW                |
| 13  | Portal                  | t1a 303 hosted portal. t1e portal 403 `billing_action_unavailable` (`canManageBilling=false`).                                                                                                     | LOW                |
| 14  | Change / downgrade      | t1a Change to Pro / Scale annual 303 Stripe `subscription_update_confirm` portal for the existing sub. Did not complete a change.                                                                  | skipped            |
| 15  | Limits                  | Stored `tier_limits` null. Resolved overlay t1a `maxBoards=3` / `maxTeamSeats=1`; t1e `maxBoards=10` / `maxTeamSeats=10`. Not unlimited. Full matrix is §H.                                        | LOW                |
| 16  | Entitlements            | Growth `sso=false` `webhooks=true`; trial Pro `workflows=true` `sso=false`. SSO `/new` form reachable (Scale copy). Full matrix is §H.                                                             | LOW                |
| 17  | 3-Free cap              | t1a owner live-Free 0 (paid); t1e 1 (trial counts as Free). Fourth create not issued.                                                                                                              | skipped            |
| 18  | Isolation               | Foreign cookie 307 sign-in. Billing extras `instanceId` 400. t1e checkout names t1e. Cross-tenant billing POST 500 `HTTPError` after origin accepted.                                              | LOW                |
| 19  | Rename / assets         | Old friendly `northe0d78f` 308 → `northfa99f0` (path preserved on `/admin/settings/general`). Logo `GET /api/storage/…` 200, src relative.                                                         | LOW                |
| 20  | Fail closed             | Replay / expiry / wrong-workspace OTT: invalid copy, no session cookie. Origin 403. Webhook no/bad sig 400. Replay deduped; projection versions unchanged.                                         | LOW                |
| 21  | Self-host               | No self-host host in this sweep.                                                                                                                                                                   | skipped            |
| 22  | Fleet                   | Five health URLs 200. Digest `71f78ecb` on all five app roles; web region only `us-east4-eqdc4a`. CP `9aaa6ff2` sfo.                                                                               | LOW                |
| 23  | Soft-delete / restore   | Unauth delete/restore 500 (no row removed). Owner delete not exercised.                                                                                                                            | LOW                |
| 24  | Switcher                | `GET /api/v1/internal/workspaces` 200 empty (each owner has one live workspace). In-product switcher hidden; no `ws-*` address on workspace chrome. CP list still subtitles the system host (LOW). | LOW                |
| 25  | Transfer / leave        | Transfer stranger 403 `not_teammate`; extras 400; owner leave 403 `owner_cannot_leave`. Transfer control hidden with no teammate.                                                                  | LOW                |
| 26  | Seats                   | Overlay `maxTeamSeats` 1 (Growth) / 10 (trial Pro). Members shows `1 of 1 seats` and names Pro. Invite 402 not posted.                                                                             | LOW                |
| 27  | SSO downgrade           | No Scale host.                                                                                                                                                                                     | skipped            |
| 28  | Visible usage           | Trial end date on Plan & billing. Hydrated usage `N of M` (t1a boards `1 of 3`; t1e `1 of 10`) plus AI tokens. CP dashboard `0 of 3 Free workspaces`.                                              | LOW                |
| 29  | Export / wipe / account | General danger zone: Export workspace data + Wipe workspace (confirm). Wipe extras/`yes` 400; no real wipe. CP Delete account 401 then 403 `account_has_live_workspaces`.                          | LOW                |
| 30  | Plan cards              | Catalogue GET 200 four plans; annual default; current marked on t1a Growth and t1e Pro.                                                                                                            | LOW                |
| 31  | Invoices                | t1a GET 200 one invoice, View is https hosted; t1e zero. No 5xx.                                                                                                                                   | LOW                |
| 32  | Change to X             | Paid t1a cards POST `checkout` + `planId` + period; 303 Stripe confirm portal for that price (not generic “use Manage billing” 409).                                                               | LOW                |

## HIGH

None.

## LOW notes

- CP dashboard tile still lists the generated system host under the display name. Workspace General and the in-product switcher do not present `ws-*` as the customer URL.
- Cross-tenant billing POST on t1e with a t1a cookie is 500 `HTTPError` after origin is accepted (not a silent success).
- Unauthenticated CP delete/restore still 500 rather than a named 401.
- SSO `/new` remains reachable; the list is the gated surface. Dual-layer grant/feature drift is §H.

## Instance count

17 before, 17 after (including after the CP session probes). Same id set. t1a and t1e remain. `added=[]` `removed=[]`.
