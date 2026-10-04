import { useEffect, useMemo, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import { adminQueries } from '@/lib/client/queries/admin'
import { buildWidgetInstallSnippet } from '@/lib/shared/widget/install-prompt'
import { cn } from '@/lib/shared/utils'
import {
  getMessengerInstallStatusFn,
  readyMessengerInstallFn,
  sendMessengerInstallInstructionsFn,
} from '@/lib/server/functions/going-live'

export const MESSENGER_INSTALL_STATUS_KEY = ['onboarding', 'messenger-install'] as const
/** How often the sheet asks whether the site has loaded Messenger yet. */
export const INSTALL_POLL_MS = 4000

const JUST_NOW_MS = 2 * 60_000

/** The site loaded Messenger in the last couple of minutes. */
export function isSeenJustNow(seenAt: string | null, now = Date.now()): boolean {
  return seenAt !== null && now - Date.parse(seenAt) < JUST_NOW_MS
}

/** Poll lightly while waiting for the site; stop for good once it is seen. */
export function installPollInterval(seenHost: string | null): number | false {
  return seenHost ? false : INSTALL_POLL_MS
}

export function InstallMessengerSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const headingRef = useRef<HTMLElement>(null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-[560px]"
        // Land on the heading, not the first tab: a ringed tab on open reads
        // as a second selection.
        initialFocus={headingRef}
      >
        <header ref={headingRef} tabIndex={-1} className="border-b px-5 py-4 pr-12 outline-none">
          <SheetTitle>
            <FormattedMessage
              id="onboarding.live.install.title"
              defaultMessage="Put Messenger on your site"
            />
          </SheetTitle>
          <SheetDescription className="sr-only">
            <FormattedMessage
              id="onboarding.live.install.title"
              defaultMessage="Put Messenger on your site"
            />
          </SheetDescription>
        </header>
        {open && <InstallMessengerBody onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function InstallMessengerBody({ onDone }: { onDone: () => void }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const baseUrl = useBaseUrl()
  const snippet = useMemo(() => buildWidgetInstallSnippet(baseUrl ?? ''), [baseUrl])
  const { copied, copy } = useCopyToClipboard()
  const ready = useMutation({ mutationFn: () => readyMessengerInstallFn() })

  const status = useQuery({
    queryKey: MESSENGER_INSTALL_STATUS_KEY,
    queryFn: () => getMessengerInstallStatusFn(),
    refetchInterval: (query) => installPollInterval(query.state.data?.seenHost ?? null),
  })
  const seenHost = status.data?.seenHost ?? null
  const seenJustNow = isSeenJustNow(status.data?.seenAt ?? null)

  // The launch step completes on detection; refresh it as the site appears.
  useEffect(() => {
    if (seenHost)
      void queryClient.invalidateQueries({ queryKey: adminQueries.onboardingStatus().queryKey })
  }, [seenHost, queryClient])

  const onCopy = () => {
    void copy(snippet)
    ready.mutate()
  }

  const tabs = [
    {
      value: 'site',
      label: intl.formatMessage({
        id: 'onboarding.live.install.tab.site',
        defaultMessage: 'Any website',
      }),
      how: intl.formatMessage({
        id: 'onboarding.live.install.site.how',
        defaultMessage: 'Paste before the closing body tag on every page.',
      }),
    },
    {
      value: 'gtm',
      label: intl.formatMessage({
        id: 'onboarding.live.install.tab.gtm',
        defaultMessage: 'Tag Manager',
      }),
      how: intl.formatMessage({
        id: 'onboarding.live.install.gtm.how',
        defaultMessage: 'New tag, Custom HTML, paste this, trigger on All pages.',
      }),
    },
  ]

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
        <Tabs defaultValue="site" className="gap-3">
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="space-y-3">
              <p className="text-sm text-muted-foreground">{tab.how}</p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                {snippet}
              </pre>
              <Button size="sm" onClick={onCopy} data-testid="install-copy">
                {copied ? (
                  <FormattedMessage id="onboarding.live.install.copied" defaultMessage="Copied" />
                ) : (
                  <FormattedMessage id="onboarding.live.install.copy" defaultMessage="Copy" />
                )}
              </Button>
            </TabsContent>
          ))}
        </Tabs>

        <SendInstructions />

        <div
          role="status"
          aria-live="polite"
          data-testid="install-status"
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            seenHost
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-2 shrink-0 rounded-full',
              seenHost ? 'bg-emerald-600' : 'bg-muted-foreground/50 motion-safe:animate-pulse'
            )}
          />
          {seenHost ? (
            seenJustNow ? (
              <FormattedMessage
                id="onboarding.live.install.seenNow"
                defaultMessage="Seen on {host} just now"
                values={{ host: seenHost }}
              />
            ) : (
              <FormattedMessage
                id="onboarding.live.install.seen"
                defaultMessage="Seen on {host}"
                values={{ host: seenHost }}
              />
            )
          ) : (
            <FormattedMessage
              id="onboarding.live.install.waiting"
              defaultMessage="Waiting for your site"
            />
          )}
        </div>
      </div>
      <SheetFooter className="border-t p-4">
        <Button variant={seenHost ? 'default' : 'outline'} onClick={onDone}>
          <FormattedMessage id="onboarding.live.install.done" defaultMessage="Done" />
        </Button>
      </SheetFooter>
    </>
  )
}

function SendInstructions() {
  const intl = useIntl()
  const [email, setEmail] = useState('')
  const send = useMutation({
    mutationFn: (to: string) => sendMessengerInstallInstructionsFn({ data: { email: to } }),
    onSuccess: (_result, to) => {
      setEmail('')
      toast.success(
        intl.formatMessage(
          { id: 'onboarding.live.install.sent', defaultMessage: 'Instructions sent to {email}' },
          { email: to }
        )
      )
    },
    onError: () =>
      toast.error(
        intl.formatMessage({
          id: 'onboarding.live.install.sendFailed',
          defaultMessage: "Couldn't send the instructions. Try again later.",
        })
      ),
  })
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (email.trim()) send.mutate(email.trim())
      }}
    >
      <label htmlFor="install-instructions-email" className="text-sm font-medium">
        <FormattedMessage
          id="onboarding.live.install.someoneElse"
          defaultMessage="Someone else adds code to your site?"
        />
      </label>
      <div className="flex gap-2">
        <Input
          id="install-instructions-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={intl.formatMessage({
            id: 'onboarding.live.install.emailPlaceholder',
            defaultMessage: 'developer@company.com',
          })}
        />
        <Button type="submit" variant="outline" disabled={send.isPending || !email.trim()}>
          <FormattedMessage id="onboarding.live.install.send" defaultMessage="Send instructions" />
        </Button>
      </div>
    </form>
  )
}
