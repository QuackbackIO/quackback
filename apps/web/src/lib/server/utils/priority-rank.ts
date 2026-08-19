import { sql, type SQL, type AnyColumn } from 'drizzle-orm'

/**
 * The orderable numeric rank of a `ConversationPriority` text column, as a SQL
 * CASE. Shared by the conversation inbox sort and the ticket list sort so the two
 * rank priority identically: urgent(5) > high(4) > medium(3) > low(2) > none(1).
 */
export function priorityRankSql(column: AnyColumn): SQL<number> {
  return sql<number>`CASE ${column} WHEN 'urgent' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END`
}
