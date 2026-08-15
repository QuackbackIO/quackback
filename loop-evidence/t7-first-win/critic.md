# PASS — product-feedback first-win on t1a (not the five-outcome walk)

Independent live probe 2026-08-15 after leftover-access fix `52c1ab397`.
App `c5d64208` / `sha256:25319ded…` `us-east4-eqdc4a`. Critic spawn was
unjoinable; orchestrator re-hit the live URLs. No Neon, no pay, no wipe.
Instances 17.

| Probe                                                           | Result                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Public `GET https://south63792f.quackback.co.uk/?sort=trending` | 200 titled Feedback; body contains `First customer idea`                                                  |
| Signed-in public board                                          | After deploy, hydrates (placeholder present, no React #419). Submit posted `First customer idea dd838bc5` |
| Owner `/admin/getting-started`                                  | 200 “Your launch plan” + “You’re up and running”                                                          |
| Tenant counts                                                   | t1a posts=1 externalPosts=1 externalVotes=1; t1e still 0                                                  |
| Fleet                                                           | five health URLs 200; digest `25319ded`; web region only `us-east4-eqdc4a`                                |
| Instances                                                       | 17 before and after; t1a/t1e remain                                                                       |

Did **not** walk support / Help Center / internal / self-host. Those
journeys remain and need new workspaces or a local self-host host.

Prior crash (Railway `board.access.moderation.signedPosts`, skeleton
board) is gone on this digest.
