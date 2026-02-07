'use client'

import { Suspense } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PlatformCredentialsForm } from './platform-credentials-form'
import type { PlatformCredentialField } from '@/lib/server/integrations/types'

interface PlatformCredentialsDialogProps {
  integrationType: string
  integrationName: string
  fields: PlatformCredentialField[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

function FormSkeleton({ fieldCount }: { fieldCount: number }) {
  return (
    <div className="min-h-[200px] space-y-4">
      <div className="space-y-3">
        {Array.from({ length: fieldCount }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

export function PlatformCredentialsDialog({
  integrationType,
  integrationName,
  fields,
  open,
  onOpenChange,
}: PlatformCredentialsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure {integrationName}</DialogTitle>
          <DialogDescription>
            Enter your {integrationName} app credentials to enable the integration.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<FormSkeleton fieldCount={fields.length || 2} />}>
          <PlatformCredentialsForm
            integrationType={integrationType}
            fields={fields}
            onSaved={() => onOpenChange(false)}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
