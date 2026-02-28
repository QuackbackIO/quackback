import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/apps')({
  loader: async () => {
    const { setResponseHeader } = await import('@tanstack/react-start/server')
    setResponseHeader('Content-Security-Policy', 'frame-ancestors *')
    setResponseHeader('X-Frame-Options', 'ALLOWALL')
  },
  component: AppsLayout,
})

function AppsLayout() {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { overflow: auto; margin: 0; }
            html, body, #root { height: 100%; }
          `,
        }}
      />
      <Outlet />
    </>
  )
}
