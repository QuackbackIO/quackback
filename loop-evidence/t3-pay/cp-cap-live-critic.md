# PASS — CP `80c8301e` serves the per-owner 3-Free cap; 4th Free 402; no Neon.

Independent of the builder session. No payment, no custom-domain start, no leftover probe rows.

## Deploy

- CP `80c8301e` SUCCESS, digest `sha256:3d10454a80267546478e184379b66fd71acccf9c2eda26de9ddd3dbcfc096c45` (code `2fb9488`, includes `c5a484d`).
- Live files: `/app/src/lib/server/instances/free-workspace-cap.ts` exports `MAX_LIVE_FREE_WORKSPACES_PER_OWNER = 3` and `free_workspace_owner_cap`.
- App fleet unchanged: web `47e0c7be` / `sha256:cb186135…`. Gauntlet ready 200.

## Live 4th-Free (no Neon)

Two temporary live-Free `cp_instances` rows (no provision, no Neon) raised t1e owner’s live-Free count 1 → 3. `_internal_createInstance` then:

- 402, message contains `free_workspace_owner_cap`
- `insertInstance` not called
- `startProvisioning` not called

Temps deleted. Critic SQL: instances **16**, leftover cap-probe rows **0**, t1a and t1e present.
