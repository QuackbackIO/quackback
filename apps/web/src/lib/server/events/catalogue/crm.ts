/**
 * CRM / ops plane event declarations (WO-6c). New catalogue-only, audit-only
 * events for the customer-directory entities, emitted directly via emit() from
 * their services. Completes the WO-6 mechanism across all three planes
 * (admin/6a, content/6b, crm/6c).
 */
import { decl } from './helpers'

const C = 'company'

export const companyCreated = decl('company.created', 'company', { audit: true }, C)
export const companyDeleted = decl('company.deleted', 'company', { audit: true }, C)
