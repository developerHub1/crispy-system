import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, SafeAreaView, ScrollView, KeyboardAvoidingView, Platform, NativeModules
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { MapClient, formatAddress } from '@tetsifymaps/core';
import WebViewMap, { MapMarker } from '../components/WebViewMap';

const hasNativeMap = !!NativeModules.MLRNModule;

if (hasNativeMap && typeof MapLibreGL?.setAccessToken === 'function') {
  MapLibreGL.setAccessToken(null);
}

const TILE_STYLE = 'https://tiles.testifysamples.com/styles/basic-preview/style.json';
const GEOCODE_URL = 'https://geocode.testifysamples.com';
const STORAGE_KEY = '@tetsify_saved_addresses';

interface SavedAddress {
  id: string;
  label: string;
  name: string;
  coords: [number, number];
  icon: string;
}

const LABEL_OPTIONS = [
  { key: 'Home', icon: '🏠' },
  { key: 'Work', icon: '💼' },
  { key: 'Favourite', icon: '⭐' },
  { key: 'Other', icon: '📍' },
];

export default function SaveAddressScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [label, setLabel] = useState('Home');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  const [mapCenter, setMapCenter] = useState<[number, number]>([76.0, 19.0]);
  const [mapZoom, setMapZoom] = useState<number>(7);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const client = useRef(new MapClient({ geocodeUrl: GEOCODE_URL }));
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

  // Load saved addresses from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(data => {
      if (data) setSavedAddresses(JSON.parse(data));
    });
  }, []);

  // Persist on change
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedAddresses));
  }, [savedAddresses]);

  // Autocomplete
  useEffect(() => {
    if (query.length < 3) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        setResults(await client.current.searchLandmarks(query, undefined, 6));
      } catch { /* silent */ }
      finally { setIsSearching(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const selectFromSearch = (feature: any) => {
    const coords = feature.geometry.coordinates as [number, number];
    setSelectedCoords(coords);
    setSelectedName(formatAddress(feature.properties));
    setQuery(feature.properties.name || '');
    setResults([]);
    // Zoom into searched location
    setMapCenter(coords);
    setMapZoom(15);
    cameraRef.current?.setCamera({ centerCoordinate: coords, zoomLevel: 15, animationDuration: 800 });
  };

  // Tap map to drop pin
  const handleMapPress = async (event: any) => {
    const coords = event.geometry.coordinates as [number, number];
    setSelectedCoords(coords);
    try {
      const geo = await client.current.reverseGeocode(coords[0], coords[1]);
      if (geo?.properties) setSelectedName(formatAddress(geo.properties));
      else setSelectedName(`${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`);
    } catch {
      setSelectedName(`${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`);
    }
  };

  const saveAddress = () => {
    if (!selectedCoords) return;
    const iconMap: Record<string, string> = { Home: '🏠', Work: '💼', Favourite: '⭐', Other: '📍' };
    const addr: SavedAddress = {
      id: String(Date.now()),
      label,
      name: selectedName,
      coords: selectedCoords,
      icon: iconMap[label] || '📍',
    };
    setSavedAddresses(prev => [...prev, addr]);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
    setSelectedCoords(null);
    setSelectedName('');
    setQuery('');
    Alert.alert('✅ Saved', `${label} address saved successfully.`);
  };

  const deleteAddress = (id: string) => {
    Alert.alert('Delete Address', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setSavedAddresses(prev => prev.filter(a => a.id !== id)) },
    ]);
  };

  const flyTo = (coords: [number, number]) => {
    cameraRef.current?.setCamera({ centerCoordinate: coords, zoomLevel: 15, animationDuration: 800 });
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      {hasNativeMap ? (
        <MapLibreGL.MapView style={styles.map} mapStyle={TILE_STYLE} onPress={handleMapPress} logoEnabled={false}>
          <MapLibreGL.Camera ref={cameraRef} zoomLevel={mapZoom} centerCoordinate={mapCenter} />

          {/* Dropped pin */}
          {selectedCoords && (
            <MapLibreGL.PointAnnotation id="selectedPin" coordinate={selectedCoords}>
              <View style={styles.pinOuter}>
                <Text style={{ fontSize: 22 }}>📍</Text>
              </View>
            </MapLibreGL.PointAnnotation>
          )}

          {/* Saved address markers */}
          {savedAddresses.map(addr => (
            <MapLibreGL.PointAnnotation key={addr.id} id={addr.id} coordinate={addr.coords}>
              <View style={styles.savedMarker}>
                <Text style={{ fontSize: 16 }}>{addr.icon}</Text>
              </View>
            </MapLibreGL.PointAnnotation>
          ))}
        </MapLibreGL.MapView>
      ) : (
        <WebViewMap
          style={styles.map}
          tileStyleUrl={TILE_STYLE}
          center={mapCenter}
          zoom={mapZoom}
          markers={[
            ...(userLocation ? [{ id: 'userGps', coords: userLocation, color: '#3b82f6', label: '🎯' }] : []),
            ...(selectedCoords ? [{ id: 'selectedPin', coords: selectedCoords, icon: '📍' }] : []),
            ...savedAddresses.map(a => ({ id: a.id, coords: a.coords, icon: a.icon })),
          ]}
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

      {/* Floating hint */}
      <View style={styles.hintBadge}>
        <Text style={styles.hintText}>Tap map to drop a pin</Text>
      </View>

      {/* Bottom Sheet */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.panel}>
        <SafeAreaView>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
            {/* Search */}
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search address or landmark..."
                placeholderTextColor="#666"
                value={query}
                onChangeText={setQuery}
              />
              {isSearching && <ActivityIndicator size="small" color="#6366f1" style={{ position: 'absolute', right: 16, top: 14 }} />}
            </View>

            {results.length > 0 && (
              <View style={styles.resultsList}>
                {results.map((f, i) => (
                  <TouchableOpacity key={i} style={styles.resultItem} onPress={() => selectFromSearch(f)}>
                    <Text style={styles.resultName}>{f.properties.name || f.properties.street}</Text>
                    <Text style={styles.resultAddr}>{formatAddress(f.properties)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Confirm + Label selection */}
            {selectedCoords && (
              <View style={styles.confirmCard}>
                <View style={styles.addrPreview}>
                  <Text style={styles.addrPreviewIcon}>📍</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addrPreviewName} numberOfLines={2}>{selectedName}</Text>
                    <Text style={styles.addrPreviewCoords}>
                      {selectedCoords[1].toFixed(6)}, {selectedCoords[0].toFixed(6)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.labelTitle}>Save as</Text>
                <View style={styles.labelRow}>
                  {LABEL_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.labelChip, label === opt.key && styles.labelChipActive]}
                      onPress={() => setLabel(opt.key)}
                    >
                      <Text style={styles.labelChipIcon}>{opt.icon}</Text>
                      <Text style={[styles.labelChipText, label === opt.key && styles.labelChipTextActive]}>
                        {opt.key}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={styles.saveBtn} onPress={saveAddress}>
                  <Text style={styles.saveBtnText}>💾 Save {label} Address</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Saved addresses */}
            {savedAddresses.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.sectionTitle}>Saved Addresses ({savedAddresses.length})</Text>
                {savedAddresses.map(addr => (
                  <TouchableOpacity key={addr.id} style={styles.savedItem} onPress={() => flyTo(addr.coords)}>
                    <Text style={{ fontSize: 24 }}>{addr.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.savedLabel}>{addr.label}</Text>
                      <Text style={styles.savedName} numberOfLines={1}>{addr.name}</Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteAddress(addr.id)} style={styles.deleteBtn}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {savedAddresses.length === 0 && !selectedCoords && (
              <View style={styles.emptyState}>
                <Text style={{ fontSize: 40, marginBottom: 8 }}>📍</Text>
                <Text style={styles.emptyText}>No saved addresses yet</Text>
                <Text style={styles.emptySubtext}>Search above or tap the map to add one</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  pinOuter: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  savedMarker: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(15,22,36,0.9)',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff',
  },
  hintBadge: {
    position: 'absolute', top: 60, alignSelf: 'center',
    backgroundColor: 'rgba(15,22,36,0.85)', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  hintText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
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
  resultsList: { marginBottom: 8 },
  resultItem: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  resultName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  resultAddr: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  confirmCard: {
    backgroundColor: 'rgba(99,102,241,0.06)', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)', marginBottom: 8,
  },
  addrPreview: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  addrPreviewIcon: { fontSize: 20, marginTop: 2 },
  addrPreviewName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  addrPreviewCoords: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  labelTitle: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  labelRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  labelChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'transparent',
  },
  labelChipActive: { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.15)' },
  labelChipIcon: { fontSize: 14 },
  labelChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  labelChipTextActive: { color: '#818cf8' },
  saveBtn: {
    backgroundColor: '#6366f1', padding: 13, borderRadius: 10, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sectionTitle: { color: '#818cf8', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  savedItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8,
  },
  savedLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  savedName: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  deleteBtn: { padding: 6 },
  deleteBtnText: { color: '#f87171', fontSize: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
  emptySubtext: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  gpsFab: {
    position: 'absolute', top: 50, right: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.9)', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5, zIndex: 10,
  },
  gpsFabIcon: { fontSize: 20 },
});
