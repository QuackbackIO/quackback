# PASS — enforced SSO domain with no registered IdP does not lock admin sign-in.

Independent live probe on t1e Scale. No real issuer, no Stripe, no Neon. Probe IdP + enforced domain inserted then deleted.

## Pair

- App `e20c0eef` / `sha256:895b942d…`. CP `3a9bc4ee`.
- t1e owner domain `guerrillamail.com`. IdP row had no credential (not registered).

## Live

| Call                                | Result                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------- |
| POST `/api/auth/sign-in/email`      | **302** `password_method_not_allowed` (not `verified_domain_requires_sso`) |
| POST `/api/auth/sign-in/magic-link` | **200**, no SSO error                                                      |
| Cleanup                             | identity_provider 0, sso_verified_domain 0                                 |

Fail-open unit 3/3 already on `hooks-before`. Did not add a working IdP or downgrade the plan.

Facts: `sso-failopen.json`.
