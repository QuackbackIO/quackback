import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BuildingOffice2Icon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getCompanyForPrincipalFn, qualifyCompanyFn } from '@/lib/server/functions/companies'

/**
 * Company context for the conversation detail panel: the visitor's company with
 * its plan / MRR, so an agent sees account value inline. When the visitor has
 * no company yet, the card becomes the qualification editor: the agent fills
 * name / size / website / industry, and committing the name creates-or-attaches
 * a company by case-insensitive name match (source 'manual' on create).
 *
 * The name links to the companies directory (where companies are edited);
 * "View conversations" deep-links the inbox filtered to this company.
 */
export function CompanyCard({
  principalId,
  enabled = true,
}: {
  principalId: string
  enabled?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: company, isPending } = useQuery({
    queryKey: ['admin', 'company', 'for-principal', principalId],
    queryFn: () => getCompanyForPrincipalFn({ data: { principalId } }),
    enabled: enabled && !!principalId,
    staleTime: 60_000,
  })

  if (isPending) return null

  if (!company) {
    return (
      <QualificationEditor
        principalId={principalId}
        onQualified={() =>
          Promise.all([
            queryClient.invalidateQueries({ queryKey: ['admin', 'company'] }),
            queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] }),
          ])
        }
      />
    )
  }

  const mrr =
    company.mrrCents != null
      ? (company.mrrCents / 100).toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        })
      : null

  return (
    <div className="space-y-2 border-t border-border/30 pt-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BuildingOffice2Icon className="h-4 w-4" />
        <span>Company</span>
      </div>
      <Link
        to="/admin/users"
        search={{ lifecycle: 'companies', company: company.id }}
        className="block truncate text-sm font-medium text-foreground hover:underline"
      >
        {company.name}
      </Link>
      <div className="space-y-1 text-xs">
        {company.plan && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Plan</span>
            <span className="font-medium text-foreground">{company.plan}</span>
          </div>
        )}
        {mrr && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">MRR</span>
            <span className="font-medium text-foreground">{mrr}/mo</span>
          </div>
        )}
        {company.size && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Size</span>
            <span className="font-medium text-foreground">{company.size}</span>
          </div>
        )}
        {company.industry && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Industry</span>
            <span className="font-medium text-foreground">{company.industry}</span>
          </div>
        )}
        {company.website && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Website</span>
            <span className="min-w-0 truncate font-medium text-foreground">{company.website}</span>
          </div>
        )}
      </div>
      <Link
        to="/admin/inbox"
        search={{ company: company.id }}
        className="block text-xs font-medium text-primary hover:underline"
      >
        View conversations →
      </Link>
    </div>
  )
}

/**
 * The unattached-contact qualification form. Committing a name (Save) is what
 * creates-or-attaches; size / website / industry ride along on the same call.
 */
function QualificationEditor({
  principalId,
  onQualified,
}: {
  principalId: string
  onQualified: () => void
}) {
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await qualifyCompanyFn({
        data: {
          principalId,
          name: trimmed,
          size: size.trim() || null,
          website: website.trim() || null,
          industry: industry.trim() || null,
        },
      })
      onQualified()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to set company')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-border/30 pt-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BuildingOffice2Icon className="h-4 w-4" />
        <span>Company</span>
      </div>
      <div className="space-y-1.5">
        {(
          [
            { value: name, set: setName, placeholder: 'Company name' },
            { value: size, set: setSize, placeholder: 'Size (e.g. 11-50)' },
            { value: website, set: setWebsite, placeholder: 'Website' },
            { value: industry, set: setIndustry, placeholder: 'Industry' },
          ] as const
        ).map((field) => (
          <Input
            key={field.placeholder}
            value={field.value}
            disabled={saving}
            onChange={(e) => field.set(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit()
            }}
            placeholder={field.placeholder}
            className="h-7 text-xs"
          />
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={!name.trim() || saving}
        onClick={() => void commit()}
      >
        {saving ? 'Saving...' : 'Save company'}
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Saving links this person to an existing company with the same name, or creates one.
      </p>
    </div>
  )
}
