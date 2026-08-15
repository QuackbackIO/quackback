# PASS (0 HIGH)

Verify sweep of live Development pair after named billing refusals
`cb3c65420`. Rows 1–32 (A–G). No payment, no Neon, no deploy, no wipe,
no hostname add. Facts: `sweep-895b942d.json`.

Live: app `932a38f9` / `sha256:895b942d…` `us-east4-eqdc4a`. CP
`7cecf06d` / `sha256:753d3b86…` sfo.

| #   | Surface                 | Result                                                                                                                                   | Signal             |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Create / Open           | Owner Open consume 200 + session both hosts.                                                                                             | LOW                |
| 2   | Cloud identity          | General 200.                                                                                                                             | LOW                |
| 3   | Onboarding Ready        | Getting-started 200.                                                                                                                     | LOW                |
| 4   | Public board            | Public 200 both tenants.                                                                                                                 | LOW                |
| 5   | Admin                   | Inbox 200. Cross-tenant cookie 307.                                                                                                      | LOW                |
| 6   | Settings nav            | Cloud General + Plan & billing + Emails.                                                                                                 | LOW                |
| 7   | General → CP            | Wipe extras/`yes` 400.                                                                                                                   | LOW                |
| 8   | Billing → CP            | t1a Pro **409**. t1e Growth **409**. Portals **303**. t1a Scale **303**. Origin 403. t1a-cookie on t1e **401** `unauthorized` (was 500). | LOW                |
| 9   | Domains surface         | Card already live. Did not add a hostname.                                                                                               | skipped (provider) |
| 10  | Emails (cloud)          | Channels 200. No SES/key fields.                                                                                                         | LOW                |
| 11  | Free baseline           | t1a Pro 10/10. t1e Growth 3/50/1. Not unlimited.                                                                                         | LOW                |
| 12  | Upgrade                 | Same-plan 409. Scale confirm 303. Did not pay.                                                                                           | LOW                |
| 13  | Portal                  | t1a and t1e **303**.                                                                                                                     | LOW                |
| 14  | Change / downgrade      | Scale 303. Same-plan 409.                                                                                                                | LOW                |
| 15  | Limits                  | No stored row. Overlay not unlimited.                                                                                                    | LOW                |
| 16  | Entitlements            | t1a webhooks+workflows true, sso false. t1e webhooks+mcp true, workflows false.                                                          | LOW                |
| 17  | 3-Free cap              | Both paid owners live-Free 0. Fourth create not issued.                                                                                  | skipped            |
| 18  | Isolation               | Admin foreign cookie 307. Billing POST foreign session **401** named.                                                                    | LOW                |
| 19  | Rename / assets         | Unchanged.                                                                                                                               | LOW                |
| 20  | Fail closed             | Origin 403. Projection stale already proved.                                                                                             | LOW                |
| 21  | Self-host               | No self-host host.                                                                                                                       | skipped            |
| 22  | Fleet                   | Digest `895b942d`; `us-east4-eqdc4a`.                                                                                                    | LOW                |
| 23  | Soft-delete / restore   | Unauth delete/restore 500. No row removed.                                                                                               | LOW                |
| 24  | Switcher                | Sibling lists empty.                                                                                                                     | LOW                |
| 25  | Transfer / leave        | Already live.                                                                                                                            | LOW                |
| 26  | Seats                   | t1e Growth seats 1.                                                                                                                      | LOW                |
| 27  | SSO downgrade           | No Scale host.                                                                                                                           | skipped            |
| 28  | Visible usage           | Plan cards present.                                                                                                                      | LOW                |
| 29  | Export / wipe / account | Wipe extras 400. Account delete 401.                                                                                                     | LOW                |
| 30  | Plan cards              | Catalogue 200 four plans.                                                                                                                | LOW                |
| 31  | Invoices                | t1a 2; t1e 1.                                                                                                                            | LOW                |
| 32  | Change to X             | Scale 303. Same-plan 409.                                                                                                                | LOW                |

## HIGH

None.

## LOW notes

- Unauthenticated CP delete/restore still 500.
- CP dashboard OTP still did not set a session.

## Instance count

19 before, 19 after. t1a Pro, t1e Growth.
