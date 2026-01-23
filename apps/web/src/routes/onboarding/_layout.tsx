import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * Shared layout for all onboarding steps.
 * Dark theme with amber accents matching website design.
 */
export const Route = createFileRoute('/onboarding/_layout')({
  component: OnboardingLayout,
})

function OnboardingLayout() {
  return (
    <div className="min-h-screen bg-background">
      {/* Background effects - matching website */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_30%,rgba(255,212,59,0.06),transparent)]" />
      <div
        className="fixed inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      <main className="relative flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
