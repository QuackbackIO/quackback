import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@quackback/db', '@quackback/domain'],
  allowedDevOrigins: ['localhost', '*.localhost'],
}

export default nextConfig
