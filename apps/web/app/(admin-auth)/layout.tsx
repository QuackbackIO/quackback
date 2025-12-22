/**
 * Admin Auth Layout
 *
 * Auth routes (login, signup) for team members.
 * These pages don't require authentication (they ARE the auth pages).
 */
export default async function AdminAuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
