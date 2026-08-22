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
  TARGET_DATA="infra/data"
else
  COMPOSE_FILE="docker-compose.yml"
  TARGET_DATA="data"
fi

PERSISTENT_DATA="/home/runner/persistent/TetsifyMaps/infra/data"
if [ -d "$PERSISTENT_DATA" ]; then
  ABS_TARGET=$(readlink -f "$TARGET_DATA" 2>/dev/null || true)
  ABS_PERSISTENT=$(readlink -f "$PERSISTENT_DATA" 2>/dev/null || true)
  if [ "$ABS_TARGET" != "$ABS_PERSISTENT" ]; then
    echo "Found persistent data at $PERSISTENT_DATA. Linking to $TARGET_DATA..."
    rm -rf "$TARGET_DATA"
    ln -s "$PERSISTENT_DATA" "$TARGET_DATA"
  fi
fi

# Check if Maharashtra required files are missing
if [ ! -f "$TARGET_DATA/maharashtra.mbtiles" ] || [ ! -f "$TARGET_DATA/maharashtra.osrm.edges" ] || [ ! -d "$TARGET_DATA/photon_data" ] || [ ! -f "$TARGET_DATA/photon-0.4.1.jar" ]; then
  echo "Required Maharashtra geospatial data files are missing in $TARGET_DATA."
  echo "Running setup-india.sh to download and prepare the data..."
  if [ -f infra/setup-india.sh ]; then
    (cd infra && bash setup-india.sh)
  else
    bash setup-india.sh
  fi
fi

# Ensure docker-compose is updated for Maharashtra
if [ -f infra/docker-compose.yml ]; then
  sed -i 's/india.mbtiles/maharashtra.mbtiles/g' infra/docker-compose.yml
  sed -i 's/india.osrm/maharashtra.osrm/g' infra/docker-compose.yml
else
  sed -i 's/india.mbtiles/maharashtra.mbtiles/g' docker-compose.yml
  sed -i 's/india.osrm/maharashtra.osrm/g' docker-compose.yml
fi

echo "Deploying TetsifyMaps stack for Maharashtra using Cloudflare Tunnel..."
export TUNNEL_TOKEN="$CF_TOKEN"
docker compose -f "$COMPOSE_FILE" up -d
