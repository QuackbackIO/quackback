# PASS — Change goal UI walks support + Help Center first-win

Independent re-probe 2026-08-15 on `http://localhost:3000` (cloud
absent). No deploy. No Neon. Previous fire’s picker miss was a
too-early click / `sr-only` radio; after `networkidle` the Change
goal card opens and `Use this goal` saves.

| Probe                           | Result                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Change goal → Customer support  | Ready **Connect Messenger**; milestone **Receive your first customer conversation**; “You’re up and running” |
| Change goal → Help Center       | Ready **Open Help Center**; milestone **Publish your first article** (21 Jul 2026)                           |
| Change goal → Internal feedback | Restored; useCase `internal`                                                                                 |
| Bar C                           | no Plan & billing / trial                                                                                    |

Shots: `self-host-changegoal/critic-support.png`,
`self-host-changegoal/critic-help-center.png`.

Did **not** walk support / HC on live Development hosts (no Neon).
