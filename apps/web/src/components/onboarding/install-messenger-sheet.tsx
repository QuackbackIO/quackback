import { useEffect, useMemo, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { Sheet, SheetContent, SheetFooter, SheetTitle } from '@/components/ui/sheet'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import { adminQueries } from '@/lib/client/queries/admin'
import { buildWidgetLoaderSnippet, isTestSiteHost } from '@/lib/shared/widget/install-prompt'
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
/** How long the sheet waits quietly before offering help. */
export const INSTALL_HELP_AFTER_MS = 2 * 60_000
const INSTRUCTIONS_EMAIL_ID = 'install-instructions-email'

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
  const snippet = useMemo(() => buildWidgetLoaderSnippet(baseUrl ?? ''), [baseUrl])
  const appHost = useMemo(() => {
    try {
      return new URL(baseUrl ?? '').host
    } catch {
      return ''
    }
  }, [baseUrl])
  const { copied, copy } = useCopyToClipboard()
  const ready = useMutation({ mutationFn: () => readyMessengerInstallFn() })

  const status = useQuery({
    queryKey: MESSENGER_INSTALL_STATUS_KEY,
    queryFn: () => getMessengerInstallStatusFn(),
    refetchInterval: (query) => installPollInterval(query.state.data?.seenHost ?? null),
  })
  const seenHost = status.data?.seenHost ?? null
  const seenJustNow = isSeenJustNow(status.data?.seenAt ?? null)
  // Quiet at first; after a while with no sign, say what usually blocks it.
  const [waitedLong, setWaitedLong] = useState(false)
  useEffect(() => {
    if (seenHost) return
    const timer = setTimeout(() => setWaitedLong(true), INSTALL_HELP_AFTER_MS)
    return () => clearTimeout(timer)
  }, [seenHost])
  const needsHelp = !seenHost && waitedLong && status.isSuccess

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
              <pre
                tabIndex={0}
                aria-label={intl.formatMessage({
                  id: 'onboarding.live.install.snippet',
                  defaultMessage: 'Messenger snippet',
                })}
                className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground/50"
              >
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

        <SignedInUsers />

        <SendInstructions />

        <p className="text-xs text-muted-foreground">
          <FormattedMessage
            id="onboarding.live.install.turnsOn"
            defaultMessage="Copying or sending also turns Messenger on for your website."
          />
        </p>

        <div
          role="status"
          aria-live="polite"
          data-testid="install-status"
          className={cn(
            'flex gap-2 rounded-lg px-3 py-2 text-sm',
            seenHost
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
              : needsHelp
                ? 'bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
                : 'bg-muted text-muted-foreground'
          )}
        >
          <span
            aria-hidden
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              seenHost
                ? 'bg-emerald-600'
                : needsHelp
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground/50 motion-safe:animate-pulse'
            )}
          />
          <div className="min-w-0 space-y-1">
            <p className={cn((needsHelp || seenHost) && 'font-medium')}>
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
              ) : needsHelp ? (
                <FormattedMessage
                  id="onboarding.live.install.noSign"
                  defaultMessage="No sign of Messenger yet"
                />
              ) : (
                <FormattedMessage
                  id="onboarding.live.install.waiting"
                  defaultMessage="Waiting for your site"
                />
              )}
            </p>
            {seenHost && isTestSiteHost(seenHost) && (
              <p>
                <FormattedMessage
                  id="onboarding.live.install.testSite"
                  defaultMessage="{host} looks like a test site. Check your live site too."
                  values={{ host: seenHost }}
                />
              </p>
            )}
            {needsHelp && (
              <>
                <p>
                  <FormattedMessage
                    id="onboarding.live.install.noSignHelp"
                    defaultMessage="Open a page you changed since pasting. If your site sets a content security policy, allow {host} for scripts, frames and connections."
                    values={{ host: appHost }}
                  />
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="bg-background"
                  onClick={() => {
                    const field = document.getElementById(INSTRUCTIONS_EMAIL_ID)
                    field?.scrollIntoView?.({ block: 'center' })
                    field?.focus()
                  }}
                >
                  <FormattedMessage
                    id="onboarding.live.install.noSignSend"
                    defaultMessage="Send instructions to a developer"
                  />
                </Button>
              </>
            )}
          </div>
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

/** Identify is optional: the steps and the signing secret live on the Install settings page. */
function SignedInUsers() {
  return (
    <Collapsible className="rounded-lg border px-3 py-2">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground/50">
        <FormattedMessage
          id="onboarding.live.install.signedIn"
          defaultMessage="Recognise signed-in users (optional)"
        />
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="pt-2 text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.live.install.signedInHelp"
            defaultMessage="Add one line after sign-in, with a short-lived token signed on your server, so conversations show who is writing. The steps and the signing secret are on the <link>Install settings</link> page."
            values={{
              link: (chunks: React.ReactNode) => (
                <Link
                  to="/admin/settings/widget/install"
                  className="text-foreground underline underline-offset-2"
                >
                  {chunks}
                </Link>
              ),
            }}
          />
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The send limit is the one failure worth naming; the rest read as "try later". */
function isRateLimited(error: unknown): boolean {
  return error instanceof Error && /too many/i.test(error.message)
}

function SendInstructions() {
  const intl = useIntl()
  const [email, setEmail] = useState('')
  const send = useMutation({
    mutationFn: (to: string) => sendMessengerInstallInstructionsFn({ data: { email: to } }),
    onSuccess: () => setEmail(''),
  })
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (email.trim()) send.mutate(email.trim())
      }}
    >
      <label htmlFor={INSTRUCTIONS_EMAIL_ID} className="text-sm font-medium">
        <FormattedMessage
          id="onboarding.live.install.someoneElse"
          defaultMessage="Someone else adds code to your site?"
        />
      </label>
      <div className="flex gap-2">
        <Input
          id={INSTRUCTIONS_EMAIL_ID}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={send.isError || undefined}
          placeholder={intl.formatMessage({
            id: 'onboarding.live.install.emailPlaceholder',
            defaultMessage: 'developer@company.com',
          })}
        />
        <Button type="submit" variant="outline" disabled={send.isPending || !email.trim()}>
          <FormattedMessage id="onboarding.live.install.send" defaultMessage="Send instructions" />
        </Button>
      </div>
      {send.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {isRateLimited(send.error) ? (
            <FormattedMessage
              id="onboarding.live.install.sendLimited"
              defaultMessage="You sent several already. Try again in an hour."
            />
          ) : (
            <FormattedMessage
              id="onboarding.live.install.sendFailed"
              defaultMessage="Couldn't send the instructions. Try again later."
            />
          )}
        </p>
      ) : send.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.live.install.sent"
            defaultMessage="Instructions sent to {email}"
            values={{ email: send.variables }}
          />
        </p>
      ) : null}
    </form>
  )
}
