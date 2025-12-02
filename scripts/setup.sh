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

# Generate BETTER_AUTH_SECRET if still placeholder
if grep -q "your-secret-key-here" .env 2>/dev/null; then
  SECRET=$(openssl rand -hex 32)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/your-secret-key-here/$SECRET/" .env
  else
    sed -i "s/your-secret-key-here/$SECRET/" .env
  fi
  echo -e "${GREEN}Generated BETTER_AUTH_SECRET${NC}"
fi

echo ""

# Check if port 5432 is in use by another container
if docker ps --format '{{.Names}}' | grep -v quackback-db | xargs -I {} docker port {} 2>/dev/null | grep -q "5432"; then
  echo -e "${YELLOW}Port 5432 is in use by another container${NC}"
  echo "Stopping conflicting containers..."
  docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | grep "5432->" | grep -v quackback-db | awk '{print $1}' | xargs -r docker stop
  echo -e "${GREEN}Cleared port 5432${NC}"
fi

# Start PostgreSQL
echo "Starting PostgreSQL..."
docker compose up -d postgres

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done
echo -e "${GREEN}PostgreSQL is ready${NC}"
echo ""

# Install dependencies
echo "Installing dependencies..."
bun install
echo -e "${GREEN}Dependencies installed${NC}"
echo ""

# Push database schema
echo "Setting up database schema..."
bun run db:push
echo -e "${GREEN}Database schema ready${NC}"
echo ""

# Done
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo -e "  1. Run the development server:"
echo -e "     ${YELLOW}bun run dev${NC}"
echo ""
echo -e "  2. Open the app in your browser:"
echo -e "     ${YELLOW}http://app.localhost:3000${NC}"
echo ""
echo -e "  3. (Optional) Seed demo data:"
echo -e "     ${YELLOW}bun run db:seed${NC}"
echo ""
