# PASS — limits overlay is live on `sha256:cb186135…` in us-east4-eqdc4a.

Independent check after Docker `31843458993` (`saas` `f0186af2b`, includes `b0c13a366` / `31330d85b`). No payment, no Neon, no new workspace.

## Deployments

Expected `ghcr.io/quackbackio/quackback@sha256:cb18613577d7acc9e6882acd1bf52c7a88576f5d4f1be50adf84269f1d66a166`.
`multiRegionConfig` keys are only `us-east4-eqdc4a`.

| role     | deployment | status  | digest     |
| -------- | ---------- | ------- | ---------- |
| web      | `47e0c7be` | SUCCESS | `cb186135` |
| worker   | `4576ca28` | SUCCESS | `cb186135` |
| hourly   | `bac96be0` | SUCCESS | `cb186135` |
| daily    | `4b77de9d` | SUCCESS | `cb186135` |
| migrator | `ced6922a` | SUCCESS | `cb186135` |

## HTTP

- `GET https://gauntlet.quackback.co.uk/api/health/ready` **200** `role: web`
- `GET https://south63792f.quackback.co.uk/api/health/ready` **200**
- `GET https://northfa99f0.quackback.co.uk/api/health/ready` **200**

## Live artifact

Web replica `47e0c7be` defines `resolveEffectiveTierLimits` and `cloudProjectionFloor` in `/app/.output/server/_ssr/tier-limits.service-CebRfkr6.mjs`. Comment: “No row + cloud off (no projection) stays OSS unlimited.”

Did not create boards or complete a payment.
