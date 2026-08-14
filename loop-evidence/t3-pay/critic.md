# PASS — Test-mode checkout paid on existing t1a; webhook processed; growth projection delivered; instances 16.

Independent critic probe at 2026-08-14T20:58:44.364Z. railway run against control-plane. No new payment, Neon, or live key.

## Health

- gauntletReady: 200 https://gauntlet.quackback.co.uk/api/health/ready
- t1aReady: 200 https://south63792f.quackback.co.uk/api/health/ready
- t1eReady: 200 https://northfa99f0.quackback.co.uk/api/health/ready
- t1aSystem: 200 https://ws-bf8e1c4affe270eb5a6dda1a.quackback.co.uk/api/health
- t1eSystem: 200 https://ws-4a048e07941c5e7840e986c0.quackback.co.uk/api/health

## Stripe

```json
{
  "idPrefix": "cs_test_",
  "livemode": false,
  "mode": "subscription",
  "status": "complete",
  "paymentStatus": "paid",
  "kind": "workspace_subscription",
  "instanceId": "inst_01m00kq6cdfzzb19gfjz8pt0s7",
  "planId": "growth",
  "hasSubscription": true,
  "subscriptionStatus": "active",
  "successHost": "south63792f.quackback.co.uk"
}
```

## SQL

```json
{
  "instances": {
    "count": 16,
    "hasT1a": true,
    "hasT1e": true
  },
  "workspace": {
    "plan_id": "growth",
    "has_item": true,
    "has_sub": true,
    "subscription_status": "active",
    "projection_version": "4"
  },
  "webhook": [
    {
      "event_type": "checkout.session.completed",
      "processed": true
    }
  ],
  "outbox": {
    "projection_version": "4",
    "status": "delivered",
    "effective_plan": "growth",
    "subscription_status": "active",
    "has_customer_field": false,
    "has_sub_field": false
  },
  "workspaceProjection": {
    "enabled": true,
    "version": 4,
    "effectivePlan": "growth",
    "subscriptionStatus": "active",
    "canManageBilling": true,
    "hasProviderId": false
  }
}
```

## Checks

```json
{
  "health200": true,
  "testSession": true,
  "paidComplete": true,
  "metadataT1a": true,
  "webhookProcessed": true,
  "instanceGrowth": true,
  "orgActive": true,
  "outboxGrowth": true,
  "workspaceGrowth": true,
  "noProviderIds": true,
  "instances16": true
}
```
