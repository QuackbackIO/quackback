# PASS — product kept last-projection access; billing 503 with retry copy; recovered.

Independent of the builder session. Web-only CP origin blackhole (same image `sha256:895b942d…`, `us-east4-eqdc4a`). CP process stayed up. No payment, no Neon, no wipe.

## Pair

- Outage web `3f4a09b0` then restore `e20c0eef`, both `sha256:895b942d…`, region only `us-east4-eqdc4a`.
- CP `7cecf06d` unchanged.
- t1a `south63792f` owner session minted via SQL + `/auth/open-handoff`.

## Live

| Phase           | Inbox   | Scale checkout                    | Same-plan Pro             |
| --------------- | ------- | --------------------------------- | ------------------------- |
| baseline        | **200** | **303** `billing.stripe.com`      | **409** `already_on_plan` |
| outage (critic) | **200** | **503** `temporarily unavailable` | **503** same retry copy   |
| recovered       | **200** | **303** `billing.stripe.com`      | **409** `already_on_plan` |

Ready 200 throughout. Public home 307. Not a 500. Instances **19→19**.

Facts: `cp-outage-baseline.json`, `cp-outage-outage.json`, `cp-outage-critic.json`, `cp-outage-recovered.json`.
