#!/bin/bash
set -e


# Determine correct paths based on execution context
if [ -f infra/docker-compose-arm.yml ]; then
  COMPOSE_FILE="infra/docker-compose-arm.yml"
  TARGET_DATA="infra/data"
else
  COMPOSE_FILE="docker-compose-arm.yml"
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

# Check if Whole India data files are present, else run setup-whole-india.sh
if [ ! -f "$TARGET_DATA/india.mbtiles" ] || [ ! -f "$TARGET_DATA/india.osrm.edges" ] || [ ! -d "$TARGET_DATA/photon_data" ]; then
  echo "Required Whole India geospatial data files are missing in $TARGET_DATA."
  echo "Running setup-whole-india.sh..."
  if [ -f infra/setup-whole-india.sh ]; then
    (cd infra && bash setup-whole-india.sh)
  else
    bash setup-whole-india.sh
  fi
fi

# Ensure docker-compose-arm is updated for whole India
if [ -f infra/docker-compose-arm.yml ]; then
  sed -i 's/maharashtra.mbtiles/india.mbtiles/g' infra/docker-compose-arm.yml
  sed -i 's/maharashtra.osrm/india.osrm/g' infra/docker-compose-arm.yml
else
  sed -i 's/maharashtra.mbtiles/india.mbtiles/g' docker-compose-arm.yml
  sed -i 's/maharashtra.osrm/india.osrm/g' docker-compose-arm.yml
fi

echo "Installing project dependencies (including PM2)..."
npm install --no-audit --no-fund

echo "Deploying TetsifyMaps stack for Whole India on ARM via PM2..."
# Delete any existing process and launch via PM2
npx pm2 delete testify-maps-arm 2>/dev/null || true
npx pm2 start infra/ecosystem.config.js

echo "================================================================="
echo "Deployment via PM2 complete! Run 'npx pm2 status' or 'npx pm2 logs' to monitor."
echo "================================================================="
