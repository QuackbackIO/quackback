# PASS — PLG emit skips self-host and stays bounded

Independent re-run 2026-08-15 on `3b4556ae2`. No deploy (tests-only).
Live pair unchanged `25319ded`. No Neon.

| Probe        | Result                                                         |
| ------------ | -------------------------------------------------------------- |
| Cloud off    | `emitPlgEvent` does not log                                    |
| Cloud on     | one `plg_event` with name/outcome/surface/action/artifact only |
| Extra fields | parse rejects email; no log                                    |
| Tests        | 9/9 (`plg-events-emit` + `plg-events`)                         |

Did **not** walk support / HC / internal on live hosts.
