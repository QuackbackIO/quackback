import { useEffect, useState, type ReactNode, type Ref } from 'react'
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
}: {
  children: ReactNode
  footer?: ReactNode
  panel: ReactNode
}) {
  // One column width for every step, so the divider and the preview stay put
  // as the steps change.
  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[600px_minmax(0,1fr)]">
      <div className="flex min-h-dvh flex-col px-5 pt-8 pb-8 sm:px-10 lg:pt-14 lg:pr-16 lg:pb-12 lg:pl-20 xl:pl-28">
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

/** The big setup heading. */
export function OnboardingHeading({
  children,
  className,
  ref,
  tabIndex,
}: {
  children: ReactNode
  className?: string
  ref?: Ref<HTMLHeadingElement>
  /** -1 lets a step move focus here when it appears in place. */
  tabIndex?: number
}) {
  return (
    <h1
      ref={ref}
      tabIndex={tabIndex}
      className={cn(
        // The weight and tracking are marked important: an unlayered global
        // h1-h3 rule sets both, and unlayered styles beat every utility.
        'm-0 text-[40px] leading-[1.05] font-extrabold! tracking-[-0.03em]! outline-none sm:text-[44px]',
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
  'h-12 rounded-xl px-4 text-base md:text-base aria-invalid:focus-visible:ring-2 aria-invalid:focus-visible:ring-ring aria-invalid:focus-visible:ring-offset-2 aria-invalid:focus-visible:ring-offset-background'

/**
 * A setup step's main button: a 48px pill with 16px text. A button that is
 * working (`aria-busy`) keeps its full colour beside its spinner; one that
 * truly cannot be pressed turns muted, never a faded yellow.
 */
export const SETUP_CTA_CLASS =
  'h-12 w-full rounded-full text-base disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 aria-busy:disabled:bg-primary aria-busy:disabled:text-primary-foreground'

/**
 * Sizes the shared sign-in form like the setup form beside it: 48px fields
 * and full-width buttons, 16px text. A submit button that is working (it shows
 * a spinner) keeps its colour; one that cannot be pressed yet turns muted.
 */
export const SETUP_AUTH_FORM_CLASS = cn(
  '[&_[data-slot=input]]:h-12 [&_[data-slot=input]]:rounded-xl [&_[data-slot=input]]:px-4 [&_[data-slot=input]]:text-base',
  '[&_[data-slot=button].w-full]:h-12 [&_[data-slot=button].w-full]:rounded-full [&_[data-slot=button].w-full]:text-base',
  '[&_[data-slot=button][type=submit]:disabled]:bg-muted [&_[data-slot=button][type=submit]:disabled]:text-muted-foreground [&_[data-slot=button][type=submit]:disabled]:opacity-100',
  '[&_[data-slot=button][type=submit]:disabled:has(.animate-spin)]:bg-primary [&_[data-slot=button][type=submit]:disabled:has(.animate-spin)]:text-primary-foreground'
)

/** The lead paragraph under a setup heading. */
export function OnboardingLead({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        'mt-4 max-w-[440px] text-[15px] leading-relaxed text-muted-foreground',
        className
      )}
    >
      {children}
    </p>
  )
}

/**
 * A step's main action. On a screen too short for the step it stays pinned to
 * the bottom of the window, so the next move never has to be hunted for; where
 * the step fits, it sits in place under the form.
 */
export function SetupActions({ children, className }: { children: ReactNode; className?: string }) {
  // Sticky holds only within its parent, so this belongs directly in the
  // step's own column, not in a wrapper of its own height.
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 bg-background pt-2 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-background before:to-transparent',
        className
      )}
    >
      {children}
    </div>
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

/**
 * Names the browser tab for a setup screen, and gives the previous title back
 * when the screen goes. The steps change in place, so the title is the one
 * thing that tells a screen reader or a row of tabs which step this is.
 */
export function useSetupTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
