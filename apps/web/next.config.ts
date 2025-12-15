import type { NextConfig } from 'next'
import { resolve } from 'path'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@quackback/db', '@quackback/domain'],
  turbopack: {
    root: resolve(__dirname, '../..'),
  },
  allowedDevOrigins: ['localhost', '*.localhost', '*.ngrok.app', '*.quackback.ngrok.app'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
}

export default nextConfig
