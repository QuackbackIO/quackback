import { isSelfHosted } from '@quackback/domain'
import { SettingsNav } from './settings-nav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const isCloud = !isSelfHosted()

  return (
    <div className="flex gap-8 px-6 py-8">
      <SettingsNav isCloud={isCloud} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
