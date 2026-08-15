# Critic (2026-08-14, cloud Help Center local writer `ce57a0bcc`)

PASS — live cloud Help Center Domains tab no longer shows the reverse-proxy
writer; digest `sha256:47e64d52…` in `us-east4-eqdc4a`; instances 17→17.

| Probe                                                       | Result                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Web `b14470ee` digest                                       | `sha256:47e64d528fbc71277968efacb9b6c535a59756e07c5ee8ad1dabe705f3c82f8d`   |
| Region                                                      | `us-east4-eqdc4a` only                                                      |
| Ready                                                       | gauntlet / south / north 200                                                |
| Replica                                                     | `HC_DOMAIN_CLOUD_MANAGED` in `help-center-domain.service-BoZ93AZX.mjs`      |
| t1a `GET /admin/settings/help-center?tab=domains-languages` | 200; 0× “TLS terminates”; 0× Custom domain card; Help Center chrome present |
| Instances                                                   | 17 → 17                                                                     |

Did not start Cloudflare for SaaS. Did not create Neon. Did not pay.
Focused tests 29/29 before deploy.
