# PASS — Scale SSO enforce then fail-open; admins not locked out.

Independent live probe on t1e. Dummy credential row only (no public issuer). Probe rows deleted.

## Pair

- App `e20c0eef` / `sha256:895b942d…`. CP `3a9bc4ee`.
- Credential present → provider registers. Credential removed → IdP not viable (same as downgrade / missing secret).

## Live

| Phase                  | Password                               | Magic-link                             |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| Enforce (cred present) | **302** `verified_domain_requires_sso` | **302** `verified_domain_requires_sso` |
| Fail-open (cred gone)  | **302** `password_method_not_allowed`  | **200** (no SSO error)                 |

Cleanup: identity_provider 0, sso_verified_domain 0, loop creds 0.

Facts: `sso-enforce.json`.
