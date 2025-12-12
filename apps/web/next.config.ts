import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@quackback/db', '@quackback/domain'],
  allowedDevOrigins: ['localhost', '*.localhost', '*.ngrok.app', '*.quackback.ngrok.app'],
}

export default nextConfig
