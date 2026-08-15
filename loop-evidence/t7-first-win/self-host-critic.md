# PASS — self-host General has no cloud URL (Bar C)

Independent re-run 2026-08-15 on `8cb12d5f1`. No deploy (self-host
surface; live cloud pair unchanged `25319ded`). No Neon.

| Probe                    | Result                                                |
| ------------------------ | ----------------------------------------------------- |
| `LocalWorkspaceNameCard` | Workspace Name only; no Quackback URL; no `ws-*`      |
| `CloudWorkspaceDetails`  | URL field empty; no generated host as the input value |
| Settings nav             | Plan & billing absent when billing is off             |
| Admin sidebar            | Switch workspace absent when cloud is off             |
| Tests                    | 12/12                                                 |

Did **not** stand up a local self-host server or walk support / HC /
internal on live hosts.
