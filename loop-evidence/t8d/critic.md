# Critic (2026-08-15, 8d SSO lock + seat cap `46c1c602e`)

PASS — live Growth/trial `/sso/new` is the locked page (no create
fields); Members shows `1 of 1 seats` and a disabled Invite.
Digest `sha256:bc35ed23…` in `us-east4-eqdc4a`. Instances 17→17.

| Probe                                  | Result                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Web `5dcaf3bf` digest                  | `sha256:bc35ed23688e3bb465e167a9963a75185263e3b0396f44c5f830e8e1460e645f` |
| Region                                 | `us-east4-eqdc4a` only                                                    |
| Ready                                  | gauntlet / south 200                                                      |
| t1a `/admin/settings/security/sso/new` | 200; “not included on this plan”; 0× Display name / Client ID             |
| t1e same                               | 200; no create fields                                                     |
| t1a `/admin/settings/team`             | 200; `1 of 1 seats`; Invite disabled                                      |
| Replica                                | `sso-entitlement-*.mjs`, `settings.security.sso_.new-*.mjs`               |

Did not create an IdP. Did not send an invite. Did not pay. No Neon.
Focused tests 15/15 before deploy. First Docker of `6fadc0205`
failed import-protection; `46c1c602e` published.
