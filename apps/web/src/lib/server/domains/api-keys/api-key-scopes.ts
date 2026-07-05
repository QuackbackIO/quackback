/**
 * Re-export shim: the API-key scope vocabulary is pure data + pure functions
 * consumed by client bundles (key-creation UI, OAuth consent), so it lives in
 * lib/shared. Server callers keep this import path.
 */
export * from '@/lib/shared/api-key-scopes'
