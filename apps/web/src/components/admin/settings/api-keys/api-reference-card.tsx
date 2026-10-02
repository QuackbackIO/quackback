import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/solid'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'

/** The REST API base URL (copyable) and a link to the interactive reference. */
export function ApiReferenceCard({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <SettingsCard>
      <SettingRows>
        <SettingRow
          label="Base URL"
          control={
            <>
              <code
                className="max-w-[55vw] truncate font-mono text-xs text-muted-foreground sm:max-w-none"
                title={apiBaseUrl}
              >
                {apiBaseUrl}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Copy base URL"
                onClick={() => void copy(apiBaseUrl)}
              >
                {copied ? (
                  <CheckIcon className="size-4 text-success" />
                ) : (
                  <ClipboardDocumentIcon className="size-4" />
                )}
              </Button>
            </>
          }
        />
        <SettingRow
          label="API reference"
          description="Endpoints, authentication and examples."
          control={
            <Button variant="outline" size="sm" asChild>
              <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer">
                Open<span className="sr-only"> API reference</span>
                <ArrowTopRightOnSquareIcon className="size-4" />
              </a>
            </Button>
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
