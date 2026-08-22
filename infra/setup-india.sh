#!/bin/bash
set -e

# Target Region configuration (India / Pune Area)
REGION="Pune, India (Cropped from Western Zone)"
COUNTRY_CODE="in"

# Define directories
DATA_DIR="./data"
PHOTON_DIR="${DATA_DIR}/photon_data"

echo "================================================================="
echo "Starting Mapping Infrastructure Data Setup for Region: ${REGION}"
echo "================================================================="

# Create necessary directories
mkdir -p "${DATA_DIR}"
mkdir -p "${PHOTON_DIR}"

# 1. Download OSM PBF for Western Zone (209 MB)
OSM_URL="https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf"
OSM_FILE="${DATA_DIR}/western-zone-latest.osm.pbf"

if [ -f "${OSM_FILE}" ]; then
    echo "[Data] Western Zone OSM PBF already exists. Skipping download."
else
    echo "[Data] Downloading Western Zone OSM PBF (~209 MB)..."
    curl -L -o "${OSM_FILE}" "${OSM_URL}"
fi

# 2. Crop OSM PBF to Pune Metropolitan Region to accelerate build to < 8 mins
PUNE_OSM_FILE="${DATA_DIR}/pune.osm.pbf"
if [ -f "${PUNE_OSM_FILE}" ]; then
    echo "[Data] Cropped Pune OSM PBF already exists. Skipping extraction."
else
    echo "[Data] Extracting Pune Metropolitan Region bbox (73.72,18.42,74.00,18.66) using osmium..."
    docker run --rm -v "$(pwd)/data:/data" danieljh/osmium extract --bbox=73.72,18.42,74.00,18.66 -o /data/pune.osm.pbf /data/western-zone-latest.osm.pbf --strategy=complete_ways
    echo "[Data] Pune OSM PBF extracted successfully!"
fi

# 3. Build TileServer GL Vector Tiles (.mbtiles) using Planetiler container
TILE_FILE="${DATA_DIR}/pune.mbtiles"
if [ -f "${TILE_FILE}" ]; then
    echo "[Tiles] Pune MBTiles already exists. Skipping build."
else
    echo "[Tiles] Generating Pune MBTiles using Planetiler..."
    docker run --rm -v "$(pwd)/data:/data" ghcr.io/onthegomap/planetiler:latest --osm_path=/data/pune.osm.pbf --output=/data/pune.mbtiles --download
    echo "[Tiles] Vector tiles generated successfully!"
fi

# 4. Process OSRM Data (Extract, Partition, Customize)
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
OSRM_BASE="${DATA_DIR}/pune.osrm"

if [ -f "${OSRM_BASE}" ]; then
    echo "[Routing] Processed OSRM files already exist. Skipping OSRM compilation."
else
    echo "[Routing] Processing OSRM routing data for Pune (Car Profile)..."
    
    echo "  -> Running osrm-extract..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-extract -p /opt/car.lua /data/pune.osm.pbf
    
    echo "  -> Running osrm-partition..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-partition /data/pune.osrm
    
    echo "  -> Running osrm-customize..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-customize /data/pune.osrm
    
    echo "[Routing] OSRM processing complete!"
fi

# 5. Download and Extract India Photon Geocoding Index (745 MB)
echo "[Geocoding] Scoping latest Photon database for India (in) from GraphHopper..."
PHOTON_FILE=$(curl -s "https://download1.graphhopper.com/public/extracts/by-country-code/${COUNTRY_CODE}/" | grep -oE "photon-db-${COUNTRY_CODE}-[0-9]+\.tar\.bz2" | head -n 1)

if [ -z "${PHOTON_FILE}" ]; then
    echo "[Geocoding] Warning: Could not scrape latest filename. Defaulting to standard naming convention."
    PHOTON_FILE="photon-db-${COUNTRY_CODE}-latest.tar.bz2"
fi

PHOTON_URL="https://download1.graphhopper.com/public/extracts/by-country-code/${COUNTRY_CODE}/${PHOTON_FILE}"
PHOTON_ARCHIVE="${DATA_DIR}/${PHOTON_FILE}"

if [ -d "${PHOTON_DIR}/elasticsearch/data" ]; then
    echo "[Geocoding] Photon India database already exists. Skipping download."
else
    echo "[Geocoding] Downloading Photon index (${PHOTON_FILE}) from: ${PHOTON_URL}"
    # Download the bz2 and extract directly to keep storage footprint minimal
    curl -L "${PHOTON_URL}" | bunzip2 -cd | tar -x -C "${DATA_DIR}"
    
    # Clean up old database directory if it exists and move new one in place
    if [ -d "${DATA_DIR}/photon_data" ]; then
        echo "[Geocoding] Photon database unpacked into data/photon_data."
    fi
    echo "[Geocoding] Photon index extraction complete!"
fi

# 6. Update docker-compose.yml configuration to map new filenames
echo "[Config] Updating docker-compose.yml filenames for Pune, India..."
sed -i 's/zurich_switzerland.mbtiles/pune.mbtiles/g' docker-compose.yml
sed -i 's/Zurich.osrm/pune.osrm/g' docker-compose.yml
sed -i 's/western-zone.mbtiles/pune.mbtiles/g' docker-compose.yml
sed -i 's/western-zone.osrm/pune.osrm/g' docker-compose.yml
sed -i 's/mumbai.mbtiles/pune.mbtiles/g' docker-compose.yml
sed -i 's/mumbai.osrm/pune.osrm/g' docker-compose.yml

echo "================================================================="
echo "Data preparation complete! Run 'npm run maps' to start services."
echo "================================================================="

