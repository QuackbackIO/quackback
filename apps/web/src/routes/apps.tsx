import { createFileRoute, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

const setIframeHeaders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Content-Security-Policy', 'frame-ancestors *')
  setResponseHeader('X-Frame-Options', 'ALLOWALL')
})

export const Route = createFileRoute('/apps')({
  loader: () => setIframeHeaders(),
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
