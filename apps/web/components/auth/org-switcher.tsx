'use client'

import { useState, useEffect } from 'react'
import {
  listOrganizations,
  getFullOrganization,
  setActiveOrganization,
} from '@/lib/auth/client'
import { useRouter } from 'next/navigation'
import { ChevronDown, Plus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface Organization {
  id: string
  name: string
  slug: string
}

export function OrgSwitcher() {
  const router = useRouter()
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
    router.refresh()
  }

  if (!activeOrg) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-xs">
              {activeOrg.name[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span>{activeOrg.name}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSwitch(org.id)}
            className="gap-2"
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs">
                {org.name[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span>{org.name}</span>
            {org.id === activeOrg.id && (
              <Check className="ml-auto h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push('/admin/settings/organization/new')}
          className="gap-2 text-muted-foreground"
        >
          <Plus className="h-4 w-4" />
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
