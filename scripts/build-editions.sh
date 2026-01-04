#!/bin/bash
#
# Build Docker images for all Quackback editions
#
# Usage:
#   ./scripts/build-editions.sh              # Build all editions
#   ./scripts/build-editions.sh community    # Build specific edition
#   ./scripts/build-editions.sh --push       # Build and push to registry
#
# Images produced:
#   quackback:latest      - Default community edition (self-hosted, no EE)
#   quackback:community   - Alias for latest
#   quackback:enterprise  - Self-hosted with EE packages
#   quackback:cloud       - Cloud edition with EE packages (for hosted tiers)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Registry prefix (set REGISTRY env var to override)
REGISTRY="${REGISTRY:-}"
if [ -n "$REGISTRY" ]; then
  PREFIX="${REGISTRY}/"
else
  PREFIX=""
fi

# Parse arguments
PUSH=false
EDITIONS=()

for arg in "$@"; do
  case $arg in
    --push)
      PUSH=true
      ;;
    community|enterprise|cloud)
      EDITIONS+=("$arg")
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [community|enterprise|cloud] [--push]"
      exit 1
      ;;
  esac
done

# Default to all editions if none specified
if [ ${#EDITIONS[@]} -eq 0 ]; then
  EDITIONS=(community enterprise cloud)
fi

echo "=== Building Quackback Docker Images ==="
echo "Editions: ${EDITIONS[*]}"
echo "Push: $PUSH"
echo ""

cd "$ROOT_DIR"

for edition in "${EDITIONS[@]}"; do
  case $edition in
    community)
      echo "Building community edition..."
      docker build \
        --build-arg EDITION=self-hosted \
        --build-arg INCLUDE_EE=false \
        -t "${PREFIX}quackback:community" \
        -t "${PREFIX}quackback:latest" \
        -f apps/web/Dockerfile .

      if [ "$PUSH" = true ]; then
        docker push "${PREFIX}quackback:community"
        docker push "${PREFIX}quackback:latest"
      fi
      ;;

    enterprise)
      echo "Building enterprise edition..."
      docker build \
        --build-arg EDITION=self-hosted \
        --build-arg INCLUDE_EE=true \
        -t "${PREFIX}quackback:enterprise" \
        -f apps/web/Dockerfile .

      if [ "$PUSH" = true ]; then
        docker push "${PREFIX}quackback:enterprise"
      fi
      ;;

    cloud)
      echo "Building cloud edition..."
      docker build \
        --build-arg EDITION=cloud \
        --build-arg INCLUDE_EE=true \
        -t "${PREFIX}quackback:cloud" \
        -f apps/web/Dockerfile .

      if [ "$PUSH" = true ]; then
        docker push "${PREFIX}quackback:cloud"
      fi
      ;;
  esac

  echo ""
done

echo "=== Build Complete ==="
echo ""
echo "Images built:"
for edition in "${EDITIONS[@]}"; do
  case $edition in
    community)
      echo "  - ${PREFIX}quackback:community"
      echo "  - ${PREFIX}quackback:latest"
      ;;
    enterprise)
      echo "  - ${PREFIX}quackback:enterprise"
      ;;
    cloud)
      echo "  - ${PREFIX}quackback:cloud"
      ;;
  esac
done
