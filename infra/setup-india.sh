#!/bin/bash
set -e

# Target Region configuration (India / Maharashtra Area)
REGION="Maharashtra, India (Cropped from Western Zone)"
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

# 1. Download Direct Maharashtra OSM PBF (~164 MB)
MAHARASHTRA_OSM_FILE="${DATA_DIR}/maharashtra.osm.pbf"
OSM_URL="https://download.openstreetmap.fr/extracts/asia/india/maharashtra-latest.osm.pbf"

if [ -f "${MAHARASHTRA_OSM_FILE}" ] && [ $(stat -c%s "${MAHARASHTRA_OSM_FILE}" 2>/dev/null || stat -f%z "${MAHARASHTRA_OSM_FILE}" 2>/dev/null || echo 0) -gt 10000000 ]; then
    echo "[Data] Maharashtra OSM PBF already exists and is valid. Skipping download."
else
    echo "[Data] Downloading Maharashtra OSM PBF directly from OSM France mirror (~164 MB)..."
    rm -f "${MAHARASHTRA_OSM_FILE}"
    curl -f -sSL --retry 3 --retry-delay 5 -o "${MAHARASHTRA_OSM_FILE}" "${OSM_URL}"
    echo "[Data] Maharashtra OSM PBF downloaded successfully!"
fi

# 2. Build TileServer GL Vector Tiles (.mbtiles) using Planetiler container
TILE_FILE="${DATA_DIR}/maharashtra.mbtiles"
SOURCES_DIR="${DATA_DIR}/sources"
mkdir -p "${SOURCES_DIR}"

# Clean up obsolete shapefile zip if present to reclaim runner disk space
rm -f "${SOURCES_DIR}/water-polygons-split-3857.zip"

if [ -f "${TILE_FILE}" ]; then
    echo "[Tiles] Maharashtra MBTiles already exists. Skipping build."
else
    echo "[Tiles] Generating Maharashtra MBTiles using Planetiler..."
    docker run --rm -v "$(pwd)/data:/data" ghcr.io/onthegomap/planetiler:latest \
      --osm_path=/data/maharashtra.osm.pbf \
      --output=/data/maharashtra_tmp.mbtiles \
      --download \
      --download-dir=/data/sources \
      --bounds=72.0,15.5,81.0,22.2 \
      --languages=default,mr \
      --transliterate \
      --transportation-z13-paths=true \
      --building-merge-z13=true \
      --http-timeout=120s \
      --http-retries=10 \
      --http-retry-wait=10s \
      --compress-temp \
      --free-natural-earth-after-read \
      --force
    mv "${DATA_DIR}/maharashtra_tmp.mbtiles" "${TILE_FILE}"
    echo "[Tiles] Vector tiles generated successfully!"
fi

# 4. Process OSRM Data (Extract, Partition, Customize)
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
OSRM_BASE="${DATA_DIR}/maharashtra.osrm"

if [ -f "${OSRM_BASE}.edges" ]; then
    echo "[Routing] Processed OSRM files already exist. Skipping OSRM compilation."
else
    echo "[Routing] Processing OSRM routing data for Maharashtra (Bicycle Profile)..."
    
    echo "  -> Running osrm-extract..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-extract -p /opt/bicycle.lua /data/maharashtra.osm.pbf
    
    echo "  -> Running osrm-partition..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-partition /data/maharashtra.osrm
    
    echo "  -> Running osrm-customize..."
    docker run --rm -v "$(pwd)/data:/data" "${OSRM_IMAGE}" osrm-customize /data/maharashtra.osrm
    
    echo "[Routing] OSRM processing complete!"
    # Clean up raw OSM PBF file to save disk space
    rm -f "${MAHARASHTRA_OSM_FILE}"
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

# 5b. Download Photon JAR file if missing
PHOTON_JAR="${DATA_DIR}/photon-0.4.1.jar"
if [ -f "${PHOTON_JAR}" ]; then
    echo "[Geocoding] Photon JAR already exists. Skipping download."
else
    echo "[Geocoding] Downloading Photon JAR 0.4.1..."
    curl -L -o "${PHOTON_JAR}" "https://github.com/komoot/photon/releases/download/0.4.1/photon-0.4.1.jar"
fi

# 6. Update docker-compose.yml configuration to map new filenames
echo "[Config] Updating docker-compose.yml and docker-compose-arm.yml filenames for Maharashtra, India..."
for compose_file in docker-compose.yml docker-compose-arm.yml; do
  if [ -f "$compose_file" ]; then
    sed -i 's/india.mbtiles/maharashtra.mbtiles/g' "$compose_file"
    sed -i 's/india.osrm/maharashtra.osrm/g' "$compose_file"
    sed -i 's/zurich_switzerland.mbtiles/maharashtra.mbtiles/g' "$compose_file"
    sed -i 's/Zurich.osrm/maharashtra.osrm/g' "$compose_file"
    sed -i 's/western-zone.mbtiles/maharashtra.mbtiles/g' "$compose_file"
    sed -i 's/western-zone.osrm/maharashtra.osrm/g' "$compose_file"
    sed -i 's/mumbai.mbtiles/maharashtra.mbtiles/g' "$compose_file"
    sed -i 's/mumbai.osrm/maharashtra.osrm/g' "$compose_file"
    sed -i 's/pune.mbtiles/maharashtra.mbtiles/g' "$compose_file"
    sed -i 's/pune.osrm/maharashtra.osrm/g' "$compose_file"
  fi
done

echo "================================================================="
echo "Data preparation complete! Run 'npm run maps' to start services."
echo "================================================================="

