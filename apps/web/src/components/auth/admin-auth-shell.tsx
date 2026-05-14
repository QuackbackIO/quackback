import { PortalBrandMark } from './portal-brand-mark'

interface AdminAuthShellProps {
  heading: string
  subheading?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * Layout for the admin sign-in surfaces (`/admin/login`). Mirrors the
 * `PortalAuthShell` visual hierarchy (brand mark → headline → subhead
 * → form → footer) but:
 *
 *  - **Brand mark is the workspace** (logo + name). Admins are signing
 *    into a specific tenant; the mark identifies which one. Slack /
 *    Linear / Notion all anchor admin sign-in on the workspace.
 *  - **No workspace themeStyles** are injected. An aggressively
 *    branded portal theme shouldn't repaint the admin sign-in to look
 *    like a different product, so we keep the default Quackback
 *    palette for buttons and accents.
 *  - **Quackback attribution** lives as a small footer credit
 *    (matches Linear / Vercel admin sign-in pattern).
 */
export function AdminAuthShell({ heading, subheading, children, footer }: AdminAuthShellProps) {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[40vh] bg-[radial-gradient(ellipse_at_top,_var(--primary)/0.08,_transparent_60%)]"
      />
      <div className="relative w-full max-w-sm space-y-10">
        <div className="flex flex-col items-center gap-8 text-center">
          <PortalBrandMark />
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
            {subheading && (
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[36ch] mx-auto">
                {subheading}
              </p>
            )}
          </div>
        </div>
        {children}
        {footer}
      </div>
      <a
        href="https://quackback.io"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-6 inset-x-0 mx-auto w-fit flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <img src="/logo.png" alt="" className="h-3.5 w-3.5 opacity-80" />
        Powered by Quackback
      </a>
    </div>
  )
}
