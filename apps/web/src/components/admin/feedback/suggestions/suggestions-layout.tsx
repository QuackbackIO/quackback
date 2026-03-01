import { AdminFilterLayout } from '@/components/admin/admin-filter-layout'

interface SuggestionsLayoutProps {
  filters: React.ReactNode
  content: React.ReactNode
  hasActiveFilters?: boolean
}

export function SuggestionsLayout({ filters, content, hasActiveFilters }: SuggestionsLayoutProps) {
  return (
    <AdminFilterLayout filters={filters} hasActiveFilters={hasActiveFilters}>
      {content}
    </AdminFilterLayout>
  )
}
