import { useTheme } from 'next-themes'
import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/24/solid'
import { useEffect, useState } from 'react'

const themes = [
  { value: 'system', label: 'System', icon: ComputerDesktopIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
] as const

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex gap-2">
        {themes.map((t) => (
          <div
            key={t.value}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/50 bg-muted/30"
          >
            <t.icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t.label}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      {themes.map((t) => {
        const isActive = theme === t.value
        return (
          <button
            key={t.value}
            onClick={() => setTheme(t.value)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
          >
            <t.icon className="h-4 w-4" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
