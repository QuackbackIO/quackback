# PASS — live CP catalogue stickers match enforcement numbers

Independent live probe 2026-08-15 after CP `dc86c83` / deploy `3006af01`
(`sha256:8edadea8…`, sfo). App pair unchanged `371883f5` / `sha256:71f78ecb…`
`us-east4-eqdc4a`. `GET /api/v1/internal/billing/catalogue` with t1a instance
credential **200**. Instances **17→17**. No payment, no Neon, no wipe.

| Check                          | Result                                     |
| ------------------------------ | ------------------------------------------ |
| Four plans                     | free, growth, pro, scale                   |
| Free posts                     | `2 boards · 50 posts` — no unlimited posts |
| Growth posts                   | `3 boards · 50 posts` — no unlimited posts |
| Growth integrations / webhooks | absent from highlights                     |
| Growth seats                   | `1 teammate seat`                          |
| Pro API                        | no `1M API`                                |
| Pro seats                      | `10 teammate seats`                        |

Did not change `PLAN_GRANTS` / Growth feature flags (dual-layer HIGH still open).
