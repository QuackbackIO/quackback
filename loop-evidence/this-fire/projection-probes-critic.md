# PASS — replay, stale version, paid-vs-trial clock

Live pair `95610fd8` / `sha256:40be439d…` + CP `7cecf06d`. No deploy,
no pay, no Neon. Instances 19→19. t1e projection stayed v5 Growth.

| Probe                                                  | Result                                             |
| ------------------------------------------------------ | -------------------------------------------------- |
| Idempotent replay of current signed billing projection | **204**                                            |
| Stale version (v4 token)                               | **409** `stale_version`                            |
| Garbage token                                          | **401** `invalid_projection`                       |
| Paid Growth while trialExpiresAt is still set          | overlay still Growth 3 boards                      |
| Product from cached projection                         | ready 200, public board 200                        |
| Unit exact-expiry + monotonicity                       | 12/12 `billing-projection` + `identity-projection` |

Did not take the live CP down (fleet-wide). Outage bar for _billing
actions_ remains: they are CP-proxied and already fail named (409/403/503).
`this-fire/projection-probes.json`.
