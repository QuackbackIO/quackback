#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "  Quackback Development Setup"
echo "  ============================"
echo ""

# Check for required tools
check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}Error: $1 is not installed${NC}"
    echo "Please install $1 and try again"
    exit 1
  fi
}

echo "Checking prerequisites..."
check_command bun
check_command docker
echo -e "${GREEN}Prerequisites OK${NC}"
echo ""

# Copy .env if it doesn't exist
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${GREEN}Created .env from .env.example${NC}"
    echo -e "${YELLOW}Note: Review .env and update any required values${NC}"
  else
    echo -e "${RED}Error: .env.example not found${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}.env already exists${NC}"
fi

# Generate SECRET_KEY if empty
if grep -q '^SECRET_KEY=""' .env 2>/dev/null; then
  SECRET=$(openssl rand -hex 32)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^SECRET_KEY=\"\"/SECRET_KEY=\"$SECRET\"/" .env
  else
    sed -i "s/^SECRET_KEY=\"\"/SECRET_KEY=\"$SECRET\"/" .env
  fi
  echo -e "${GREEN}Generated SECRET_KEY${NC}"
fi

echo ""

# Check if port 5432 is in use by another container
if docker ps --format '{{.Names}}' | grep -v quackback-db | xargs -I {} docker port {} 2>/dev/null | grep -q "5432"; then
  echo -e "${YELLOW}Port 5432 is in use by another container${NC}"
  echo "Stopping conflicting containers..."
  docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | grep "5432->" | grep -v quackback-db | awk '{print $1}' | xargs -r docker stop
  echo -e "${GREEN}Cleared port 5432${NC}"
fi

# Start PostgreSQL, MinIO, and Dragonfly (minio-init handles bucket creation automatically)
echo "Starting PostgreSQL, MinIO, and Dragonfly..."
docker compose up -d postgres minio minio-init dragonfly

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done
echo -e "${GREEN}PostgreSQL is ready${NC}"

# Wait for MinIO to be ready
echo "Waiting for MinIO to be ready..."
sleep 2
until curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; do
  sleep 1
done
echo -e "${GREEN}MinIO is ready (bucket 'quackback' configured automatically)${NC}"

# Wait for Dragonfly to be ready
echo "Waiting for Dragonfly to be ready..."
until docker compose exec -T dragonfly redis-cli ping > /dev/null 2>&1; do
  sleep 1
done
echo -e "${GREEN}Dragonfly is ready${NC}"
echo ""

# Install dependencies
echo "Installing dependencies..."
bun install
echo -e "${GREEN}Dependencies installed${NC}"
echo ""

# Run database migrations
echo "Running database migrations..."
bun run db:migrate
echo -e "${GREEN}Database ready${NC}"
echo ""

# Done
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo -e "  1. Run the development server:"
echo -e "     ${YELLOW}bun run dev${NC}"
echo ""
echo -e "  2. Open the app in your browser:"
echo -e "     ${YELLOW}http://localhost:3000${NC}"
echo ""
echo -e "  3. (Optional) Seed demo data:"
echo -e "     ${YELLOW}bun run db:seed${NC}"
echo ""
