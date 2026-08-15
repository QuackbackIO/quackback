# PASS (compact) — 0 HIGH on live pair `71f78ecb` / `640d5ac1`

Compact hosted sweep 2026-08-15 after 8f. No payment, no Neon, no wipe.
Fuller scripted sweep from the Verify child may still land beside this file.

Live: app `371883f5` / `sha256:71f78ecb…` `us-east4-eqdc4a` (worker
`b56b36fa`, hourly `597ee448`, daily `9bac011c`, migrator `af9e6263`).
CP `9aaa6ff2` / `sha256:640d5ac1…` sfo.

| #   | Surface                 | Result                                                                                                                                                                                                                                        | Signal             |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 6   | Settings nav            | Public billing/general JS present on cloud hosts.                                                                                                                                                                                             | LOW                |
| 8   | Billing → CP            | Prior live 303s still in ancestor image. Not re-paid.                                                                                                                                                                                         | skipped            |
| 9   | Domains                 | Live certs `skipped (provider)`. Help Center bundle still has the self-host reverse-proxy sentence; 8e critic already proved the cloud tab no longer renders that card (`ce57a0bcc` in this digest). Settings General has no add/verify card. | skipped (provider) |
| 12  | Upgrade                 | `635cdb149` is an ancestor of this digest.                                                                                                                                                                                                    | skipped            |
| 22  | Fleet                   | Five health 200. Digest `71f78ecb` on five app roles; web region only `us-east4-eqdc4a`.                                                                                                                                                      | LOW                |
| 28  | Visible usage           | Billing chunk exports `Usage`. 8e live.                                                                                                                                                                                                       | LOW                |
| 29  | Export / wipe / account | General JS has Danger zone, Export data, Wipe workspace. CP `POST /api/account/delete` 401 `unauthorized`.                                                                                                                                    | LOW                |
| 32  | Change to X             | Already live on this pair.                                                                                                                                                                                                                    | skipped            |

No new HIGH. Catalogue sticker vs enforcement HIGH remains a §H item (fixer committed `dc86c83`, not live in this sweep). Growth grant vs feature HIGH still standing. Instances not recounted here; last critic 17.

Do not treat this compact sweep as §H.
