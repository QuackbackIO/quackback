/** A JSON-shaped value (fits a Postgres jsonb column, serializes over the wire).
 *  Lives in `shared` so client, server, and shared code can all reference it
 *  without crossing the server-only `@/lib/server` boundary. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]
