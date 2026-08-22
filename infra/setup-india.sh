#!/bin/bash
set -e

# Target Region configuration (India / Mumbai Metropolitan Area)
REGION="Mumbai, India (Cropped from Western Zone)"
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

# 2. Crop OSM PBF to Mumbai Metropolitan Region to accelerate build to < 8 mins
MUMBAI_OSM_FILE="${DATA_DIR}/mumbai.osm.pbf"
if [ -f "${MUMBAI_OSM_FILE}" ]; then
    echo "[Data] Cropped Mumbai OSM PBF already exists. Skipping extraction."
else
    echo "[Data] Extracting Mumbai Metropolitan Region bbox (72.70,18.80,73.15,19.35) using osmium..."
    docker run --rm -v "$(pwd)/data:/data" danieljh/osmium extract --bbox=72.70,18.80,73.15,19.35 -o /data/mumbai.osm.pbf /data/western-zone-latest.osm.pbf --strategy=complete_ways
    echo "[Data] Mumbai OSM PBF extracted successfully!"
fi

# 3. Build TileServer GL Vector Tiles (.mbtiles) using Planetiler container
TILE_FILE="${DATA_DIR}/mumbai.mbtiles"
if [ -f "${TILE_FILE}" ]; then
    echo "[Tiles] Mumbai MBTiles already exists. Skipping build."
else
    echo "[Tiles] Generating Mumbai MBTiles using Planetiler..."
    docker run --rm -v "$(pwd)/data:/data" ghcr.io/onthegomap/planetiler:latest --osm_path=/data/mumbai.osm.pbf --output=/data/mumbai.mbtiles --download
    echo "[Tiles] Vector tiles generated successfully!"
fi

# 4. Process OSRM Data (Extract, Partition, Customize)
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
OSRM_BASE="${DATA_DIR}/mumbai.osrm"

if [ -f "${OSRM_BASE}" ]; then
    echo "[Routing] Processed OSRM files already exist. Skipping OSRM compilation."
else
    echo "[Routing] Processing OSRM routing data for Mumbai (Car Profile)..."
    
    echo "  -> Running osrm-extract..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-extract -p /opt/car.lua /data/mumbai.osm.pbf
    
    echo "  -> Running osrm-partition..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-partition /data/mumbai.osrm
    
    echo "  -> Running osrm-customize..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-customize /data/mumbai.osrm
    
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
echo "[Config] Updating docker-compose.yml filenames for Mumbai, India..."
sed -i 's/zurich_switzerland.mbtiles/mumbai.mbtiles/g' docker-compose.yml
sed -i 's/Zurich.osrm/mumbai.osrm/g' docker-compose.yml
sed -i 's/western-zone.mbtiles/mumbai.mbtiles/g' docker-compose.yml
sed -i 's/western-zone.osrm/mumbai.osrm/g' docker-compose.yml

echo "================================================================="
echo "Data preparation complete! Run 'npm run maps' to start services."
echo "================================================================="

