import { AdminFilterLayout } from '@/components/admin/admin-filter-layout'

interface UsersLayoutProps {
  segmentNav: React.ReactNode
  children: React.ReactNode
}

export function UsersLayout({ segmentNav, children }: UsersLayoutProps) {
  return <AdminFilterLayout filters={segmentNav}>{children}</AdminFilterLayout>
}
