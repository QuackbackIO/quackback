#!/bin/bash
# Build script for Cloudflare Workers deployment
# This script uses an isolated npm environment to avoid dependency conflicts
# between @opennextjs/cloudflare's dependencies and the project's dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR="/tmp/opennext-build-$$"

echo "Building Quackback for Cloudflare Workers..."

# Create isolated environment for opennextjs-cloudflare
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# Install opennextjs-cloudflare in isolation
echo "Setting up build tools..."
npm init -y > /dev/null 2>&1
npm install @opennextjs/cloudflare@latest wrangler@4.53.0 --silent 2>&1

# Build email templates first (pre-renders React Email to static HTML)
cd "$PROJECT_DIR/../.."
echo "Building email templates..."
bun run build:email

# Run the build from the project directory
cd "$PROJECT_DIR"
echo "Running OpenNext build..."
"$TEMP_DIR/node_modules/.bin/opennextjs-cloudflare" build

# Cleanup
rm -rf "$TEMP_DIR"

echo "Build complete! Worker saved in .open-next/worker.js"
