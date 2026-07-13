/**
 * SLA domain shared types & re-exports.
 *
 * All cross-module SLA constants & types funnel through this barrel so other
 * domains import a single, stable surface.
 */
export type {
  BusinessHours,
  NewBusinessHours,
  SlaPolicy,
  NewSlaPolicy,
  SlaTarget,
  NewSlaTarget,
  TicketSlaClock,
  NewTicketSlaClock,
  EscalationRule,
  NewEscalationRule,
  SlaEscalationLogEntry,
  NewSlaEscalationLogEntry,
  BusinessHoursRange,
  BusinessHoursWeek,
  BusinessHoursHoliday,
  SlaTargetKind,
  SlaClockState,
  SlaPolicyScope,
  EscalationRecipientType,
  EscalationChannel,
} from '@/lib/server/db'

export {
  SLA_TARGET_KINDS,
  SLA_CLOCK_STATES,
  SLA_POLICY_SCOPES,
  ESCALATION_RECIPIENT_TYPES,
  ESCALATION_CHANNELS,
} from '@/lib/server/db'
