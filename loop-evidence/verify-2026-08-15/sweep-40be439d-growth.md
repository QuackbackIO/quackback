# PASS (0 HIGH)

Verify sweep of live Development pair after t1e became Growth paid.
Same image `be3e41b01` / CP `f4e3844`. Rows 1–32 (A–G). No payment,
no Neon, no deploy, no wipe, no hostname add. Facts:
`sweep-40be439d-growth.json`, `fleet-reprove-growth.json`.

Live: app `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a`. CP
`7cecf06d` / `sha256:753d3b86…` sfo.

| #   | Surface                 | Result                                                                                                                                       | Signal             |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Create / Open           | Owner Open consume 200 + session on both friendly hosts.                                                                                     | LOW                |
| 2   | Cloud identity          | General 200.                                                                                                                                 | LOW                |
| 3   | Onboarding Ready        | Getting-started 200.                                                                                                                         | LOW                |
| 4   | Public board            | Public 200 both tenants.                                                                                                                     | LOW                |
| 5   | Admin                   | Inbox 200. Cross-tenant cookie 307.                                                                                                          | LOW                |
| 6   | Settings nav            | Cloud General + Plan & billing + Emails.                                                                                                     | LOW                |
| 7   | General → CP            | Wipe extras/`yes` 400.                                                                                                                       | LOW                |
| 8   | Billing → CP            | t1a same-plan Pro **409**. t1e same-plan Growth **409**. t1a/t1e portal **303** `billing.stripe.com`. t1e Scale confirm **303**. Origin 403. | LOW                |
| 9   | Domains surface         | Card already live on this digest. Did not add a hostname.                                                                                    | skipped (provider) |
| 10  | Emails (cloud)          | Channels 200. No SES/key fields.                                                                                                             | LOW                |
| 11  | Free baseline           | t1a Pro paid overlay boards 10. t1e **Growth paid** overlay boards 3 / posts 50 / seats 1. Not unlimited.                                    | LOW                |
| 12  | Upgrade                 | t1e Growth same-plan **409** (no longer checkout). Scale confirm 303. Did not pay.                                                           | LOW                |
| 13  | Portal                  | t1a and t1e **303** hosted portal.                                                                                                           | LOW                |
| 14  | Change / downgrade      | Scale confirm 303 both paid hosts. Same-plan 409. Did not pay.                                                                               | LOW                |
| 15  | Limits                  | No stored row. t1a Pro 10/10. t1e Growth 3/1/50. Not unlimited.                                                                              | LOW                |
| 16  | Entitlements            | t1a `webhooks=true` `workflows=true` `sso=false`. t1e `webhooks=true` `mcp=true` `workflows=false`.                                          | LOW                |
| 17  | 3-Free cap              | t1a live-Free 0; t1e live-Free 0 (both paid). Fourth create not issued.                                                                      | skipped            |
| 18  | Isolation               | Foreign cookie admin 307. t1a-cookie POST on t1e billing 500 (unnamed).                                                                      | LOW                |
| 19  | Rename / assets         | Unchanged.                                                                                                                                   | LOW                |
| 20  | Fail closed             | Origin 403. Webhook no/bad sig already proved.                                                                                               | LOW                |
| 21  | Self-host               | No self-host host.                                                                                                                           | skipped            |
| 22  | Fleet                   | Five health 200. Digest `40be439d`; `us-east4-eqdc4a`.                                                                                       | LOW                |
| 23  | Soft-delete / restore   | Unauth delete/restore 500. No row removed.                                                                                                   | LOW                |
| 24  | Switcher                | Sibling lists empty.                                                                                                                         | LOW                |
| 25  | Transfer / leave        | Ownership GET already live.                                                                                                                  | LOW                |
| 26  | Seats                   | t1e Growth seats 1.                                                                                                                          | LOW                |
| 27  | SSO downgrade           | No Scale host.                                                                                                                               | skipped            |
| 28  | Visible usage           | Plan cards present.                                                                                                                          | LOW                |
| 29  | Export / wipe / account | Wipe extras 400. Account delete 401 no session.                                                                                              | LOW                |
| 30  | Plan cards              | Catalogue 200 four plans; annual 2 months.                                                                                                   | LOW                |
| 31  | Invoices                | t1a 2 hosted https; t1e 1.                                                                                                                   | LOW                |
| 32  | Change to X             | t1e Scale 303 confirm. Same-plan Growth 409.                                                                                                 | LOW                |

## HIGH

None.

## LOW notes

- Unauthenticated CP delete/restore still 500.
- CP dashboard OTP still did not set a session.
- t1a session POST to t1e `/api/billing/session` still 500.

## Instance count

19 before, 19 after. t1a Pro, t1e Growth.
