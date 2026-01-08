/**
 * Workspace Not Found Page
 *
 * Rendered when a domain doesn't map to any workspace in cloud mode.
 * Styled to match Quackback marketing site branding (dark theme, yellow accent).
 */

import { Button } from '@/components/ui/button'

export function WorkspaceNotFoundPage() {
  return (
    <div className="dark grid min-h-dvh place-items-center bg-zinc-950 p-6 text-zinc-50 antialiased">
      <main className="max-w-[420px] text-center">
        <div className="mx-auto mb-10 size-12">
          <img src="/logo.png" alt="Quackback" className="size-full object-contain" />
        </div>

        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Workspace not found</h1>

        <p className="mt-4 text-[15px] leading-relaxed text-zinc-500">
          We couldn't find a workspace at this address. It may have been moved, deleted, or the URL
          might be incorrect.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <a href="https://quackback.io">Go to Quackback</a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="https://quackback.io/signup">Create a workspace</a>
          </Button>
        </div>

        <p className="mt-10 text-[13px] text-zinc-600">
          Need help? Contact{' '}
          <a
            href="mailto:support@quackback.io"
            className="text-zinc-400 transition-colors duration-150 hover:text-primary"
          >
            support@quackback.io
          </a>
        </p>
      </main>
    </div>
  )
}
