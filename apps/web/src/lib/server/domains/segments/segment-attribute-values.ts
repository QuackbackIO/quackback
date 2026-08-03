/**
 * Distinct-value lookups for the segment rule-builder's autocomplete.
 *
 * Returns the most-common values for a built-in attribute (within the
 * portal-user audience the evaluator targets), optionally filtered by
 * a prefix query. Powers the SearchableInput component so admins see
 * what values are actually present in their workspace as they type.
 *
 * Safety: `attribute` is dispatched via a closed allowlist (one SQL
 * template per key); never interpolated. `query` is parameterized via
 * drizzle's tagged-template binder.
 */
import { db, sql } from '@/lib/server/db'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'

export type SearchableAttribute =
  | 'country'
  | 'locale'
  | 'name'
  | 'email'
  | 'signup_source'
  | 'contact_title'
  | 'organization_domain'
  | 'organization_external_id'

export const SEARCHABLE_ATTRIBUTES: ReadonlySet<SearchableAttribute> = new Set([
  'country',
  'locale',
  'name',
  'email',
  'signup_source',
  'contact_title',
  'organization_domain',
  'organization_external_id',
])

export interface AttributeValue {
  value: string
  count: number
}

/**
 * Build the prefix-match WHERE fragment. Empty query → no filter.
 * `expr` is a SQL fragment naming the column / derived expression
 * being matched (e.g. `u.country`). Wrapping with COALESCE/etc. is
 * fine — drizzle preserves the inner template.
 */
function prefixFilter(expr: ReturnType<typeof sql>, query: string): ReturnType<typeof sql> {
  if (!query) return sql``
  return sql`AND ${expr} ILIKE ${query + '%'}`
}

/**
 * Per-attribute SQL templates. Each returns rows shaped {value, count},
 * scoped to portal-user principals to match the segment evaluator's
 * audience (role='user' AND user_id IS NOT NULL). Counts therefore
 * reflect what segments will actually match — not the count of all
 * rows in the user table including team members.
 */
function queryForAttribute(
  attribute: SearchableAttribute,
  query: string,
  limit: number
): ReturnType<typeof sql> {
  const baseJoin = sql`FROM "user" u INNER JOIN principal p ON p.user_id = u.id WHERE p.role = 'user'`
  const linkedContactJoin = sql`
    FROM contact_user_links cul
    INNER JOIN "user" u ON u.id = cul.user_id
    INNER JOIN principal p ON p.user_id = u.id
    INNER JOIN contacts c ON c.id = cul.contact_id AND c.archived_at IS NULL
    WHERE p.role = 'user'
  `
  const linkedOrganizationJoin = sql`
    FROM contact_user_links cul
    INNER JOIN "user" u ON u.id = cul.user_id
    INNER JOIN principal p ON p.user_id = u.id
    INNER JOIN contacts c ON c.id = cul.contact_id AND c.archived_at IS NULL
    INNER JOIN organizations o ON o.id = c.organization_id AND o.archived_at IS NULL
    WHERE p.role = 'user'
  `
  switch (attribute) {
    case 'country': {
      const upperQuery = query.toUpperCase()
      return sql`
        SELECT u.country AS value, COUNT(*)::int AS count
        ${baseJoin}
        AND u.country IS NOT NULL
        ${prefixFilter(sql`u.country`, upperQuery)}
        GROUP BY u.country
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    }
    case 'locale':
      return sql`
        SELECT u.locale AS value, COUNT(*)::int AS count
        ${baseJoin}
        AND u.locale IS NOT NULL
        ${prefixFilter(sql`u.locale`, query)}
        GROUP BY u.locale
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    case 'name':
      return sql`
        SELECT u.name AS value, COUNT(*)::int AS count
        ${baseJoin}
        AND u.name IS NOT NULL AND u.name <> ''
        ${prefixFilter(sql`u.name`, query)}
        GROUP BY u.name
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    case 'email':
      return sql`
        SELECT u.email AS value, COUNT(*)::int AS count
        ${baseJoin}
        AND u.email IS NOT NULL
        AND u.email NOT ILIKE ${`%@${ANON_EMAIL_DOMAIN}`}
        ${prefixFilter(sql`u.email`, query)}
        GROUP BY u.email
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    case 'signup_source': {
      // Mirrors the evaluator's derivation: oldest account.provider_id,
      // falling back to 'email' for users with no account row (magic-link
      // / OTP-only sign-ups).
      const sourceExpr = sql`COALESCE((SELECT a.provider_id FROM account a WHERE a.user_id = u.id ORDER BY a.created_at ASC LIMIT 1), 'email')`
      return sql`
        SELECT ${sourceExpr} AS value, COUNT(*)::int AS count
        ${baseJoin}
        ${prefixFilter(sourceExpr, query)}
        GROUP BY value
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    }
    case 'contact_title':
      return sql`
        SELECT c.title AS value, COUNT(DISTINCT p.id)::int AS count
        ${linkedContactJoin}
        AND c.title IS NOT NULL AND c.title <> ''
        ${prefixFilter(sql`c.title`, query)}
        GROUP BY c.title
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    case 'organization_domain':
      return sql`
        SELECT o.domain AS value, COUNT(DISTINCT p.id)::int AS count
        ${linkedOrganizationJoin}
        AND o.domain IS NOT NULL AND o.domain <> ''
        ${prefixFilter(sql`o.domain`, query.toLowerCase())}
        GROUP BY o.domain
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
    case 'organization_external_id':
      return sql`
        SELECT o.external_id AS value, COUNT(DISTINCT p.id)::int AS count
        ${linkedOrganizationJoin}
        AND o.external_id IS NOT NULL AND o.external_id <> ''
        ${prefixFilter(sql`o.external_id`, query)}
        GROUP BY o.external_id
        ORDER BY count DESC, value ASC
        LIMIT ${limit}
      `
  }
}

/**
 * Resolve the top distinct values for `attribute` whose value starts
 * with `query` (case-insensitive). `limit` caps the response size; the
 * caller (typeahead UI) typically asks for 20.
 */
export async function getAttributeValueSuggestions(
  attribute: SearchableAttribute,
  query: string,
  limit: number
): Promise<AttributeValue[]> {
  const rows = await db.execute(queryForAttribute(attribute, query, limit))
  return (rows as unknown as Array<{ value: string; count: number }>).map((r) => ({
    value: r.value,
    count: r.count,
  }))
}
