import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, TextInput, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, SafeAreaView, ScrollView, KeyboardAvoidingView, Platform, NativeModules
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { MapClient, formatAddress } from '@tetsifymaps/core';
import WebViewMap, { MapMarker } from '../components/WebViewMap';

const hasNativeMap = !!NativeModules.MLRNModule;

if (hasNativeMap && typeof MapLibreGL?.setAccessToken === 'function') {
  MapLibreGL.setAccessToken(null);
}

const TILE_STYLE = 'https://tiles.testifysamples.com/styles/basic-preview/style.json';
const GEOCODE_URL = 'https://geocode.testifysamples.com';
const ROUTING_URL = 'https://routing.testifysamples.com';

interface Stop {
  id: string;
  name: string;
  coords: [number, number];
}

export default function RoutePlannerScreen() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [routeGeoJson, setRouteGeoJson] = useState<any>(null);
  const [tripSummary, setTripSummary] = useState<{ distance: number; duration: number } | null>(null);

  const [mapCenter, setMapCenter] = useState<[number, number]>([76.0, 19.0]);
  const [mapZoom, setMapZoom] = useState<number>(7);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const client = useRef(new MapClient({ geocodeUrl: GEOCODE_URL, routingUrl: ROUTING_URL }));
  const cameraRef = useRef<any>(null);

  // Request GPS location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const coords: [number, number] = [loc.coords.longitude, loc.coords.latitude];
          setUserLocation(coords);
          setMapCenter(coords);
          setMapZoom(14);
          cameraRef.current?.setCamera({ centerCoordinate: coords, zoomLevel: 14, animationDuration: 1000 });
        }
      } catch (err) {
        console.warn('GPS location error:', err);
      }
    })();
  }, []);

  const locateUser = async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'GPS location permission is required.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords: [number, number] = [loc.coords.longitude, loc.coords.latitude];
      setUserLocation(coords);
      setMapCenter(coords);
      setMapZoom(15);
      cameraRef.current?.setCamera({ centerCoordinate: coords, zoomLevel: 15, animationDuration: 800 });
    } catch (e) {
      Alert.alert('Location Error', 'Failed to retrieve current GPS position.');
    } finally {
      setIsLocating(false);
    }
  };

  // Autocomplete search
  useEffect(() => {
    if (query.length < 3) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await client.current.searchLandmarks(query, undefined, 6);
        setResults(res);
      } catch { /* silent */ }
      finally { setIsSearching(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const addStop = (feature: any) => {
    if (stops.length >= 30) { Alert.alert('Limit', 'Max 30 stops.'); return; }
    const coords = feature.geometry.coordinates as [number, number];
    const name = formatAddress(feature.properties);
    setStops(prev => [...prev, { id: String(Date.now()), name, coords }]);
    setQuery('');
    setResults([]);
    // Center & Zoom in close to searched location!
    setMapCenter(coords);
    setMapZoom(15);
    cameraRef.current?.setCamera({ centerCoordinate: coords, zoomLevel: 15, animationDuration: 800 });
  };

  const removeStop = (id: string) => {
    setStops(prev => prev.filter(s => s.id !== id));
    if (stops.length <= 2) { setRouteGeoJson(null); setTripSummary(null); }
  };

  const handleMapPress = async (event: any) => {
    if (stops.length >= 30) return;
    const coords = event.geometry.coordinates as [number, number];
    let name = `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`;
    try {
      const geo = await client.current.reverseGeocode(coords[0], coords[1]);
      if (geo?.properties) name = formatAddress(geo.properties);
    } catch { /* use fallback */ }
    setStops(prev => [...prev, { id: String(Date.now()), name, coords }]);
  };

  const calculateRoute = async () => {
    if (stops.length < 2) { Alert.alert('Error', 'Add at least 2 stops.'); return; }
    setIsRouting(true);
    try {
      const result = await client.current.calculateMultiStopTrip(stops.map(s => s.coords), true);
      setRouteGeoJson({ type: 'Feature', geometry: result.geometry, properties: {} });
      setTripSummary({ distance: result.distance, duration: result.duration });

      // Reorder stops to optimized order
      if (result.visitOrder.length === stops.length) {
        setStops(result.visitOrder.map(i => stops[i]));
      }
    } catch (e: any) {
      Alert.alert('Routing Error', e.message || 'Failed to calculate route.');
    } finally { setIsRouting(false); }
  };

  const clearAll = () => {
    setStops([]); setRouteGeoJson(null); setTripSummary(null);
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      {hasNativeMap ? (
        <MapLibreGL.MapView style={styles.map} mapStyle={TILE_STYLE} onPress={handleMapPress} logoEnabled={false}>
          <MapLibreGL.Camera ref={cameraRef} zoomLevel={mapZoom} centerCoordinate={mapCenter} />

          {/* Stop markers */}
          {stops.map((stop, i) => (
            <MapLibreGL.PointAnnotation key={stop.id} id={stop.id} coordinate={stop.coords}>
              <View style={[styles.marker, i === 0 && styles.markerStart, i === stops.length - 1 && styles.markerEnd]}>
                <Text style={styles.markerText}>{i + 1}</Text>
              </View>
            </MapLibreGL.PointAnnotation>
          ))}

          {/* Route line */}
          {routeGeoJson && (
            <MapLibreGL.ShapeSource id="routeSource" shape={routeGeoJson}>
              <MapLibreGL.LineLayer id="routeLine" style={{
                lineColor: '#6366f1', lineWidth: 5, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.85
              }} />
            </MapLibreGL.ShapeSource>
          )}
        </MapLibreGL.MapView>
      ) : (
        <WebViewMap
          style={styles.map}
          tileStyleUrl={TILE_STYLE}
          center={mapCenter}
          zoom={mapZoom}
          markers={[
            ...(userLocation ? [{ id: 'userGps', coords: userLocation, color: '#3b82f6', label: '🎯' }] : []),
            ...stops.map((stop, i): MapMarker => ({
              id: stop.id,
              coords: stop.coords,
              color: i === 0 ? '#10b981' : (i === stops.length - 1 ? '#ef4444' : '#6366f1'),
              label: String(i + 1),
            }))
          ]}
          routeGeoJson={routeGeoJson}
          onPress={(coords) => handleMapPress({ geometry: { coordinates: coords } })}
        />
      )}

      {/* Floating GPS Button */}
      <TouchableOpacity style={styles.gpsFab} onPress={locateUser} activeOpacity={0.8}>
        {isLocating ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.gpsFabIcon}>🎯</Text>
        )}
      </TouchableOpacity>

      {/* Bottom Panel */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.panel}>
        <SafeAreaView>
          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search stop..."
              placeholderTextColor="#666"
              value={query}
              onChangeText={setQuery}
            />
            {isSearching && <ActivityIndicator size="small" color="#6366f1" style={{ position: 'absolute', right: 16 }} />}
          </View>

          {/* Search results */}
          {results.length > 0 && (
            <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
              {results.map((f, i) => (
                <TouchableOpacity key={i} style={styles.resultItem} onPress={() => addStop(f)}>
                  <Text style={styles.resultName}>{f.properties.name || f.properties.street}</Text>
                  <Text style={styles.resultAddr}>{formatAddress(f.properties)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Trip summary */}
          {tripSummary && (
            <View style={styles.summaryRow}>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{tripSummary.distance} km</Text>
                <Text style={styles.statLbl}>DISTANCE</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{tripSummary.duration} min</Text>
                <Text style={styles.statLbl}>DURATION</Text>
              </View>
            </View>
          )}

          {/* Stops count + actions */}
          <View style={styles.actionsRow}>
            <Text style={styles.stopsCount}>
              {stops.length === 0 ? 'Tap map or search to add stops' : `${stops.length} stop${stops.length > 1 ? 's' : ''}`}
            </Text>
            {stops.length > 0 && (
              <TouchableOpacity onPress={clearAll} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Calculate button */}
          {stops.length >= 2 && (
            <TouchableOpacity style={styles.calcBtn} onPress={calculateRoute} disabled={isRouting}>
              {isRouting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.calcBtnText}>🚴 Calculate Bike Route ({stops.length} stops)</Text>
              }
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  marker: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#6366f1',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff',
  },
  markerStart: { backgroundColor: '#10b981' },
  markerEnd: { backgroundColor: '#ef4444' },
  markerText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(10,12,16,0.95)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  searchRow: { position: 'relative', marginBottom: 8 },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  resultsList: { maxHeight: 160, marginBottom: 8 },
  resultItem: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  resultName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  resultAddr: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  summaryRow: {
    flexDirection: 'row', gap: 10, marginBottom: 10,
  },
  statBox: {
    flex: 1, backgroundColor: 'rgba(99,102,241,0.1)', borderRadius: 10, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)',
  },
  statVal: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLbl: { color: '#9ca3af', fontSize: 10, fontWeight: '600', marginTop: 2 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  stopsCount: { color: '#9ca3af', fontSize: 13 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 8 },
  clearBtnText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  calcBtn: {
    backgroundColor: '#6366f1', padding: 14, borderRadius: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
  },
  calcBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  gpsFab: {
    position: 'absolute', top: 50, right: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.9)', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5, zIndex: 10,
  },
  gpsFabIcon: { fontSize: 20 },
});
