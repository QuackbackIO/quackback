import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@quackback/db', '@quackback/shared'],
  allowedDevOrigins: ['localhost', '*.localhost'],
}

export default nextConfig
