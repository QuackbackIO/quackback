/**
 * Workspace Not Found Page
 *
 * Rendered when a domain doesn't map to any workspace in cloud mode.
 * Styled to match Quackback marketing site branding (dark theme, yellow accent).
 */

export function WorkspaceNotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-zinc-950 p-6 text-zinc-50 antialiased">
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
          <a
            href="https://quackback.io"
            className="inline-flex h-11 items-center justify-center rounded-[10px] bg-[#FFD43B] px-6 text-sm font-semibold text-zinc-950 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#F2C230] hover:shadow-[0_8px_24px_-8px_rgba(255,212,59,0.3)]"
          >
            Go to Quackback
          </a>
          <a
            href="https://quackback.io/signup"
            className="inline-flex h-11 items-center justify-center rounded-[10px] border border-zinc-700 bg-zinc-800 px-6 text-sm font-semibold text-zinc-50 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-zinc-700"
          >
            Create a workspace
          </a>
        </div>

        <p className="mt-10 text-[13px] text-zinc-600">
          Need help? Contact{' '}
          <a
            href="mailto:support@quackback.io"
            className="text-zinc-400 transition-colors duration-150 hover:text-[#FFD43B]"
          >
            support@quackback.io
          </a>
        </p>
      </main>
    </div>
  )
}
