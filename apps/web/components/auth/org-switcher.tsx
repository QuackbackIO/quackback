'use client'

import { useState, useEffect } from 'react'
import {
  listOrganizations,
  getFullOrganization,
  setActiveOrganization,
} from '@/lib/auth/client'
import { useRouter } from 'next/navigation'
import { ChevronDown, Plus } from 'lucide-react'

interface Organization {
  id: string
  name: string
  slug: string
}

export function OrgSwitcher() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null)

  useEffect(() => {
    async function loadOrgs() {
      const { data: orgs } = await listOrganizations()
      const { data: active } = await getFullOrganization()

      if (orgs) setOrganizations(orgs)
      if (active) setActiveOrg(active)
    }
    loadOrgs()
  }, [])

  async function handleSwitch(orgId: string) {
    await setActiveOrganization({ organizationId: orgId })
    setIsOpen(false)
    router.refresh()
  }

  if (!activeOrg) return null

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">
          {activeOrg.name[0].toUpperCase()}
        </div>
        <span>{activeOrg.name}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card py-1 shadow-lg">
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
              Organizations
            </div>
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent ${
                  org.id === activeOrg.id ? 'bg-accent' : ''
                }`}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">
                  {org.name[0].toUpperCase()}
                </div>
                <span>{org.name}</span>
                {org.id === activeOrg.id && (
                  <span className="ml-auto text-xs text-primary">Active</span>
                )}
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => router.push('/admin/settings/organization/new')}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                <Plus className="h-4 w-4" />
                Create organization
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
