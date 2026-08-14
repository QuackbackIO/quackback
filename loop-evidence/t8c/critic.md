# Critic (2026-08-14, Track 8c transfer/leave)

PASS — live CP ownership/leave fail closed with named reasons; paid t1a
not transferred; instances 17→17; app image `sha256:52e78237…` in
`us-east4-eqdc4a` only.

Orchestrator live probe (named critic spawn did not join). HTTP:
`probe-http.json`. Count: `probe-count.json`.

| Probe                               | Result                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Web `93838859` digest               | `sha256:52e78237d2b6c9069600d42975637e3e8c4589fbeeae3fe16f44622d71e8bb87`                                  |
| Region                              | `us-east4-eqdc4a` only on web/worker/hourly/daily/migrator                                                 |
| CP `6f0b0fee`                       | SUCCESS `sha256:25b24e49…` (sfo, unchanged)                                                                |
| Five health URLs                    | 200                                                                                                        |
| Replica                             | `Transfer ownership` in `settings.members-oiuN0r31.mjs`; `leaveCloudWorkspace` in `ownership-47kKwhI9.mjs` |
| GET/POST ownership, no/dummy bearer | 401 `unauthorized`                                                                                         |
| POST leave, no/dummy bearer         | 401 `unauthorized`                                                                                         |
| extras `workspaceId` / `instanceId` | 400 `Invalid input`                                                                                        |
| t1a/t1e transfer stranger           | 403 `not_teammate`                                                                                         |
| t1a transfer self                   | 400 `already_owner`                                                                                        |
| t1a/t1e owner leave                 | 403 `owner_cannot_leave`                                                                                   |
| empty / extras leave body           | 400 `Invalid input`                                                                                        |
| GET ownership t1a/t1e               | 200 `{ ownerEmail }`                                                                                       |
| Instances                           | 17 → 17; t1a and t1e remain                                                                                |

Did not complete a real transfer (would move fixture ownerEmail).
Did not create Neon. Did not pay.
