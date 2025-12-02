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
          className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700"
        >
          <div className="flex items-center gap-3">
            {org.logo ? (
              <img src={org.logo} alt={org.name} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                <Building2 className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              </div>
            )}
            <div>
              <p className="font-medium text-gray-900 dark:text-white">{org.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{org.slug}</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </button>
      ))}
    </div>
  )
}
