import { SettingsNav } from './settings-nav'

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-8 px-6 py-8">
      <SettingsNav />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
