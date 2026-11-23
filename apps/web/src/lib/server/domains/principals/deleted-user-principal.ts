import type { PrincipalId } from '@quackback/ids'

/**
 * The placeholder's id is fixed rather than generated: it is a singleton, so a
 * constant makes find-or-create a primary-key upsert and keeps the row
 * recognisable in a database dump. Spelled as a literal, not derived through
 * `fromUuid`, so importing this module costs nothing at load time — it sits on
 * the import path of the whole users domain. It encodes the nil UUID;
 * principal-reattribute-completeness.test.ts pins that round trip.
 */
export const DELETED_USER_PRINCIPAL_ID = 'principal_00000000000000000000000000' as PrincipalId
