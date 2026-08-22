#!/bin/bash
set -e

echo "Stopping any existing quick tunnels..."
docker rm -f tunnel-tileserver tunnel-photon tunnel-osrm 2>/dev/null || true

# Verify network exists
NETWORK="infra_map-network"
if [ -z "$(docker network ls --filter name=^${NETWORK}$ -q)" ]; then
  NETWORK="tetsifymaps_map-network"
  if [ -z "$(docker network ls --filter name=^${NETWORK}$ -q)" ]; then
    # Fallback to whatever network is there
    NETWORK=$(docker network ls --filter driver=bridge --format "{{.Name}}" | grep -E "map-network|infra" | head -n 1 || echo "bridge")
  fi
fi
echo "Using docker network: ${NETWORK}"

echo "Starting TileServer Tunnel (8080)..."
docker run -d --name tunnel-tileserver --network="${NETWORK}" cloudflare/cloudflared:latest tunnel --no-autoupdate --protocol quic --url http://tileserver:8080

echo "Starting Photon Geocoder Tunnel (2322)..."
docker run -d --name tunnel-photon --network="${NETWORK}" cloudflare/cloudflared:latest tunnel --no-autoupdate --protocol quic --url http://photon:2322

echo "Starting OSRM Routing Tunnel (5000)..."
docker run -d --name tunnel-osrm --network="${NETWORK}" cloudflare/cloudflared:latest tunnel --no-autoupdate --protocol quic --url http://osrm:5000

echo "Waiting for tunnels to initialize and propagate..."
sleep 10

# Extract URLs from logs
TILE_URL=$(docker logs tunnel-tileserver 2>&1 | grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" | head -n 1)
PHOTO_URL=$(docker logs tunnel-photon 2>&1 | grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" | head -n 1)
OSRM_URL=$(docker logs tunnel-osrm 2>&1 | grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" | head -n 1)

if [ -z "$TILE_URL" ] || [ -z "$PHOTO_URL" ] || [ -z "$OSRM_URL" ]; then
  echo "Error: Failed to retrieve trycloudflare URLs from container logs."
  echo "--- TileServer logs ---"
  docker logs tunnel-tileserver | tail -n 10
  echo "--- Photon logs ---"
  docker logs tunnel-photon | tail -n 10
  echo "--- OSRM logs ---"
  docker logs tunnel-osrm | tail -n 10
  exit 1
fi

echo "=========================================================="
echo "Cloudflare Quick Tunnels Started Successfully!"
echo "=========================================================="
echo "TileServer (tiles)      : ${TILE_URL}"
echo "Photon (geocoding)      : ${PHOTO_URL}"
echo "OSRM (routing)          : ${OSRM_URL}"
echo "=========================================================="

# Automatically generate/overwrite Next.js .env.local file
ENV_FILE="./examples/nextjs-map/.env.local"
if [ -d "./examples/nextjs-map" ]; then
  echo "Updating Next.js environment file: ${ENV_FILE}"
  cat <<EOT > "${ENV_FILE}"
NEXT_PUBLIC_MAP_TILE_URL="${TILE_URL}/styles/basic-preview/style.json"
NEXT_PUBLIC_GEOCODE_URL="${PHOTO_URL}"
NEXT_PUBLIC_ROUTING_URL="${OSRM_URL}"
EOT
  echo "Next.js env configured. Run 'cd examples/nextjs-map && npm run dev' to launch the web client!"
fi

# Show React Native endpoints for manual configuration
echo "React Native developer config:"
echo "const TILE_STYLE_URL = \"${TILE_URL}/styles/basic-preview/style.json\";"
echo "const GEOCODE_URL = \"${PHOTO_URL}\";"
echo "const ROUTING_URL = \"${OSRM_URL}\";"
echo "=========================================================="
