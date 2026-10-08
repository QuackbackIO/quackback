import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'

/**
 * The full-page split every setup screen shares: the logo, the step's content
 * and a footer in a left column, and a full-height panel on the right for the
 * portal preview. Below the large breakpoint the panel hides and the column
 * fills the page. Cloud signup uses the same split, so both ways into
 * Quackback read as one product.
 */
export function OnboardingSplit({
  children,
  footer,
  panel,
  wide = false,
}: {
  children: ReactNode
  footer?: ReactNode
  panel: ReactNode
  /** The workspace step's goal tiles need a slightly wider column. */
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        'min-h-dvh bg-background text-foreground lg:grid',
        wide ? 'lg:grid-cols-[600px_minmax(0,1fr)]' : 'lg:grid-cols-[560px_minmax(0,1fr)]'
      )}
    >
      <div
        className={cn(
          'flex min-h-dvh flex-col px-5 pt-8 pb-8 sm:px-10 lg:pt-14 lg:pb-12 lg:pl-20 xl:pl-28',
          wide ? 'lg:pr-16' : 'lg:pr-[72px]'
        )}
      >
        <div className="inline-flex items-center gap-2.5 self-start">
          <img src="/logo.png" alt="" width={30} height={30} className="size-[30px]" />
          <span className="text-lg font-bold tracking-[-0.01em]">Quackback</span>
        </div>
        <main className="flex flex-1 flex-col pt-10 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
          {children}
        </main>
        {footer ? <div className="pt-8">{footer}</div> : null}
      </div>
      <aside className="hidden min-h-dvh border-l bg-muted/40 lg:flex lg:flex-col">{panel}</aside>
    </div>
  )
}

/** The big two-line setup heading. */
export function OnboardingHeading({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h1
      className={cn(
        'm-0 text-[40px] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-[44px]',
        className
      )}
    >
      {children}
    </h1>
  )
}

/**
 * A setup text field: 48px, rounded, 16px text. An invalid field keeps a grey
 * focus ring beside its red border, so focus never vanishes into the error.
 */
export const SETUP_FIELD_CLASS =
  'h-12 rounded-xl px-4 text-base aria-invalid:focus-visible:ring-2 aria-invalid:focus-visible:ring-ring aria-invalid:focus-visible:ring-offset-2 aria-invalid:focus-visible:ring-offset-background'

/** The lead paragraph under a setup heading. */
export function OnboardingLead({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 max-w-[440px] text-[15px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

/** The right-hand panel's frame: the preview, centred, with a caption under it. */
export function OnboardingPreviewPanel({
  children,
  caption,
}: {
  children: ReactNode
  caption?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-12">
      <div className="w-full max-w-[640px]">{children}</div>
      {caption ? (
        <p className="max-w-[520px] text-center text-sm text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
}

/**
 * The host this browser reached Quackback on, for the preview's address bar.
 * Read after mount: the server renders the page without it, and reading it
 * during render would differ between the two.
 */
export function useBrowserHost(): string {
  const [host, setHost] = useState('')
  useEffect(() => setHost(window.location.host), [])
  return host
}
