# PASS — live pair: General export/wipe copy is served; wipe fail-closed; account delete 401 then 403 `account_has_live_workspaces`; instances 17→17.

Independent critic at 2026-08-15T01:19:31Z. Exercised `https://cp.quackback.co.uk` deploy `9aaa6ff2` (`sha256:640d5ac1…`, sfo) and web `371883f5` (`meta.imageDigest` `sha256:71f78ecb9f4ef3a3c4eab729b8265ed462cf359a66fd08f73c41b829a43fca80`, region only `us-east4-eqdc4a`). Local commits `e22e3884e` (`feat(admin): export or wipe from General`) and CP `940c984` (`feat(create): wipe a workspace and delete the account`). Instance credentials derived via `railway run` on CP `f06ac2e2` (HKDF + `qbint_` HMAC). Did not wipe, restore, transfer, pay, create Neon, start custom domains, deploy, or merge. Did not POST a real `{confirm:wipe}`-only body with a valid instance credential.

## Deploy

Expected app digest `sha256:71f78ecb…`. `serviceManifest.deploy.multiRegionConfig` keys are only `us-east4-eqdc4a` on web/worker/hourly/daily/migrator. CP region `sfo` is accepted.

| role          | service    | deployment | status  | digest     | regions         |
| ------------- | ---------- | ---------- | ------- | ---------- | --------------- |
| web           | `0b821c4a` | `371883f5` | SUCCESS | `71f78ecb` | us-east4-eqdc4a |
| worker        | `9cd4a749` | `b56b36fa` | SUCCESS | `71f78ecb` | us-east4-eqdc4a |
| hourly        | `bb8fc6ee` | `597ee448` | SUCCESS | `71f78ecb` | us-east4-eqdc4a |
| daily         | `4bd70297` | `9bac011c` | SUCCESS | `71f78ecb` | us-east4-eqdc4a |
| migrator      | `6e836ccb` | `af9e6263` | SUCCESS | `71f78ecb` | us-east4-eqdc4a |
| control-plane | `f06ac2e2` | `9aaa6ff2` | SUCCESS | `640d5ac1` | sfo             |

## Health

| URL                                                                  | status | reason                         |
| -------------------------------------------------------------------- | ------ | ------------------------------ |
| `GET https://gauntlet.quackback.co.uk/api/health/ready`              | 200    | `{"status":"ok","role":"web"}` |
| `GET https://south63792f.quackback.co.uk/api/health/ready`           | 200    | t1a friendly ready             |
| `GET https://northfa99f0.quackback.co.uk/api/health/ready`           | 200    | t1e friendly ready             |
| `GET https://ws-bf8e1c4affe270eb5a6dda1a.quackback.co.uk/api/health` | 200    | t1a system                     |
| `GET https://ws-4a048e07941c5e7840e986c0.quackback.co.uk/api/health` | 200    | t1e system                     |

## HTTP transcript (export / wipe / account)

Token hashes for t1a and t1e match `cp_instances.internal_token_hash`. Extras and `{confirm:yes}` are rejected as `Invalid input`. A real wipe was not posted. Account delete without a session is `unauthorized`. A live t1a-owner CP session (mailbox OTP; not the operator mailbox) then `POST /api/account/delete` → 403 `account_has_live_workspaces`.

| probe                     | URL                                                                        | status | reason                        |
| ------------------------- | -------------------------------------------------------------------------- | ------ | ----------------------------- |
| DELETE no session         | `POST /api/account/delete`                                                 | 401    | `unauthorized`                |
| wipe no bearer            | `POST /api/v1/internal/lifecycle/soft-delete`                              | 401    | `unauthorized`                |
| wipe dummy bearer         | `POST /api/v1/internal/lifecycle/soft-delete`                              | 401    | `unauthorized`                |
| wipe extra `instanceId`   | `POST /api/v1/internal/lifecycle/soft-delete` `{confirm:wipe,instanceId}`  | 400    | `Invalid input`               |
| wipe extra `workspaceId`  | `POST /api/v1/internal/lifecycle/soft-delete` `{confirm:wipe,workspaceId}` | 400    | `Invalid input`               |
| wipe `{confirm:yes}`      | `POST /api/v1/internal/lifecycle/soft-delete`                              | 400    | `Invalid input`               |
| DELETE live owner session | `POST /api/account/delete`                                                 | 403    | `account_has_live_workspaces` |

## Live replica / public JS

Web replica `371883f5` `/app/.output`:

- `Wipe workspace` in `_ssr/settings.general-Z0jovu3j.mjs` and public `assets/settings.general-CpncR1fM.js`
- `Export workspace data` in `assets/export-workspace-action-ypBRNNxJ.js` (General chunk imports that file)

CP replica `9aaa6ff2` `/app/.output`:

- `Delete account` / `account/delete` / `account_has_live_workspaces` in `public/assets/dashboard.index-DHS8vkfy.js` and `_ssr/dashboard.index-CzDg2Zuq.mjs`

Served:

- `GET https://south63792f.quackback.co.uk/assets/settings.general-CpncR1fM.js` **200** contains `Wipe workspace` and `export-workspace-action-ypBRNNxJ.js`
- `GET https://south63792f.quackback.co.uk/assets/export-workspace-action-ypBRNNxJ.js` **200** contains `Export workspace data`
- `GET https://cp.quackback.co.uk/assets/dashboard.index-DHS8vkfy.js` **200** contains `Delete account`

## Instances

`cp_instances` **17 → 17**. Same id set. t1a and t1e remain `active` / not deleted. `added=[]` `removed=[]`. Recount 17. Owner fingerprints unchanged (`t1a=4937eb201c84`, `t1e=82568e5500c3`).
