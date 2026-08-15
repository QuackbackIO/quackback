# Upgrade offer SSR critic

Independent live critic 2026-08-15T19:09Z. Exercised t7 Free
`https://sup9ca3a708.quackback.co.uk` on web `035205ad`
(`sha256:52a2ae7d…`, `us-east4-eqdc4a`) from app `a8c673417`
(`feat(settings): SSR upgrade offers from the billing catalogue`).
Did not deploy further, pay, create Neon, start custom domains, or
wipe a workspace.

First HTML (no client fetch) on signed-in GETs:

| Path                                                    | 200 | Headline          | Annual sticker | `billed yearly` |
| ------------------------------------------------------- | --- | ----------------- | -------------- | --------------- |
| `/admin/settings/integrations`                          | yes | Upgrade to Pro    | `$49`          | yes             |
| `/admin/settings/macros`                                | yes | Upgrade to Growth | `$25`          | yes             |
| `/admin/settings/security/authentication?tab=audit-log` | yes | Upgrade to Scale  | `$89`          | yes             |

Each page only printed its own plan sticker (not the full catalogue).
Checkout form is present (`Upgrade to {plan}`). No Neon. Instances
unchanged.

**PASS**
