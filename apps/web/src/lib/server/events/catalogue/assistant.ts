/** Assistant + SLA event declarations (WO-2). All are workflow triggers. */
import { decl } from './helpers'

const S = 'conversations:read'
const wf = { webhook: true, workflow: true } as const

export const assistantHandedOff = decl('assistant.handed_off', 'conversation', wf, S)
export const slaApproachingBreach = decl('sla.approaching_breach', 'conversation', wf, S)
export const slaBreached = decl('sla.breached', 'conversation', wf, S)
