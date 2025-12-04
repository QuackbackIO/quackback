import { requireTenantRole } from '@/lib/tenant'
import { AdminNav } from './admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Only owner, admin, and member roles can access admin dashboard
  // Users with role='user' (portal users) are blocked
  const { user } = await requireTenantRole(['owner', 'admin', 'member'])

  return (
    <div className="min-h-screen bg-background">
      <AdminNav userName={user.name} userEmail={user.email} userImage={user.image} />
      {children}
    </div>
  )
}
