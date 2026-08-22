#!/bin/bash
set -e

# Target Region configuration (Default: Zurich, Switzerland)
REGION="Zurich"
COUNTRY_CODE="ch"

# Define directories
DATA_DIR="./data"
PHOTON_DIR="${DATA_DIR}/photon_data"

echo "================================================================="
echo "Starting Mapping Infrastructure Data Setup for Region: ${REGION}"
echo "================================================================="

# Create necessary directories
mkdir -p "${DATA_DIR}"
mkdir -p "${PHOTON_DIR}"

# 1. Download TileServer GL Vector Tiles (.mbtiles)
# Zurich vector tiles from MapTiler (~7.4 MB)
TILE_URL="https://github.com/maptiler/tileserver-gl/releases/download/v1.3.0/zurich_switzerland.mbtiles"
TILE_FILE="${DATA_DIR}/zurich_switzerland.mbtiles"

if [ -f "${TILE_FILE}" ]; then
    echo "[Tiles] Zurich MBTiles already exists. Skipping download."
else
    echo "[Tiles] Downloading Zurich MBTiles..."
    curl -L -o "${TILE_FILE}" "${TILE_URL}"
fi

# 2. Download OSM PBF for Routing Engine (OSRM)
# Zürich city extract from OSM France mirror (~79 MB)
OSM_URL="https://download.openstreetmap.fr/extracts/europe/switzerland/zurich-latest.osm.pbf"
OSM_FILE="${DATA_DIR}/Zurich.osm.pbf"

if [ -f "${OSM_FILE}" ]; then
    echo "[Routing] Zurich OSM PBF already exists. Skipping download."
else
    echo "[Routing] Downloading Zurich OSM PBF..."
    curl -L -o "${OSM_FILE}" "${OSM_URL}"
fi

# 3. Process OSRM Data (Extract, Partition, Customize)
# This runs inside standard OSRM Docker containers, avoiding any local host compilation.
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
OSRM_BASE="${DATA_DIR}/Zurich.osrm"

if [ -f "${OSRM_BASE}" ]; then
    echo "[Routing] Processed OSRM files already exist. Skipping OSRM compilation."
else
    echo "[Routing] Processing OSRM routing data (Car Profile)..."
    
    echo "  -> Running osrm-extract..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-extract -p /opt/car.lua /data/Zurich.osm.pbf
    
    echo "  -> Running osrm-partition..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-partition /data/Zurich.osrm
    
    echo "  -> Running osrm-customize..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-customize /data/Zurich.osrm
    
    echo "[Routing] OSRM processing complete!"
fi

# 4. Download and Extract Photon Geocoding Lucene/OpenSearch Index
# We scrape GraphHopper's weekly Photon database directory to find the latest filename
echo "[Geocoding] Scoping latest Photon database for country '${COUNTRY_CODE}' from GraphHopper..."
PHOTON_FILE=$(curl -s "https://download1.graphhopper.com/public/extracts/by-country-code/${COUNTRY_CODE}/" | grep -oE "photon-db-${COUNTRY_CODE}-[0-9]+\.tar\.bz2" | head -n 1)

if [ -z "${PHOTON_FILE}" ]; then
    echo "[Geocoding] Warning: Could not scrape latest filename. Defaulting to standard naming convention."
    PHOTON_FILE="photon-db-${COUNTRY_CODE}-latest.tar.bz2"
fi

PHOTON_URL="https://download1.graphhopper.com/public/extracts/by-country-code/${COUNTRY_CODE}/${PHOTON_FILE}"
PHOTON_ARCHIVE="${DATA_DIR}/${PHOTON_FILE}"

# Check if photon database is already populated
if [ -d "${PHOTON_DIR}/elasticsearch/data" ]; then
    echo "[Geocoding] Photon database already exists. Skipping download."
else
    echo "[Geocoding] Downloading Photon index (${PHOTON_FILE}) from: ${PHOTON_URL}"
    # Download the bz2 and extract directly to keep storage footprint minimal
    curl -L "${PHOTON_URL}" | bunzip2 -cd | tar -x -C "${DATA_DIR}"
    echo "[Geocoding] Photon index extraction complete!"
fi

echo "================================================================="
echo "Data preparation complete! Run 'docker compose up -d' to start."
echo "================================================================="
