# PASS — live `7057e905` / `sha256:27c538ec…` catalogue UpgradeOffer on locked creates; mixed pages stay up

Independent live critic 2026-08-15T17:48Z. Exercised the Development fleet after Docker #31898534925 (`e56d00b9a`). Did not deploy, pay, create Neon, start custom domains, wipe, merge, or commit. Owner sessions minted via `railway run` on CP `f06ac2e2` + tenant `one-time-token:` + `/auth/open-handoff`. Cookies stayed in `/tmp`.

## 1. Live image

- Web `7057e905` **SUCCESS** `meta.imageDigest` **exactly** `sha256:27c538ec143d31f526e7aa8c0042f73c601db04e54c6eaa69240dd06844c2397`. `multiRegionConfig` keys only `us-east4-eqdc4a`.
- Worker `796aba45`, hourly `4b927894`, daily `0de9564e`, migrator `f92d2783` same digest, same region.
- Docker workflow `31898534925` success, `headSha` `e56d00b9ac8114816cfabc014e1e4479b6d25b0f`.
- CP live is `9030705d` (`sha256:d84fd27c…`, sfo). Expected prior `4a5ea8d7` is REMOVED. This critic did not redeploy CP.
- Health 200 `role=web`: `https://gauntlet.quackback.co.uk/api/health/ready`, `south63792f`, `sup9ca3a708`, `hc9ca3a708`.

## 2. Pro Access & Security stays up

Host `https://south63792f.quackback.co.uk` (`inst_01m00kq6cdfzzb19gfjz8pt0s7`, plan `pro`, Pro trial banner). Session consume **200**. Cookie GET + Playwright document:

| Path                                      | HTTP    | Chrome                                                                                      | DefaultErrorPage |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------- | ---------------- |
| `/admin/settings/security/authentication` | **200** | Access & Security, Portal access, Public/Private, Account signup                            | no               |
| `?tab=sign-in`                            | **200** | Email / social providers                                                                    | no               |
| `?tab=audit-log`                          | **200** | Audit tab stays mounted as in-route **Upgrade to Scale** (`$89` /seat/mo, Scale highlights) | no               |

No raw error dump. Mixed Access & Security page did not crash when audit is a Scale entitlement.

## 3. Free locked creates show the catalogue offer

Host `https://sup9ca3a708.quackback.co.uk` (`inst_01m021rrsdfan9v4bzpcec2g3z`, plan `free`). Session consume **200**. Plan & billing (`11-t7-billing.png`) shows the same catalogue: Growth `$25` /seat/mo · `$300` billed yearly; Pro `$49` / `$588`; Scale `$89` / `$1,068`; same highlight lists.

| Action                                                     | Result                                                      | Offer                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Developers `?tab=webhooks` → **Create your first webhook** | modal, page stays on Developers                             | **Upgrade to Growth** · “Webhooks are a Growth feature…” · `$25` / `$300` · 5 Growth highlights · Upgrade to Growth / Maybe later |
| Developers `?tab=mcp` → **Enable MCP Server** (from off)   | modal, switch stays off                                     | **Upgrade to Growth** · “The MCP server is a Growth feature…” · same Growth price + highlights                                    |
| Workflows **New workflow** → Create from template          | modal, list chrome stays                                    | **Upgrade to Pro** · “Workflows are a Pro feature…” · `$49` / `$588` · 6 Pro highlights                                           |
| `/admin/settings/macros`                                   | **in-route UpgradeScreen** (no dialog), Macros header stays | **Upgrade to Growth** · “AI drafts are a Growth feature…” · same Growth catalogue                                                 |

First MCP click found the toggle already **on** and turned it **off** (disable is not an upgrade). Second click from off opened the catalogue modal (`17-t7-mcp-upgrade.png`). Toggle left off. No DefaultErrorPage on any refusal.

## 4. Mixed Developers page stays up

`GET /admin/settings/developers` **200**. Keys tab lists chrome: Developers header, Keys / Webhooks / MCP tabs, API Keys empty state + Create your first API key, Quick Start. Webhooks tab lists chrome with Create your first webhook. No DefaultErrorPage / raw dump while create is locked.

## 5. Cloud-off from the live image JS (not tests)

Fetched live chunks from `sup9ca3a708` after the authenticated walk.

`/assets/index-pLVwKoNa.js` `function RM` (UpgradeOffer):

- `billingEnabled:t` from `__root__`
- catalogue query `enabled:!!t` — no catalogue fetch when billing is off
- CTA: `i&&n&&t` → checkout `POST /api/billing/session`; else `t` → “See plans”; else **null** (no checkout, no billing CTA)

`/assets/settings.billing-OIcpRw3k.js` `function k`: `billingEnabled` ? billing cards : “Plan and billing is available only in a Quackback Cloud workspace.”

No self-hosted host was available on this fleet; the shipped chunk is the cloud-off gate.

## Screenshots

`loop-evidence/this-fire/p2-upgrade/` (`01`–`03` t1a, `10`–`17` t7 developers/billing/MCP, `20`–`21` workflows, `30` macros).
