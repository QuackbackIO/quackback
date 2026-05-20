# Cloud metrics inventory

This runbook tracks every metric referenced by the cloud-ops alert rules
(planned for the v1 alert rule set in the platform observability stack).
Each entry lists the source exporter, a verification PromQL probe, and a
resolution status.

Status legend:

- `verified` — confirmed against a live Mimir/Prometheus instance with at
  least one non-empty sample.
- `TODO: live-verify` — metric name appears plausible from upstream
  exporter docs but has not been confirmed against the running cluster.
  **Launch precondition:** every TODO must move to `verified` (or be
  rewritten to a confirmed metric) before the alert rules are loaded into
  the Mimir ruler. Loading a rule that targets a non-existent metric
  produces a permanently-firing or permanently-silent alert depending on
  the operator and either is worse than no alert at all.
- `wrong-name → corrected to X` — initially drafted name was wrong; the
  alert rule was rewritten to use `X`. Listed for traceability.

## Controller / reconcile metrics

### `kube_customresource_status_phase`

- **Source:** kube-state-metrics, when configured to expose CRD status
  fields via `--custom-resource-state-config`.
- **Used by:** `QuackbackPhaseNotActive`,
  `ConfigReconcileStatusStale` (related sibling
  `kube_customresource_status_config_serverObservedAt_seconds`).
- **Verification:**
  ```promql
  kube_customresource_status_phase{group="quackback.io",resource="quackbacks"}
  ```
- **Status:** `TODO: live-verify`. The kube-state-metrics CRS config has
  to be wired up before this metric exists; the alert rule depends on
  the operator providing `--custom-resource-state-config` with a
  `Quackback` entry. If the CRS config is not yet shipped, the alert
  cannot fire.

### `kube_customresource_status_config_kind`

- **Source:** kube-state-metrics CRS, exposing
  `.status.config.kind` (`ok` | `error`) from the Quackback CR's
  reconciled-config sub-status.
- **Used by:** `QuackbackConfigReconcileError`.
- **Verification:**
  ```promql
  kube_customresource_status_config_kind{kind="error"}
  ```
- **Status:** `TODO: live-verify`. Same CRS-config dependency as
  `kube_customresource_status_phase`.

### `kube_customresource_status_config_serverObservedAt_seconds`

- **Source:** kube-state-metrics CRS, exposing
  `.status.config.serverObservedAt` as a unix-seconds gauge.
- **Used by:** `ConfigReconcileStatusStale`.
- **Verification:**
  ```promql
  time() - kube_customresource_status_config_serverObservedAt_seconds
  ```
- **Status:** `TODO: live-verify`. Same CRS-config dependency. The OSS
  pod also has to actually populate
  `.status.config.serverObservedAt` for this to read non-zero — wired by
  the controller's status reconciler.

### `controller_reconcile_errors_total`

- **Source:** the cp-quackback-controller process itself, via the
  controller-runtime `/metrics` endpoint.
- **Used by:** `QuackbackControllerReconcileErrors`.
- **Verification:**
  ```promql
  rate(controller_reconcile_errors_total[5m])
  ```
- **Status:** `TODO: live-verify`. The controller-runtime ecosystem
  exposes `controller_runtime_reconcile_errors_total` (note the
  `_runtime_` infix) by default; the bare `controller_reconcile_errors_total`
  is a custom name. Confirm whether the controller actually exports the
  bare form, and if not, rewrite the alert to
  `controller_runtime_reconcile_errors_total{controller="quackback"}`.

## Billing / Stripe

### `stripe_webhook_failures_total`

- **Source:** the CP web app (`/api/v1/stripe/webhook`) — counter
  incremented on signature-verify failure, downstream-handler error, or
  any 5xx returned to Stripe.
- **Used by:** `StripeWebhookFailures`.
- **Verification:**
  ```promql
  rate(stripe_webhook_failures_total[10m])
  ```
- **Status:** `TODO: live-verify`. Confirm the metric name matches what
  the CP exposes — the OSS pod's webhook handler does not exist (Stripe
  webhooks are CP-only), so this metric has to be exported from
  `quackback-cp`'s `/metrics` endpoint, not from the per-tenant pod.

## Tenant pod HTTP

### `http_responses_total`

- **Source:** the per-tenant Quackback pod's `/metrics` (scraped via the
  per-tenant scrape-target ConfigMap rendered by the controller — see
  `src/controller/render.ts`'s `renderTenantScrapeConfig`).
- **Used by:** `TenantPod5xxRate`.
- **Verification:**
  ```promql
  sum by (tenant) (rate(http_responses_total{app="quackback"}[5m]))
  ```
- **Status:** `TODO: live-verify`. The OSS app has to actually expose a
  Prometheus-format `/metrics` endpoint with this counter. If it does
  not, this is a launch-blocking gap — none of the HTTP-facing alerts
  fire without it. The Alloy scrape config relabels `tenant` and
  `namespace` from the per-tenant ConfigMap labels onto the scraped
  series.

### `http_request_duration_seconds_bucket`

- **Source:** the per-tenant Quackback pod's `/metrics`, histogram
  buckets for request latency.
- **Used by:** `TenantPodLatencyP99`.
- **Verification:**
  ```promql
  histogram_quantile(
    0.99,
    sum by (tenant, le) (
      rate(http_request_duration_seconds_bucket{app="quackback"}[5m])
    )
  )
  ```
- **Status:** `TODO: live-verify`. Same dependency as
  `http_responses_total`. Confirm bucket boundaries are reasonable
  (need at least one bucket above 2s for the 2s p99 alert to be
  meaningful).

## CNPG (per-tenant Postgres)

### `cnpg_cluster_status_conditions`

- **Source:** the CloudNativePG operator's `/metrics` endpoint, plus
  per-cluster pod metrics.
- **Used by:** `CnpgClusterNotHealthy`.
- **Verification:**
  ```promql
  cnpg_cluster_status_conditions{type="Ready",status!="True"}
  ```
- **Status:** `TODO: live-verify`. CNPG exposes condition metrics, but
  the exact label set (`type`, `status`, possibly `reason`) varies
  across operator versions. Confirm against the deployed CNPG version
  and adjust the matcher if needed.

### `cnpg_collector_last_archived_wal_time`

- **Source:** CNPG's per-cluster collector sidecar — unix-seconds gauge
  of when the last WAL segment was archived to object storage.
- **Used by:** `CnpgBackupMissing`.
- **Verification:**
  ```promql
  time() - cnpg_collector_last_archived_wal_time
  ```
- **Status:** `wrong-name → corrected to cnpg_collector_last_archived_wal_time`.
  An earlier draft used `cnpg_collector_last_available_backup_timestamp`
  (which is the metric the existing duckpond `CNPGBackupStale` Grafana
  rule uses). The two measure subtly different things: the Grafana rule
  fires on stale Barman base-backups (24h granularity); this alert
  watches WAL archival, which should be ~continuous. Both are useful;
  this rule is intentionally tighter. Live-verify the chosen name
  exists in the cluster's CNPG version before promoting from TODO.

## Migration jobs

### `kube_job_status_failed`

- **Source:** kube-state-metrics (built-in, no CRS config needed).
- **Used by:** `MigrationJobFailed`.
- **Verification:**
  ```promql
  kube_job_status_failed{job_name=~".*-migrate-.*"} > 0
  ```
- **Status:** `verified` (kube-state-metrics ships this metric by
  default; `job_name` label is standard). The regex assumes the
  controller's migration-job naming convention
  (`<slug>-migrate-<hash>`), which is fixed in `render.ts`.

## Backup verifier

### `cp_verifier_last_success_timestamp_seconds`

- **Source:** the CP's backup-verifier worker (a BullMQ job that runs
  the restore-+-checksum dry-run). Exposes a unix-seconds gauge on the
  CP's `/metrics` endpoint at the end of each successful run.
- **Used by:** `BackupVerifierStale`.
- **Verification:**
  ```promql
  time() - cp_verifier_last_success_timestamp_seconds
  ```
- **Status:** `TODO: live-verify`. The verifier worker is owned by Phase
  Q; until it lands and exports this gauge, this alert silently
  no-data's. Treat as a launch precondition: the alert and the worker
  ship together or the alert ships disabled.

## Launch preconditions summary

Before the alert rules in
`observability/mimir/rules/quackback-cloud.yaml` are loaded into the
Mimir ruler, all `TODO: live-verify` rows above must be resolved. The
fastest path is:

1. `kubectl exec` into a Mimir querier (or any pod that can reach the
   query frontend) and run each verification PromQL probe above.
2. For any probe that returns no data, either:
   - fix the upstream exporter (preferred), or
   - rewrite the alert rule to use a confirmed metric, or
   - delete the alert rule (last resort — note in this runbook).
3. Once every row is `verified`, the alert rules can be promoted.

Until then, treat the alert rule file as draft / staged.
