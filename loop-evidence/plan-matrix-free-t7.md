# PASS

Plan-matrix critic (`LOOP-VERIFY.md` §H) Free fixture on existing t7
hosts against live pair `95610fd8` / `sha256:40be439d…` `us-east4-eqdc4a`
and CP `7cecf06d`. No payment, no Neon. Instances 19→19.

Fixtures: `sup9ca3a708` + `hc9ca3a708` **Free unpaid** (no stored
`tier_limits`). Complements t1a Pro + t1e Growth. Still no Scale /
cancel host.

## Authority (live)

| Layer                  | Result                                                                     |
| ---------------------- | -------------------------------------------------------------------------- |
| Overlay, no stored row | Free `maxBoards=2` `maxPosts=50` `maxTeamSeats=1`. Not unlimited.          |
| Entitlements           | All paid grants false (`webhooks` `mcp` `workflows` `sso` `customDomain`). |
| Upgrade                | Growth monthly **303** `checkout.stripe.com` `cs_test_`.                   |
| Portal                 | **403** `billing_action_unavailable`.                                      |

## Matrix

| State × key                         | UI / HTTP          | Server            | Signal |
| ----------------------------------- | ------------------ | ----------------- | ------ |
| Free `maxBoards` 2                  | overlay 2          | not Pro leftover  | L      |
| Free `maxPosts` 50                  | overlay 50         | not unlimited     | L      |
| Free `maxTeamSeats` 1               | overlay 1          | seat 1            | L      |
| Free `webhooks` / `workflows` / mcp | entitlements false | false             | L      |
| Free `sso`                          | `/sso/new` **404** | no create fields  | L      |
| Free `customDomain`                 | entitlement false  | provider not used | S      |
| Free upgrade                        | **303** `cs_test_` | names checkout    | L      |
| Free portal                         | **403** named      | cannot manage     | L      |

Both t7 hosts agree. t1a/t1e paid fixtures unchanged.
