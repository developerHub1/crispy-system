#!/bin/bash
set -e

# Read root .env file and extract CF_TOKEN
if [ -f .env ]; then
  CF_TOKEN=$(node -e "const fs = require('fs'); const env = fs.readFileSync('.env', 'utf8'); const match = env.match(/CF_TOKEN\s*=\s*[\"']?([^\"'\r\n]+)[\"']?/); console.log(match ? match[1] : '');")
elif [ -f ../.env ]; then
  # Fallback check if script is run from infra directory
  CF_TOKEN=$(node -e "const fs = require('fs'); const env = fs.readFileSync('../.env', 'utf8'); const match = env.match(/CF_TOKEN\s*=\s*[\"']?([^\"'\r\n]+)[\"']?/); console.log(match ? match[1] : '');")
else
  echo "Error: .env file not found."
  exit 1
fi

if [ -z "$CF_TOKEN" ]; then
  echo "Error: CF_TOKEN is not set or empty in .env."
  exit 1
fi

# Determine correct paths based on execution context
if [ -f infra/docker-compose.yml ]; then
  COMPOSE_FILE="infra/docker-compose.yml"
else
  COMPOSE_FILE="docker-compose.yml"
fi

echo "Deploying TetsifyMaps stack using Cloudflare Tunnel..."
export TUNNEL_TOKEN="$CF_TOKEN"
docker compose -f "$COMPOSE_FILE" up -d
