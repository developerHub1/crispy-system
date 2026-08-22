import React, { useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapMarker {
  id: string;
  coords: [number, number];
  color?: string;
  label?: string;
  icon?: string;
}

interface WebViewMapProps {
  style?: any;
  tileStyleUrl?: string;
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  routeGeoJson?: any;
  onPress?: (coords: [number, number]) => void;
}

const DEFAULT_TILE_STYLE = 'https://tiles.testifysamples.com/styles/basic-preview/style.json';

export default function WebViewMap({
  style,
  tileStyleUrl = DEFAULT_TILE_STYLE,
  center = [76.0, 19.0],
  zoom = 7,
  markers = [],
  routeGeoJson = null,
  onPress,
}: WebViewMapProps) {
  const webViewRef = useRef<WebView>(null);
  const isLoadedRef = useRef(false);

  // Static HTML template generated ONCE to avoid page reloads
  const htmlContent = useMemo(() => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0a0c10; }
    #map { width: 100%; height: 100%; }
    .custom-marker {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 16px; color: #fff;
      font-weight: bold; font-size: 13px; border: 2px solid #fff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.5);
      transition: transform 0.3s ease;
    }
    .custom-marker:hover {
      transform: scale(1.15);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = new maplibregl.Map({
      container: 'map',
      style: '${tileStyleUrl}',
      center: [76.0, 19.0],
      zoom: 7,
      pitchWithRotate: false
    });

    let currentMarkers = [];

    map.on('click', (e) => {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'mapPress',
          coords: [e.lngLat.lng, e.lngLat.lat]
        }));
      }
    });

    window.updateMapState = (data) => {
      if (data.center) {
        map.flyTo({
          center: data.center,
          zoom: data.zoom || map.getZoom(),
          duration: 1500,
          essential: true
        });
      }
      if (data.markers) {
        currentMarkers.forEach(m => m.remove());
        currentMarkers = [];
        data.markers.forEach(m => {
          const el = document.createElement('div');
          el.className = 'custom-marker';
          el.style.backgroundColor = m.color || '#6366f1';
          el.innerText = m.label || (m.icon || '');
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(m.coords)
            .addTo(map);
          currentMarkers.push(marker);
        });
      }
      if (data.routeGeoJson) {
        if (map.getSource('routeSource')) {
          map.getSource('routeSource').setData(data.routeGeoJson);
        } else {
          map.addSource('routeSource', { type: 'geojson', data: data.routeGeoJson });
          map.addLayer({
            id: 'routeLine',
            type: 'line',
            source: 'routeSource',
            paint: {
              'line-color': '#6366f1',
              'line-width': 5,
              'line-opacity': 0.85,
            }
          });
        }
      } else if (map.getSource('routeSource')) {
        map.getSource('routeSource').setData({ type: 'Feature', geometry: null, properties: {} });
      }
    };
  </script>
</body>
</html>
  `, [tileStyleUrl]);

  // Smoothly fly to center/zoom and update state without page reload
  useEffect(() => {
    if (!webViewRef.current) return;
    const payload = JSON.stringify({ center, zoom, markers, routeGeoJson });
    webViewRef.current.injectJavaScript(`
      if (window.updateMapState) {
        window.updateMapState(${payload});
      }
      true;
    `);
  }, [center, zoom, markers, routeGeoJson]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'mapPress' && onPress) {
        onPress(data.coords);
      }
    } catch { /* silent */ }
  };

  const handleLoadEnd = () => {
    isLoadedRef.current = true;
    if (webViewRef.current) {
      const payload = JSON.stringify({ center, zoom, markers, routeGeoJson });
      webViewRef.current.injectJavaScript(`
        if (window.updateMapState) {
          window.updateMapState(${payload});
        }
        true;
      `);
    }
  };

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        style={styles.webView}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0c10' },
  webView: { flex: 1, backgroundColor: '#0a0c10' },
});
