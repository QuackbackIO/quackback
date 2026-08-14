# Verify re-sweep row 15 — PASS (HIGH closed)

2026-08-14 after live image `sha256:cb186135…` / web `47e0c7be`.
Instances 16. No payment, no Neon, no custom-domain start.

| host          | stored `tier_limits` | projection       | resolved `maxBoards` | unlimited? |
| ------------- | -------------------- | ---------------- | -------------------- | ---------- |
| t1a Growth    | null                 | plan 3 / free 2  | **3**                | no         |
| t1e trial Pro | null                 | plan 10 / free 2 | **10**               | no         |

`resolveEffectiveTierLimits(null, liveProjection)` matches `planLimits.maxBoards`.
Previous HIGH (OSS unlimited overlay) is gone.

Health 200: gauntlet, south63792f, northfa99f0. App digest unchanged `cb186135`.
`withWorkspaceScopeById` → `getTierLimits` was not invoked in-process (web `SECRET_KEY` not in CP `railway run`). Overlay is the same function the live bundle ships.
