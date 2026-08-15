# PASS — local self-host support + Help Center first-win

Independent re-probe 2026-08-15 on `http://localhost:3000` (cloud
absent). No deploy (self-host surface; live pair unchanged
`25319ded`). No Neon. `useCase` flipped locally then restored to
`internal`.

| Probe                   | Result                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ready                   | 200 `role=all`                                                                                                                                         |
| Goal `customer_support` | Launch plan **Customer support**; milestone **Receive your first customer conversation**; “You’re up and running”; Ready primary **Connect Messenger** |
| Goal `help_center`      | Launch plan **Help Center**; milestone **Publish your first article** (21 Jul 2026); “You’re up and running”                                           |
| Bar C                   | no Plan & billing / trial on those pages                                                                                                               |
| Restore                 | `settings.setup_state.useCase` is `internal`                                                                                                           |

Shots: `self-host-outcomes/critic-support.png`,
`self-host-outcomes/critic-help-center.png`.

Did **not** walk support / HC on live Development hosts (no Neon).
