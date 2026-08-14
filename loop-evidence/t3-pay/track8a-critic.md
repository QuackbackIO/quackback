# PASS — Track 8a on CP `e8953f9b`: restore 402s at three live Free; 30-day purge; owner-only.

Focused tests 60/60 (`instance-lifecycle-fn` 31, `instance-fn` 22, `one-screen` 7). Live replica:

- digest `sha256:06e7f5d3378209be736a98f18eb69945c16d1f1807da06632c7d68db10387c85`
- `SOFT_DELETE_PURGE_GRACE_DAYS = 30`
- restore uses `queryCountLiveFreeOwnedBy`; owner-only 403; expired `purgeAt` 409

No Neon. Instances 16. Did not soft-delete t1e. Dashboard session OTP was not re-read (identifier shape); critic did not click Delete.
