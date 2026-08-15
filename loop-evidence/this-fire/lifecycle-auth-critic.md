# PASS — unauth delete/restore is 303 `/auth/login`, not 500.

Independent live POST. CP `3a9bc4ee` `sha256:aed43943…` (code `ef31b2a`). App pair unchanged `e20c0eef` / `sha256:895b942d…`. No payment, no Neon, no wipe.

| Call                                        | Result                 |
| ------------------------------------------- | ---------------------- |
| POST `/api/instances/t1a/delete` no cookie  | **303** `…/auth/login` |
| POST `/api/instances/t1a/restore` no cookie | **303** `…/auth/login` |
| POST `/api/instances/t1e/restore` no cookie | **303** `…/auth/login` |

t1a and t1e `deleted_at` still null. Instances **19→19**. Tests 6/6.

Location scheme is `http` behind TLS termination (LOW).
