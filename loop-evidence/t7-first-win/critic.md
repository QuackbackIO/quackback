# PASS — live launch plan + first-win card (not the five-outcome walk)

Independent critic 2026-08-15 on app `371883f5` / `sha256:71f78ecb…`
`us-east4-eqdc4a`. No deploy, no Neon, no pay, no wipe. Instances unchanged.

| Probe                                        | Result                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET …/assets/getting-started-DvgW2s7H.js`   | 200 “Your launch plan” + `first_win`                                                                        |
| `GET …/assets/launch-checklist-C-ROpigZ.js`  | 200 outcome first-win titles (post/vote, conversation, article, team idea) + Copy board / Connect Messenger |
| `GET …/assets/activation-action-JARzZW_-.js` | 200 one-primary-action helpers                                                                              |
| Verify row 3                                 | `/admin/getting-started` 200 primary **Copy board link** (t1a product feedback)                             |
| Focused tests                                | 30/30 (`plg-events`, `launch-checklist`, `activation-wins`)                                                 |
| PLG vocabulary                               | `first_win_reached` + bounded fields; extras/URLs/emails rejected                                           |

Did **not** walk a fresh mailbox through support / Help Center / internal /
self-host. Those journeys remain.

Health: gauntlet/south/north already 200 on this digest.
