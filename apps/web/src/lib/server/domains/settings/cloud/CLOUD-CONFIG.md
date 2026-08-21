# Cloud projection boundary

Self-hosted workspaces have no `settings.cloud` value. They retain unrestricted
OSS behavior, show no commercial navigation or upgrade prompts, and make no
control-plane request during normal use.

Cloud workspaces accept one signed, workspace-bound billing projection through
the internal projection endpoint. Projection versions are monotonic: identical
replays are idempotent, lower versions are rejected, and conflicting payloads
at the same version fail closed.

The projection contains only the effective plan, trial/subscription dates and
status, entitlements, numeric limits, and allowed billing actions. Provider
customers, subscriptions, prices, keys, and webhook data never enter a
workspace database or process.

Entitlements and numeric limits are enforced from the latest local projection.
At `planLimitsExpireAt`, reads switch to the projected Free limits and
entitlements immediately, without a control-plane call or sweeper. Checkout
and portal actions are the only runtime operations that require the control
plane; they fail with a retryable response during an outage.
