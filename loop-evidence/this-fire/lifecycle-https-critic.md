# PASS — unauth delete/restore 303 is `https://cp.quackback.co.uk/auth/login`.

Independent live POST. CP `b7ae7455` `sha256:45b9aebb…` (code `8e4c00a`). App pair unchanged. Tests 8/8. No payment, no Neon, no wipe.

| Call                                        | Result                                          |
| ------------------------------------------- | ----------------------------------------------- |
| POST `/api/instances/t1a/delete` no cookie  | **303** `https://cp.quackback.co.uk/auth/login` |
| POST `/api/instances/t1a/restore` no cookie | **303** `https://cp.quackback.co.uk/auth/login` |
