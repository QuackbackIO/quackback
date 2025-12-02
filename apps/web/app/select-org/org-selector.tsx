'use client'

import { Building2, ChevronRight } from 'lucide-react'
import { buildOrgUrl } from '@/lib/routing'

interface Organization {
  id: string
  name: string
  slug: string
  logo?: string | null
}

interface OrgSelectorProps {
  organizations: Organization[]
  callbackUrl?: string
}

export function OrgSelector({ organizations, callbackUrl }: OrgSelectorProps) {
  const handleSelectOrg = (org: Organization) => {
    const targetPath = callbackUrl || '/admin'
    const url = buildOrgUrl(org.slug, targetPath)
    window.location.href = url
  }

  return (
    <div className="space-y-3">
      {organizations.map((org) => (
        <button
          key={org.id}
          onClick={() => handleSelectOrg(org)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-accent"
        >
          <div className="flex items-center gap-3">
            {org.logo ? (
              <img src={org.logo} alt={org.name} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="font-medium text-foreground">{org.name}</p>
              <p className="text-sm text-muted-foreground">{org.slug}</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      ))}
    </div>
  )
}
