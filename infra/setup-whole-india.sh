#!/bin/bash
set -e

# Target Region configuration (Whole India)
REGION="Whole India"
COUNTRY_CODE="in"

# Define directories
DATA_DIR="./data"
PHOTON_DIR="${DATA_DIR}/photon_data"

echo "================================================================="
echo "Starting Mapping Infrastructure Setup for Region: ${REGION}"
echo "================================================================="

# Create necessary directories
mkdir -p "${DATA_DIR}"
mkdir -p "${PHOTON_DIR}"

# 1. Download Full India OSM PBF (~1.4 GB)
OSM_URL="https://download.geofabrik.de/asia/india-latest.osm.pbf"
OSM_FILE="${DATA_DIR}/india-latest.osm.pbf"

if [ -f "${OSM_FILE}" ]; then
    echo "[Data] Whole India OSM PBF already exists. Skipping download."
else
    echo "[Data] Downloading Whole India OSM PBF (~1.4 GB)..."
    curl -L -o "${OSM_FILE}" "${OSM_URL}"
fi

# 2. Build TileServer GL Vector Tiles (.mbtiles) using Planetiler
TILE_FILE="${DATA_DIR}/india.mbtiles"
if [ -f "${TILE_FILE}" ]; then
    echo "[Tiles] Whole India MBTiles already exists. Skipping build."
else
    echo "[Tiles] Generating Whole India MBTiles using Planetiler..."
    docker run --rm -v "$(pwd)/data:/data" ghcr.io/onthegomap/planetiler:latest \
      --osm_path=/data/india-latest.osm.pbf \
      --output=/data/india_tmp.mbtiles \
      --download \
      --compress-temp \
      --free-lake-centerlines-after-read \
      --free-water-polygons-after-read \
      --free-natural-earth-after-read \
      --force
    mv "${DATA_DIR}/india_tmp.mbtiles" "${TILE_FILE}"
    echo "[Tiles] Vector tiles for Whole India generated successfully!"
fi

# 3. Process OSRM Data for Whole India (Extract, Partition, Customize)
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
OSRM_BASE="${DATA_DIR}/india.osrm"

if [ -f "${OSRM_BASE}.edges" ]; then
    echo "[Routing] Processed OSRM files for India already exist. Skipping OSRM compilation."
else
    echo "[Routing] Processing OSRM routing data for Whole India (Bicycle Profile)..."
    
    echo "  -> Running osrm-extract..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-extract -p /opt/bicycle.lua /data/india-latest.osm.pbf
    
    echo "  -> Running osrm-partition..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-partition /data/india.osrm
    
    echo "  -> Running osrm-customize..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-customize /data/india.osrm
    
    echo "[Routing] OSRM processing for Whole India complete!"
    # Clean up raw OSM PBF file to save disk space
    rm -f "${OSM_FILE}"
fi

# 4. Download and Extract India Photon Geocoding Index (745 MB)
echo "[Geocoding] Scoping latest Photon database for India (in) from GraphHopper..."
PHOTON_FILE=$(curl -s "https://download1.graphhopper.com/public/extracts/by-country-code/${COUNTRY_CODE}/" | grep -oE "photon-db-${COUNTRY_CODE}-[0-9]+\.tar\.bz2" | head -n 1)

if [ -z "${PHOTON_FILE}" ]; then
    echo "[Geocoding] Warning: Could not scrape latest filename. Defaulting to standard naming convention."
    PHOTON_FILE="photon-db-${COUNTRY_CODE}-latest.tar.bz2"
fi

PHOTON_URL="https://download1.graphhopper.com/public/extracts/by-country-code/${COUNTRY_CODE}/${PHOTON_FILE}"

if [ -d "${PHOTON_DIR}/elasticsearch/data" ]; then
    echo "[Geocoding] Photon India database already exists. Skipping download."
else
    echo "[Geocoding] Downloading Photon index (${PHOTON_FILE}) from: ${PHOTON_URL}"
    curl -L "${PHOTON_URL}" | bunzip2 -cd | tar -x -C "${DATA_DIR}"
    echo "[Geocoding] Photon index extraction complete!"
fi

# Download Photon JAR file if missing
PHOTON_JAR="${DATA_DIR}/photon-0.4.1.jar"
if [ -f "${PHOTON_JAR}" ]; then
    echo "[Geocoding] Photon JAR already exists. Skipping download."
else
    echo "[Geocoding] Downloading Photon JAR 0.4.1..."
    curl -L -o "${PHOTON_JAR}" "https://github.com/komoot/photon/releases/download/0.4.1/photon-0.4.1.jar"
fi

# 5. Update docker-compose.yml configuration to map Whole India filenames
echo "[Config] Updating docker-compose.yml and docker-compose-arm.yml filenames for Whole India..."
for compose_file in docker-compose.yml docker-compose-arm.yml; do
  if [ -f "$compose_file" ]; then
    sed -i 's/maharashtra.mbtiles/india.mbtiles/g' "$compose_file"
    sed -i 's/maharashtra.osrm/india.osrm/g' "$compose_file"
    sed -i 's/zurich_switzerland.mbtiles/india.mbtiles/g' "$compose_file"
    sed -i 's/Zurich.osrm/india.osrm/g' "$compose_file"
  fi
done

echo "================================================================="
echo "Whole India data preparation complete!"
echo "================================================================="
