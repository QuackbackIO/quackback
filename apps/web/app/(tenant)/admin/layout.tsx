import { requireTenant } from '@/lib/tenant'
import { AdminNav } from './admin-nav'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { organization, user } = await requireTenant()

  return (
    <div className="min-h-screen bg-background">
      <AdminNav organizationName={organization.name} userEmail={user.email} />
      {children}
    </div>
  )
}
