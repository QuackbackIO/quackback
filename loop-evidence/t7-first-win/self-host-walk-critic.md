# PASS — local self-host Bar C + internal first-win

Independent re-probe 2026-08-15 on `http://localhost:3000` (cloud absent,
role=all). No deploy (self-host surface; live cloud pair unchanged
`25319ded` / `c5d64208`). No Neon. First sign-in 429'd the credential
limiter; buckets `signin:credential:*` cleared; retry 200.

| Probe                      | Result                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health/ready`    | 200 `role=all`                                                                                                                      |
| Sign-in `demo@example.com` | 200 session cookie                                                                                                                  |
| `/admin/settings/general`  | Workspace Name only (`Acme Corp`); no Quackback URL; no `ws-*`; settings nav has no Plan & billing; sidebar has no Switch workspace |
| `/admin/getting-started`   | Goal **Internal feedback**; “You’re up and running”; milestone **Collect your first team idea** (13 Jul 2026)                       |
| Trial / Upgrade            | absent on both pages                                                                                                                |

Shots: `self-host-walk/critic-general.png`, `self-host-walk/critic-launch.png`.
Facts: `self-host-walk/critic-facts.json`.

Did **not** walk support / Help Center on live hosts (no Neon).
Did **not** change the live fleet.
