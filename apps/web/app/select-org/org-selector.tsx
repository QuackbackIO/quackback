'use client'

import { Building2, ChevronRight } from 'lucide-react'
import { buildOrgUrl } from '@/lib/routing'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

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
        <Card
          key={org.id}
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => handleSelectOrg(org)}
        >
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={org.logo || undefined} alt={org.name} />
                <AvatarFallback>
                  <Building2 className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-foreground">{org.name}</p>
                <p className="text-sm text-muted-foreground">{org.slug}</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
