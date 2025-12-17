#!/bin/bash
# Deploy script for Cloudflare Workers
# Uses @opennextjs/cloudflare deploy (wrangler's built-in detection uses wrong package name)
#
# Usage:
#   ./scripts/deploy-cloudflare.sh         # Deploy only (requires prior build)
#   bun run deploy:cf                      # Build + deploy

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if build output exists
if [ ! -f "$PROJECT_DIR/.open-next/worker.js" ]; then
    echo "Error: Build output not found. Run ./scripts/build-cloudflare.sh first."
    exit 1
fi

echo "Deploying Quackback to Cloudflare Workers..."

# Run the deploy from the project directory using npx
cd "$PROJECT_DIR"
npx @opennextjs/cloudflare deploy

echo "Deploy complete!"
