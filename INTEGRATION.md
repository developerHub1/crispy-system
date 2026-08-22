# Geospatial Delivery Tracker Integration Guide (Zomato-Style)

This guide details how to build a real-time **Delivery Agent Live Tracking & ETA Dashboard** (similar to Zomato, Swiggy, or Uber Eats) using your self-hosted geospatial stack:
* **TileServer GL** (Maharashtra maps)
* **OSRM** (Routing, ETA, and Snap-to-Road)
* **Photon** (Restaurant & Customer Address Search)

---

## 1. System Architecture

To track a delivery rider in real time and show the path on the map, you need three components:

```mermaid
graph TD
    RiderApp[Rider Mobile App - React Native] -->|1. Live Coordinates via WebSocket| AppServer[Application Backend - Node.js/Go]
    AppServer -->|2. Query Road Match & ETA| OSRM[OSRM Container - Port 5000]
    AppServer -->|3. Broadcast Location + ETA| CustomerApp[Customer Live Dashboard - Next.js]
    CustomerApp -->|4. Request Map Tiles| TileServer[TileServer GL - Port 8080]
    MerchantDashboard[Merchant Dashboard] -->|5. Geocode Addresses| Photon[Photon Geocoder - Port 2322]
```

## 2. API Endpoints Reference

All routing, tile serving, and geocoding services run **locally in your infrastructure**. There are **zero external dependencies** or third-party usage limits (no Google Maps or Mapbox billings).

### A. Geocoding & Reverse Geocoding (Photon)
Use **Photon** to find coordinates of locations, or get street names from coordinates.

* **Search Geocoding API**: `https://geocode.testifysamples.com/api?q={query}`
  * *Example*: `curl "https://geocode.testifysamples.com/api?q=Hinjewadi+Phase+1+Pune"`
* **Reverse Geocoding API**: `https://geocode.testifysamples.com/reverse?lon={lng}&lat={lat}`
  * *Example*: `curl "https://geocode.testifysamples.com/reverse?lon=73.8567&lat=18.5204"`

### B. Routing & ETA (OSRM)
Calculate path geometry, total distance, and duration (ETA) for delivery routing.

* **Route API**: `https://routing.testifysamples.com/route/v1/driving/{lng1},{lat1};{lng2},{lat2}`
  * *Example*: `curl "https://routing.testifysamples.com/route/v1/driving/73.7384,18.5912;73.8567,18.5204?overview=full&geometries=geojson"`

### C. Snap-to-Road Map Matching (OSRM)
Snap raw, noisy mobile GPS coordinate history to the actual road network grid.

* **Match API**: `https://routing.testifysamples.com/match/v1/driving/{lng1},{lat1};{lng2},{lat2};{lng3},{lat3}`
  * *Example*: `curl "https://routing.testifysamples.com/match/v1/driving/73.7380,18.5910;73.7385,18.5915;73.7390,18.5920?geometries=geojson"`

### D. Distance/Duration Matrix (OSRM)
Find the distance and time matrices between multiple delivery agents and multiple restaurant pickups. Ideal for finding the closest rider to assign.

* **Table API**: `https://routing.testifysamples.com/table/v1/driving/{rider1_lng},{rider1_lat};{rider2_lng},{rider2_lat};{pickup_lng},{pickup_lat}?sources=0;1&destinations=2`
  * *Example Request*:
    ```bash
    curl "https://routing.testifysamples.com/table/v1/driving/73.738,18.591;73.742,18.585;73.750,18.599?sources=0;1&destinations=2"
    ```
  * *Response*: Returns travel durations and distances from each rider (`0`, `1`) to the pickup point (`2`).

### E. Multi-Stop Route Optimization (OSRM)
Solves the Traveling Salesperson Problem (TSP) for batch deliveries. Optimizes the route sequence for a rider visiting multiple customer drop-offs.

* **Trip API**: `https://routing.testifysamples.com/trip/v1/driving/{pickup_lng},{pickup_lat};{drop1_lng},{drop1_lat};{drop2_lng},{drop2_lat}?source=first`
  * *Example*: `curl "https://routing.testifysamples.com/trip/v1/driving/73.738,18.591;73.745,18.588;73.752,18.595?source=first&geometries=geojson"`

### F. Nearest Point Snapping (OSRM)
Snaps a coordinate to the nearest road segment and returns the metadata (name of the street, node ID).

* **Nearest API**: `https://routing.testifysamples.com/nearest/v1/driving/{lng},{lat}`
  * *Example*: `curl "https://routing.testifysamples.com/nearest/v1/driving/73.738,18.591"`

---

## 3. Step-by-Step Implementation

### Step 1: Rider Mobile Tracking (React Native)
The rider's app polls coordinates and pushes updates to your server via WebSockets.

```typescript
import MapboxGL from '@maplibre/maplibre-react-native';
import { useEffect } from 'react';
import Geolocation from '@react-native-community/geolocation';

const WEBSOCKET_URL = "wss://your-backend-api.com/rider/live";

export function useRiderTracker(orderId: string, riderId: string) {
  useEffect(() => {
    const ws = new WebSocket(WEBSOCKET_URL);

    const watchId = Geolocation.watchPosition(
      (position) => {
        const { longitude, latitude, speed, heading } = position.coords;
        const payload = JSON.stringify({
          orderId,
          riderId,
          coords: [longitude, latitude],
          speed,
          heading,
          timestamp: Date.now()
        });
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      },
      (error) => console.log("GPS Error: ", error),
      { enableHighAccuracy: true, distanceFilter: 10 } // Update every 10 meters
    );

    return () => {
      Geolocation.clearWatch(watchId);
      ws.close();
    };
  }, [orderId, riderId]);
}
```

### Step 2: Backend Broker (Node.js + WebSockets)
The backend intercepts rider updates, filters them using OSRM Map Matching, and broadcasts to the customer's dashboard.

```javascript
const WebSocket = require('ws');
const axios = require('axios');

const wss = new WebSocket.Server({ port: 8000 });
const OSRM_URL = "https://routing.testifysamples.com";

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    const { orderId, coords, heading } = data;

    try {
      // 1. Get Snapped coordinates from OSRM Match API to remove GPS noise
      const matchRes = await axios.get(
        `${OSRM_URL}/match/v1/driving/${coords[0]},${coords[1]}?radius=25`
      );
      
      const snappedCoords = matchRes.data.matchings?.[0]?.geometry?.coordinates?.[0] || coords;

      // 2. Broadcast snapped location to customer socket pool
      broadcastToCustomers(orderId, {
        orderId,
        coords: snappedCoords,
        heading
      });
    } catch (err) {
      // Fallback to raw coords if OSRM match fails
      broadcastToCustomers(orderId, { orderId, coords, heading });
    }
  });
});
```

### Step 3: Next.js Live Map Dashboard (Customer View)
Renders a vector map styled from your self-hosted **TileServer GL**, with markers transitioning smoothly.

```tsx
import React, { useEffect, useRef, useState } from 'react';
import maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface DeliveryTrackerProps {
  restaurantCoords: [number, number]; // [lng, lat]
  customerCoords: [number, number];
}

export default function DeliveryTracker({ restaurantCoords, customerCoords }: DeliveryTrackerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibre.Map | null>(null);
  const riderMarkerRef = useRef<maplibre.Marker | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    // 1. Initialize self-hosted TileServer GL style
    const map = new maplibre.Map({
      container: mapContainer.current,
      style: "https://tiles.testifysamples.com/styles/basic-preview/style.json",
      center: restaurantCoords,
      zoom: 13
    });
    mapRef.current = map;

    map.on('load', async () => {
      // 2. Fetch routing path from OSRM
      const res = await fetch(
        `https://routing.testifysamples.com/route/v1/driving/${restaurantCoords.join(',')};${customerCoords.join(',')}?overview=full&geometries=geojson`
      );
      const routeData = await res.json();
      const routeCoordinates = routeData.routes[0].geometry.coordinates;

      // 3. Draw Route Line
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: routeCoordinates
          }
        }
      });

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#ff4d4f', // Red delivery path
          'line-width': 5,
          'line-opacity': 0.85
        }
      });

      // 4. Create markers for Restaurant & Customer
      new maplibre.Marker({ color: '#22c55e' }).setLngLat(restaurantCoords).addTo(map); // Green
      new maplibre.Marker({ color: '#3b82f6' }).setLngLat(customerCoords).addTo(map);   // Blue

      // 5. Create Rider Marker
      const riderEl = document.createElement('div');
      riderEl.className = 'rider-marker';
      riderEl.style.fontSize = '32px';
      riderEl.innerText = '🏍️'; // Custom rider icon

      const riderMarker = new maplibre.Marker({ element: riderEl })
        .setLngLat(restaurantCoords)
        .addTo(map);
      
      riderMarkerRef.current = riderMarker;
    });

    // 6. Connect to Live Location Broadcast WebSocket
    const ws = new WebSocket(`wss://your-backend-api.com/orders/track`);
    ws.onmessage = (event) => {
      const liveUpdate = JSON.parse(event.data);
      const { coords } = liveUpdate;
      
      // Update Rider Marker position dynamically on map
      if (riderMarkerRef.current) {
        riderMarkerRef.current.setLngLat(coords);
      }
    };

    return () => {
      ws.close();
      map.remove();
    };
  }, []);

  return <div ref={mapContainer} style={{ width: '100%', height: '500px', borderRadius: '12px' }} />;
}
```

---

## 4. Performance & Scale Optimizations

* **Cache Routing Queries**: Delivery routes don't change. Cache OSRM route paths in Redis based on `{restaurant_id}:{customer_hash}` to avoid querying the OSRM container repeatedly for every order update.
* **Throttle GPS Updates**: Send coordinates from the mobile app every 10–15 seconds or every 15 meters to minimize battery usage and reduce server compute overhead.
* **Geofence Check**: Use a simple distance check between the rider coordinate and restaurant/customer coordinates. If distance < 50 meters, trigger automatic status updates (e.g. "Rider reached restaurant" or "Order delivered").
