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
import { AuthProviderCredentialsForm } from './auth-provider-credentials-form'
import type { PlatformCredentialField } from '@/lib/shared/integration-types'

interface AuthProviderCredentialsDialogProps {
  credentialType: string
  providerId: string
  providerName: string
  fields: PlatformCredentialField[]
  helpUrl?: string
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

export function AuthProviderCredentialsDialog({
  credentialType,
  providerId,
  providerName,
  fields,
  helpUrl,
  open,
  onOpenChange,
}: AuthProviderCredentialsDialogProps) {
  return (
    // DialogContent's default `grid gap-4 p-6` is overridden so the
    // body scrolls independently of the header — Custom OIDC's seven
    // fields plus the redirect-URI callout overflow short viewports
    // otherwise, with the Save button stranded off-screen. Header
    // stays pinned at the top; body scrolls.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>Configure {providerName}</DialogTitle>
          <DialogDescription>
            Enter your {providerName} OAuth app credentials to enable sign-in.
            {helpUrl && (
              <>
                {' '}
                <a
                  href={helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Open {providerName} developer console &rarr;
                </a>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <Suspense fallback={<FormSkeleton fieldCount={fields.length || 2} />}>
            <AuthProviderCredentialsForm
              credentialType={credentialType}
              providerId={providerId}
              providerName={providerName}
              fields={fields}
              onSaved={() => onOpenChange(false)}
            />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  )
}
