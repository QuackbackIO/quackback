/**
 * Redirect URI the admin must register at their IdP. Per-provider: built from
 * the provider's `registrationId`.
 *
 * On the Add-provider page this sits ABOVE the credential fields, because
 * that is the order the work happens in: you register this URI at the IdP and
 * the IdP hands you the client ID and secret in return. Showing it after them
 * invites registering the app without it, which surfaces later as
 * `redirect_uri_mismatch` on the first real sign-in.
 */
import { Label } from '@/components/ui/label'
import { CopyButton } from '@/components/shared/copy-button'

export function RedirectUriCallout({ uri }: { uri: string }) {
  return (
    <div className="space-y-1">
      <Label>Redirect URI to register in your IdP</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono text-xs break-all">
          {uri}
        </code>
        <CopyButton value={uri} aria-label="Copy redirect URI" />
      </div>
      <p className="text-xs text-muted-foreground">
        Add this exact URI to your IdP&apos;s allowed redirect / callback URIs.
      </p>
    </div>
  )
}
