import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <div>
      Settings Layout (stubbed)
      <Outlet />
    </div>
  )
}
