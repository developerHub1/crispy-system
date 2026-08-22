import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Alert,
  SafeAreaView,
} from "react-native";
import MapLibreGL from "@maplibre/maplibre-react-native";
import { MapClient, TripResult } from "@tetsifymaps/core";

// Initialize MapLibre React Native
// Since we are self-hosting, we don't need a Mapbox API token
MapLibreGL.setAccessToken(null);

const TILE_STYLE_URL = "https://tiles.testifysamples.com/styles/basic-preview/style.json";
const ROUTING_URL = "https://routing.testifysamples.com";
const GEOCODING_URL = "https://geocode.testifysamples.com";

interface LocationObject {
  coords: {
    longitude: number;
    latitude: number;
  };
}

export default function MapScreen() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [styleUrl] = useState(TILE_STYLE_URL);
  
  // Geolocation States
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [homeLocation, setHomeLocation] = useState<[number, number] | null>(null);
  
  // Route planning states
  const [stops, setStops] = useState<[number, number][]>([]);
  const [routeGeojson, setRouteGeojson] = useState<any>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [tripSummary, setTripSummary] = useState<{ distance: number; duration: number } | null>(null);

  // SDK client ref
  const sdkClientRef = useRef(
    new MapClient({ geocodeUrl: GEOCODING_URL, routingUrl: ROUTING_URL })
  );
  const cameraRef = useRef<MapLibreGL.Camera>(null);

  // Request Permissions on Mount (Android & iOS)
  useEffect(() => {
    async function requestLocationPermission() {
      if (Platform.OS === "android") {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: "TetsifyMaps GPS Permission",
              message: "We need access to your location to route from your coordinates.",
              buttonNeutral: "Ask Me Later",
              buttonNegative: "Cancel",
              buttonPositive: "OK",
            }
          );
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            setPermissionGranted(true);
          } else {
            Alert.alert("Permission Denied", "GPS location features will be disabled.");
          }
        } catch (err) {
          console.warn(err);
        }
      } else {
        // iOS permissions are handled in Info.plist via the system prompt when map mounts
        setPermissionGranted(true);
      }
    }
    requestLocationPermission();
  }, []);

  // Update user coordinates on location change
  const handleUserLocationUpdate = (location: LocationObject) => {
    if (location && location.coords) {
      const { longitude, latitude } = location.coords;
      setUserLocation([longitude, latitude]);
    }
  };

  // Center Camera on current user position
  const centerOnUser = () => {
    if (userLocation && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: userLocation,
        zoomLevel: 14,
        animationDuration: 1000,
      });
    } else {
      Alert.alert("Location Error", "Determining GPS coordinates. Please wait...");
    }
  };

  // Handle map long press to drop / relocate the "Home Location" pin
  const handleMapLongPress = (event: any) => {
    const coords = event.geometry.coordinates; // [lng, lat]
    setHomeLocation(coords);
    
    // Clear old route when starting node changes
    setRouteGeojson(null);
    setTripSummary(null);
    
    Alert.alert("Home Location Saved", `Dropped pin at: ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`);
  };

  // Add random stop near current location for routing demonstration
  const addDemoStop = () => {
    const base = homeLocation || userLocation || [73.8567, 18.5204]; // Default Pune if no center
    
    // Offset stop slightly to simulate a destination (approx 500m - 2km)
    const randomOffsetLng = (Math.random() - 0.5) * 0.02;
    const randomOffsetLat = (Math.random() - 0.5) * 0.02;
    
    const newStop: [number, number] = [
      base[0] + randomOffsetLng,
      base[1] + randomOffsetLat
    ];

    if (stops.length >= 29) {
      Alert.alert("Error", "Maximum of 30 stops reached.");
      return;
    }

    setStops(prev => [...prev, newStop]);
    setRouteGeojson(null);
    setTripSummary(null);
  };

  // Reset route stops
  const clearMap = () => {
    setStops([]);
    setHomeLocation(null);
    setRouteGeojson(null);
    setTripSummary(null);
  };

  // Calculate Route from Home/User -> stops
  const calculateRoute = async () => {
    const startPoint = homeLocation || userLocation;
    
    if (!startPoint) {
      Alert.alert("Error", "Please drop a home pin (long press map) or enable GPS location first.");
      return;
    }
    
    if (stops.length === 0) {
      Alert.alert("Error", "Please add at least one stop to calculate a route.");
      return;
    }

    setIsRouting(true);
    
    try {
      const client = sdkClientRef.current;
      const allPoints: [number, number][] = [startPoint, ...stops];
      
      // Calculate optimized Traveling Salesperson route using core module
      const result = await client.calculateMultiStopTrip(allPoints, true);
      
      setRouteGeojson(result.geometry);
      setTripSummary({
        distance: result.distance,
        duration: result.duration
      });

      // Fit map view to show full route polyline
      if (cameraRef.current) {
        cameraRef.current.fitBounds(
          allPoints[0], // Start coordinate
          stops[stops.length - 1], // Last coordinate
          50, // padding
          1000 // duration ms
        );
      }
    } catch (err: any) {
      console.error(err);
      Alert.alert("Routing Error", err.message || "Failed to calculate route. Ensure containers are running.");
    } finally {
      setIsRouting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Main Map View */}
        <MapLibreGL.MapView
          style={styles.map}
          styleURL={styleUrl}
          onLongPress={handleMapLongPress}
          logoEnabled={false}
          attributionEnabled={false}
        >
          {/* Camera Management */}
          <MapLibreGL.Camera
            ref={cameraRef}
            zoomLevel={12}
            centerCoordinate={[73.8567, 18.5204]} // Default center: Pune
          />

          {/* User GPS Location tracking */}
          {permissionGranted && (
            <MapLibreGL.UserLocation
              visible={true}
              onUpdate={handleUserLocationUpdate}
            />
          )}

          {/* Home Location Marker (Dropped Pin) */}
          {homeLocation && (
            <MapLibreGL.PointAnnotation id="homeMarker" coordinate={homeLocation}>
              <View style={styles.homePin}>
                <Text style={styles.pinText}>🏠</Text>
              </View>
            </MapLibreGL.PointAnnotation>
          )}

          {/* Intermediate stops markers */}
          {stops.map((stop, index) => (
            <MapLibreGL.PointAnnotation
              key={index}
              id={`stop-${index}`}
              coordinate={stop}
            >
              <View style={styles.stopPin}>
                <Text style={styles.stopText}>{index + 1}</Text>
              </View>
            </MapLibreGL.PointAnnotation>
          ))}

          {/* Route Overlay Line */}
          {routeGeojson && (
            <MapLibreGL.ShapeSource id="routeSource" shape={routeGeojson}>
              <MapLibreGL.LineLayer
                id="routeLine"
                style={{
                  lineColor: "#6366f1",
                  lineWidth: 6,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: 0.85
                }}
              />
            </MapLibreGL.ShapeSource>
          )}
        </MapLibreGL.MapView>

        {/* Floating Headers & HUD */}
        <View style={styles.headerHud}>
          <Text style={styles.titleText}>TetsifyMaps Mobile</Text>
          <Text style={styles.subText}>Long press map to drop Home Location pin</Text>
        </View>

        {/* Trip Summary Stats */}
        {tripSummary && (
          <View style={styles.summaryCard}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{tripSummary.distance} km</Text>
              <Text style={styles.statLbl}>Distance</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{tripSummary.duration} min</Text>
              <Text style={styles.statLbl}>Duration</Text>
            </View>
          </View>
        )}

        {/* Floating Side Action Controls */}
        <View style={styles.sideControls}>
          <TouchableOpacity style={styles.iconBtn} onPress={centerOnUser}>
            <Text style={styles.btnIcon}>🎯</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={addDemoStop}>
            <Text style={styles.btnIcon}>➕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, styles.dangerBtn]} onPress={clearMap}>
            <Text style={styles.btnIcon}>🧹</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Calculate Button */}
        {stops.length > 0 && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={calculateRoute}
              disabled={isRouting}
            >
              {isRouting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.actionBtnText}>
                  Calculate Optimal Route ({stops.length + 1} Points)
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0a0c10",
  },
  container: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  headerHud: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: "rgba(15, 22, 36, 0.85)",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  titleText: {
    color: "#f3f4f6",
    fontSize: 18,
    fontWeight: "bold",
  },
  subText: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 4,
  },
  homePin: {
    width: 32,
    height: 32,
    backgroundColor: "#10b981",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "white",
  },
  pinText: {
    fontSize: 16,
  },
  stopPin: {
    width: 28,
    height: 28,
    backgroundColor: "#6366f1",
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "white",
  },
  stopText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  sideControls: {
    position: "absolute",
    right: 20,
    top: 150,
    gap: 12,
  },
  iconBtn: {
    width: 48,
    height: 48,
    backgroundColor: "rgba(15, 22, 36, 0.85)",
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  dangerBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  btnIcon: {
    fontSize: 20,
  },
  bottomBar: {
    position: "absolute",
    bottom: 24,
    left: 20,
    right: 20,
  },
  actionBtn: {
    backgroundColor: "#6366f1",
    padding: 16,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  actionBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  summaryCard: {
    position: "absolute",
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: "rgba(15, 22, 36, 0.9)",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-around",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.3)",
  },
  statBox: {
    alignItems: "center",
  },
  statVal: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  statLbl: {
    color: "#9ca3af",
    fontSize: 11,
    marginTop: 4,
    textTransform: "uppercase",
  },
});
