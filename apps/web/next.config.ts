import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@quackback/db', '@quackback/shared'],
  allowedDevOrigins: ['quackback.localhost', '*.quackback.localhost'],
}

export default nextConfig
