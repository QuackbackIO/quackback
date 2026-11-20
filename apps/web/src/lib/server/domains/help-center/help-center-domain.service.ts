/**
 * Help center custom domain reads. The domain itself is the help center's
 * entry in the portal section map (section-domains.service.ts), written only on
 * Settings > Domains; sending /hc to it is the section host middleware's job.
 */

// The pure host-matching helper lives in lib/shared; re-exported here so
// server callers keep one import surface for the domain feature.
export { resolveHelpCenterBaseUrl } from '@/lib/shared/help-center-domain'
