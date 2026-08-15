# PASS (0 HIGH)

Compact Verify of live pair app `e20c0eef` / `sha256:895b942d…`
`us-east4-eqdc4a` and CP `b7ae7455` / `sha256:45b9aebb…`. Re-signed
2026-08-15T10:58Z after the t1e period-end Growth schedule. No
payment, no Neon, no wipe, no hostname add. Facts: `sweep-e20c0eef.json`.

| #     | Surface      | Result                                                              | Signal |
| ----- | ------------ | ------------------------------------------------------------------- | ------ |
| 5     | Admin inbox  | t1a + t1e **200**                                                   | LOW    |
| 8     | Billing → CP | t1a Pro **409**; t1e Scale **409**; portals **303**; Origin **403** | LOW    |
| 11–12 | Plans        | t1a Pro, t1e Scale, t7 Free. Overlay not unlimited                  | LOW    |
| 13    | Portal       | Paid **303** `billing.stripe.com`; t7 **403** named                 | LOW    |
| 18    | Isolation    | Foreign cookie **401** `unauthorized`                               | LOW    |
| 20    | Fail closed  | Unauth delete/restore **303** `/auth/login`                         | LOW    |
| 22    | Fleet        | Four ready **200**; digest `895b942d`                               | LOW    |
| 23    | Soft-delete  | No row removed                                                      | LOW    |

## HIGH

None.

## Instance count

19 before, 19 after.
