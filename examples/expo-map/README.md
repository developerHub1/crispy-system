# TetsifyMaps — Expo React Native Example

A full-featured Expo mobile app demonstrating the self-hosted TetsifyMaps geospatial stack with two main screens:

## Screens

### 🗺️ Route Planner
- Search locations via **Photon Geocoding**
- Tap the map to add stops
- Calculates optimized bike routes via **OSRM** (bicycle profile)
- Solves the Traveling Salesperson Problem (TSP) to reorder stops optimally
- Displays route polyline overlay on MapLibre GL

### 📍 Save Address
- Search or tap the map to select an address
- **Reverse geocoding** shows the address name for any tapped coordinate
- Choose a label: 🏠 Home, 💼 Work, ⭐ Favourite, 📍 Other
- Addresses are **persisted** locally using AsyncStorage
- Tap a saved address to fly to it on the map

## Setup

```bash
cd examples/expo-map
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone.

## Self-Hosted Endpoints Used

| Service | URL |
|---------|-----|
| Vector Tiles (TileServer GL) | `https://tiles.testifysamples.com` |
| Geocoding (Photon) | `https://geocode.testifysamples.com` |
| Routing (OSRM — bicycle) | `https://routing.testifysamples.com` |

## Dependencies

- `@maplibre/maplibre-react-native` — Native vector maps
- `@tetsifymaps/core` — SDK for geocoding, routing, and PDP optimization
- `@react-native-async-storage/async-storage` — Persistent address storage
- `expo-location` — GPS permissions and location tracking
