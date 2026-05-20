// Better-auth tables (for Drizzle relational queries and joins)
// These tables are managed by better-auth CLI, we define schema for type-safety
export * from './auth'

// Application schemas
export * from './boards'
export * from './statuses'
export * from './posts'
export * from './post-mentions'
export * from './integrations'
export * from './changelog'
export * from './notifications'
export * from './sentiment'
export * from './api-keys'
export * from './webhooks'
export * from './external-links'
export * from './segments'
export * from './user-attributes'
export * from './feedback'
export * from './merge-suggestions'
export * from './activity'
export * from './ai-usage-log'
export * from './pipeline-log'
export * from './kb'
export * from './analytics'
export * from './hook-deliveries'
export * from './audit-log'
export * from './sso-recovery-code'

// Ticketing — access & visibility (Phase 1 foundation)
export * from './teams'
export * from './roles'
export * from './audit-events'

// Ticketing — organizations & contacts (Phase 2)
export * from './organizations'

// Ticketing — ticket core (Phase 3)
export * from './ticket-statuses'
export * from './tickets'

// Ticketing — inboxes, channels, routing (Phase 4)
export * from './inboxes'
export * from './routing-rules'

// Ticketing — SLA + escalations (Phase 5)
export * from './sla'

// Ticketing — subscriptions + webhook delivery log (Phase 7)
export * from './ticket-subscriptions'
export * from './webhook-deliveries'

// Ticketing — external links + user mappings (Phase 6: GitHub sync)
export * from './ticket-external-links'
export * from './integration-user-mappings'

// Ticketing — integration sync log (Phase 6: observability)
export * from './integration-sync-log'
