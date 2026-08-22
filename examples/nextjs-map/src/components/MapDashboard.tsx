"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapClient, PhotonFeature, TripResult, formatAddress } from "@tetsifymaps/core";

interface MapStop {
  id: string;
  name: string;
  coords: [number, number];
}

interface SavedAddress {
  id: string;
  label: string;
  name: string;
  coords: [number, number];
  icon: string;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tiles.testifysamples.com/styles/basic-preview/style.json";
const GEOCODE_URL = process.env.NEXT_PUBLIC_GEOCODE_URL || "/api/geocode";
const ROUTING_URL = process.env.NEXT_PUBLIC_ROUTING_URL || "https://routing.testifysamples.com";

export default function MapDashboard() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"route" | "address">("route");

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const markersRef = useRef<any[]>([]);
  const pinMarkerRef = useRef<any>(null);

  // SDK client
  const sdkClientRef = useRef<MapClient>(new MapClient({ geocodeUrl: GEOCODE_URL, routingUrl: ROUTING_URL }));

  // ── Route Planner state ──
  const [stops, setStops] = useState<MapStop[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [optimizeRoute, setOptimizeRoute] = useState(false);
  const [tripResult, setTripResult] = useState<TripResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const [webglError, setWebglError] = useState<string | null>(null);

  // ── Save Address state ──
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<PhotonFeature[]>([]);
  const [isAddrSearching, setIsAddrSearching] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(null);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addrLabel, setAddrLabel] = useState("Home");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const flyToCoords = (coords: [number, number], zoom = 15) => {
    if (mapRef.current) {
      try {
        mapRef.current.flyTo({ center: coords, zoom, duration: 1800, speed: 1.2, essential: true });
      } catch {}
    }
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "flyTo", center: coords, zoom }, "*");
    }
  };

  // Check geocoding connection
  const checkConnections = useCallback(async () => {
    setConnectionStatus("checking");
    try {
      await sdkClientRef.current.searchLandmarks("test", undefined, 1);
      setConnectionStatus("connected");
    } catch {
      setConnectionStatus("disconnected");
    }
  }, []);

  useEffect(() => { checkConnections(); }, [checkConnections]);

  // Helper to test WebGL2 support before MapLibre initialization
  const checkWebGLSupport = (): boolean => {
    if (typeof window === "undefined") return false;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("experimental-webgl2");
      return !!gl;
    } catch {
      return false;
    }
  };

  // Listen for 2D Leaflet iframe map click events
  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      if (e.data?.type === "mapClick") {
        const { lng, lat } = e.data;
        const client = sdkClientRef.current;
        if (activeTabRef.current === "address") {
          setSelectedCoords([lng, lat]);
          try {
            const geo = await client.reverseGeocode(lng, lat);
            if (geo?.properties) setSelectedAddress(formatAddress(geo.properties));
            else setSelectedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          } catch {
            setSelectedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          }
        } else {
          try {
            const geo = await client.reverseGeocode(lng, lat);
            const name = geo?.properties ? formatAddress(geo.properties) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            setStops(prev => prev.length >= 30 ? prev : [...prev, { id: crypto.randomUUID(), name, coords: [lng, lat] }]);
          } catch {
            setStops(prev => [...prev, { id: crypto.randomUUID(), name: `Stop (${lng.toFixed(4)}, ${lat.toFixed(4)})`, coords: [lng, lat] }]);
          }
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Update Leaflet iframe markers
  useEffect(() => {
    if (!webglError || !iframeRef.current?.contentWindow) return;
    const mapMarkers: Array<{ coords: [number, number]; label?: string; icon?: string }> = [];
    if (activeTab === "address") {
      if (selectedCoords) mapMarkers.push({ coords: selectedCoords, icon: "📍" });
      savedAddresses.forEach(a => mapMarkers.push({ coords: a.coords, icon: a.icon }));
    } else {
      stops.forEach((s, i) => mapMarkers.push({ coords: s.coords, label: String(i + 1) }));
    }
    iframeRef.current.contentWindow.postMessage({ type: "setMarkers", markers: mapMarkers }, "*");
  }, [stops, selectedCoords, savedAddresses, activeTab, webglError]);

  // Update Leaflet iframe route line
  useEffect(() => {
    if (!webglError || !iframeRef.current?.contentWindow) return;
    if (tripResult?.geometry?.coordinates) {
      iframeRef.current.contentWindow.postMessage({ type: "setRoute", routeCoords: tripResult.geometry.coordinates }, "*");
    } else {
      iframeRef.current.contentWindow.postMessage({ type: "setRoute", routeCoords: null }, "*");
    }
  }, [tripResult, webglError]);

  // ── Map init ──
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let maplibre: any;

    const initMap = async () => {
      if (!checkWebGLSupport()) {
        console.warn("WebGL2 is not supported in this environment. Enabling 2D map fallback.");
        setWebglError("2D Fallback Active");
        return;
      }

      try {
        maplibre = await import("maplibre-gl");

        if (typeof maplibre.isSupported === "function" && !maplibre.isSupported()) {
          console.warn("MapLibre GL is not supported in this browser environment.");
          setWebglError("2D Fallback Active");
          return;
        }

        if (mapRef.current) {
          try { mapRef.current.remove(); } catch {}
          mapRef.current = null;
        }

        const map = new maplibre.Map({
          container: mapContainerRef.current!,
          style: TILE_URL,
          center: [76.0, 19.0],
          zoom: 7,
        });

        map.on("error", (e: any) => {
          if (e?.error?.message?.includes("WebGL") || e?.error?.name === "GPUInitializationError") {
            setWebglError("2D Fallback Active");
          }
        });

        map.addControl(new maplibre.NavigationControl(), "top-right");

        // Click → add stop (route tab) or drop pin (address tab)
        map.on("click", async (e: any) => {
          const { lng, lat } = e.lngLat;
          const client = sdkClientRef.current;

          if (activeTabRef.current === "address") {
            setSelectedCoords([lng, lat]);
            try {
              const geo = await client.reverseGeocode(lng, lat);
              if (geo?.properties) setSelectedAddress(formatAddress(geo.properties));
              else setSelectedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
            } catch {
              setSelectedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
            }
            // Move pin marker
            if (pinMarkerRef.current) pinMarkerRef.current.setLngLat([lng, lat]);
            else if (mapRef.current) {
              const el = document.createElement("div");
              el.style.cssText = "font-size:32px;cursor:pointer;";
              el.textContent = "📍";
              pinMarkerRef.current = new maplibre.Marker({ element: el }).setLngLat([lng, lat]).addTo(mapRef.current);
            }
          } else {
            try {
              const geo = await client.reverseGeocode(lng, lat);
              const name = geo?.properties ? formatAddress(geo.properties) : `${lat.toFixed(4)}, ${lat.toFixed(4)}`;
              setStops(prev => prev.length >= 30 ? prev : [...prev, { id: crypto.randomUUID(), name, coords: [lng, lat] }]);
            } catch {
              setStops(prev => [...prev, { id: crypto.randomUUID(), name: `Stop (${lng.toFixed(4)}, ${lat.toFixed(4)})`, coords: [lng, lat] }]);
            }
          }
        });
        mapRef.current = map;
        setWebglError(null);
      } catch (err: any) {
        console.warn("Map initialization error:", err);
        setWebglError("2D Fallback Active");
      }
    };
    initMap();
    return () => {
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TILE_URL]);

  // Track active tab in ref so map click handler can access latest value
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // ── Stop markers ──
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach(m => { try { m.remove(); } catch {} });
    markersRef.current = [];
    import("maplibre-gl").then(maplibre => {
      if (!mapRef.current) return;
      const validStops = stops.filter(s => s && s.coords && Array.isArray(s.coords) && s.coords.length >= 2);
      validStops.forEach((stop, i) => {
        const el = document.createElement("div");
        el.className = `custom-marker ${i === 0 ? "custom-marker-first" : i === validStops.length - 1 ? "custom-marker-last" : ""}`;
        el.innerHTML = `<div class="custom-marker-inner">${i + 1}</div>`;
        const popup = new maplibre.Popup({ offset: 25 }).setHTML(
          `<div style="color:black;font-family:sans-serif;font-size:13px"><strong>Stop #${i + 1}</strong><br/>${stop.name || "Stop"}</div>`
        );
        markersRef.current.push(new maplibre.Marker({ element: el }).setLngLat(stop.coords).setPopup(popup).addTo(mapRef.current));
      });
      if (validStops.length > 0 && mapRef.current) {
        try {
          const bounds = new maplibre.LngLatBounds(validStops[0].coords, validStops[0].coords);
          validStops.forEach(s => bounds.extend(s.coords));
          mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15 });
        } catch {}
      }
    });
  }, [stops]);

  // ── Route search autocomplete ──
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        let center: [number, number] | undefined = undefined;
        if (mapRef.current) {
          try {
            const c = mapRef.current.getCenter();
            if (c) center = [c.lng, c.lat];
          } catch {}
        }
        setSearchResults(await sdkClientRef.current.searchLandmarks(searchQuery, center, 7));
      } catch { /* silent */ } finally { setIsSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Address search autocomplete ──
  useEffect(() => {
    if (!addrQuery.trim() || addrQuery.length < 3) { setAddrResults([]); return; }
    const t = setTimeout(async () => {
      setIsAddrSearching(true);
      try {
        setAddrResults(await sdkClientRef.current.searchLandmarks(addrQuery, undefined, 6));
      } catch { /* silent */ } finally { setIsAddrSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [addrQuery]);

  // ── Handlers ──
  const addStopFromSearch = (feature: PhotonFeature) => {
    if (!feature?.geometry?.coordinates || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) return;
    const coords = feature.geometry.coordinates as [number, number];
    setStops(prev => [...prev, { id: crypto.randomUUID(), name: formatAddress(feature.properties), coords }]);
    setSearchQuery(""); setSearchResults([]);
    flyToCoords(coords, 15);
  };

  const selectAddrFromSearch = (feature: PhotonFeature) => {
    if (!feature?.geometry?.coordinates || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) return;
    const coords = feature.geometry.coordinates as [number, number];
    setSelectedCoords(coords);
    setSelectedAddress(formatAddress(feature.properties));
    setAddrQuery(feature.properties?.name || "");
    setAddrResults([]);
    flyToCoords(coords, 15);
    // Place pin marker
    import("maplibre-gl").then(maplibre => {
      if (!mapRef.current) return;
      if (pinMarkerRef.current) pinMarkerRef.current.setLngLat(coords);
      else {
        const el = document.createElement("div");
        el.style.cssText = "font-size:32px;cursor:pointer;";
        el.textContent = "📍";
        pinMarkerRef.current = new maplibre.Marker({ element: el }).setLngLat(coords).addTo(mapRef.current);
      }
    });
  };

  const saveAddress = () => {
    if (!selectedCoords) return;
    const icons: Record<string, string> = { Home: "🏠", Work: "💼", "Favourite Place": "⭐", Other: "📍" };
    const newAddr: SavedAddress = {
      id: crypto.randomUUID(),
      label: addrLabel,
      name: selectedAddress,
      coords: selectedCoords,
      icon: icons[addrLabel] || "📍"
    };
    setSavedAddresses(prev => [...prev, newAddr]);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
    setAddrQuery(""); setSelectedCoords(null); setSelectedAddress("");
    if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
  };

  const removeAddress = (id: string) => setSavedAddresses(prev => prev.filter(a => a.id !== id));

  const calculateRoute = async () => {
    const validStops = stops.filter(s => s && s.coords && Array.isArray(s.coords) && s.coords.length >= 2);
    if (validStops.length < 2) { setErrorMsg("Add at least 2 stops."); return; }
    setIsRouting(true); setErrorMsg(null);
    try {
      const result = await sdkClientRef.current.calculateMultiStopTrip(validStops.map(s => s.coords), optimizeRoute);
      setTripResult(result);
      const map = mapRef.current;
      if (map) {
        if (map.getSource("route")) map.getSource("route").setData(result.geometry);
        else {
          map.addSource("route", { type: "geojson", data: result.geometry });
          map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#6366f1", "line-width": 6, "line-opacity": 0.85 } });
        }
        if (result.geometry?.coordinates && Array.isArray(result.geometry.coordinates) && result.geometry.coordinates.length > 0) {
          const bounds = (await import("maplibre-gl")).LngLatBounds;
          const firstCoord = result.geometry.coordinates[0];
          if (firstCoord && Array.isArray(firstCoord) && firstCoord.length >= 2) {
            const b = new bounds(firstCoord as any, firstCoord as any);
            (result.geometry.coordinates as any[]).forEach(c => {
              if (c && Array.isArray(c) && c.length >= 2) b.extend(c as [number, number]);
            });
            map.fitBounds(b as any, { padding: 80, maxZoom: 16 });
          }
        }
        if (optimizeRoute && result.visitOrder && result.visitOrder.length === stops.length) setStops(result.visitOrder.map(i => stops[i]));
      }
    } catch (e: any) { setErrorMsg(e.message); }
    finally { setIsRouting(false); }
  };

  const clearAllStops = () => {
    setStops([]); setTripResult(null); setErrorMsg(null);
    if (mapRef.current) {
      if (mapRef.current.getLayer("route")) mapRef.current.removeLayer("route");
      if (mapRef.current.getSource("route")) mapRef.current.removeSource("route");
    }
  };

  const locateUser = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      const { longitude: lng, latitude: lat } = pos.coords;
      flyToCoords([lng, lat], 15);
      try {
        const geo = await sdkClientRef.current.reverseGeocode(lng, lat);
        const name = geo?.properties ? formatAddress(geo.properties) : `${lat.toFixed(4)}, ${lat.toFixed(4)}`;
        setStops(prev => [{ id: "current-loc", name, coords: [lng, lat] }, ...prev.filter(s => s.id !== "current-loc")]);
      } catch {
        setStops(prev => [{ id: "current-loc", name: `My Location`, coords: [lng, lat] }, ...prev.filter(s => s.id !== "current-loc")]);
      }
    });
  };

  // Auto GPS positioning on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(pos => {
        const { longitude: lng, latitude: lat } = pos.coords;
        flyToCoords([lng, lat], 14);
      }, () => {}, { timeout: 5000 });
    }
  }, []);

  const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0a0c10; }
    #map { width: 100%; height: 100%; }
    .custom-marker {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 14px; color: #fff;
      font-weight: bold; font-size: 12px; background: #6366f1; border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([19.0, 76.0], 7);
    L.tileLayer('https://tiles.testifysamples.com/styles/basic-preview/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© TetsifyMaps'
    }).addTo(map);

    let markers = [];
    let polyline = null;

    map.on('click', (e) => {
      window.parent.postMessage({ type: 'mapClick', lng: e.latlng.lng, lat: e.latlng.lat }, '*');
    });

    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'flyTo' && data.center) {
        map.flyTo([data.center[1], data.center[0]], data.zoom || 15, { duration: 1.5 });
      }
      if (data.type === 'setMarkers' && data.markers) {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        data.markers.forEach(m => {
          const icon = L.divIcon({
            className: 'custom-marker',
            html: '<span>' + (m.label || m.icon || '📍') + '</span>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });
          const marker = L.marker([m.coords[1], m.coords[0]], { icon }).addTo(map);
          markers.push(marker);
        });
      }
      if (data.type === 'setRoute' && data.routeCoords) {
        if (polyline) map.removeLayer(polyline);
        polyline = L.polyline(data.routeCoords.map(c => [c[1], c[0]]), { color: '#6366f1', weight: 5, opacity: 0.85 }).addTo(map);
      }
    });
  </script>
</body>
</html>
  `;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <h1><span style={{ color: "#818cf8" }}>Tetsify</span>Maps</h1>
          <p>Production Self-Hosted Mapping Dashboard</p>
        </div>

        {/* Tab Switch */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {(["route", "address"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: "12px 0", background: "transparent", border: "none",
                borderBottom: activeTab === tab ? "2px solid #6366f1" : "2px solid transparent",
                color: activeTab === tab ? "#818cf8" : "#9ca3af",
                fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600,
                cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em",
                transition: "all 0.2s"
              }}
            >
              {tab === "route" ? "🗺️ Route Planner" : "📍 Save Address"}
            </button>
          ))}
        </div>

        <div className="sidebar-content">
          {/* ── CONNECTION STATUS ── */}
          <div className="card" style={{ padding: "10px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem" }}>
              <span className={`badge-dot ${connectionStatus !== "connected" ? "badge-dot-offline" : ""}`} />
              <span style={{ color: connectionStatus === "connected" ? "#10b981" : "#f87171" }}>
                {connectionStatus === "checking" ? "Connecting..." : connectionStatus === "connected" ? "Stack Online ✓" : "Offline – check containers"}
              </span>
            </div>
          </div>

          {/* ══════════════ ROUTE PLANNER TAB ══════════════ */}
          {activeTab === "route" && <>
            {/* Search */}
            <div className="card">
              <div className="card-title">Search & Add Waypoints</div>
              <div className="input-group">
                <div className="input-wrapper">
                  <input type="text" placeholder="Search address, landmark..." value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)} className="input-field" />
                  {searchQuery && <button onClick={() => setSearchQuery("")} className="clear-btn">×</button>}
                </div>
                {isSearching && <div style={{ fontSize: "0.75rem", color: "#9ca3af", padding: "4px 2px" }}>Searching…</div>}
                {searchResults.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {searchResults.map((f, i) => (
                      <div key={i} className="autocomplete-item" onClick={() => addStopFromSearch(f)}>
                        <span className="autocomplete-item-name">{f.properties.name || f.properties.street}</span>
                        <span className="autocomplete-item-address">{formatAddress(f.properties)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={locateUser} className="btn btn-secondary btn-block">📍 Locate Me</button>
            </div>

            {/* Stops */}
            <div className="card">
              <div className="card-title">Trip Stops ({stops.length}/30)
                {stops.length > 0 && <button onClick={clearAllStops} className="btn btn-danger btn-sm">Clear All</button>}
              </div>
              {stops.length === 0
                ? <div style={{ textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", padding: "16px 0" }}>No stops yet. Search above or click the map.</div>
                : <div className="stops-list">
                  {stops.map((s, i) => (
                    <div key={s.id} className={`stop-item ${i === 0 ? "stop-item-first" : i === stops.length - 1 ? "stop-item-last" : ""}`}>
                      <div className="stop-number">{i + 1}</div>
                      <div className="stop-info">
                        <div className="stop-name">{s.name}</div>
                        <div className="stop-coords">{s.coords && Array.isArray(s.coords) && s.coords.length >= 2 ? `${s.coords[0].toFixed(5)}, ${s.coords[1].toFixed(5)}` : ""}</div>
                      </div>
                      <button onClick={() => setStops(prev => prev.filter(x => x.id !== s.id))} className="remove-stop-btn">✕</button>
                    </div>
                  ))}
                </div>
              }
            </div>

            {/* Optimize + Calculate */}
            {stops.length >= 2 && (
              <div className="card">
                <div className="card-title">Route Optimization</div>
                <div className="switch-group">
                  <div className="switch-label">
                    <span className="switch-label-title">Optimize Stop Order (TSP)</span>
                    <span className="switch-label-desc">Solve Traveling Salesperson Problem</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={optimizeRoute} onChange={e => setOptimizeRoute(e.target.checked)} />
                    <span className="slider" />
                  </label>
                </div>
                <button onClick={calculateRoute} disabled={isRouting} className="btn btn-primary btn-block">
                  {isRouting ? <><span className="spinner" /> Calculating…</> : <><span>🚴</span> Calculate Bike Route</>}
                </button>
              </div>
            )}

            {/* Trip summary */}
            {tripResult && (
              <div className="card" style={{ border: "1px solid rgba(99,102,241,0.3)", background: "linear-gradient(135deg,rgba(99,102,241,0.05),rgba(168,85,247,0.03))" }}>
                <div className="card-title">Trip Summary</div>
                <div className="stats-grid">
                  <div className="stat-box"><div className="stat-val">{tripResult.distance}</div><div className="stat-lbl">Distance (km)</div></div>
                  <div className="stat-box"><div className="stat-val">{tripResult.duration}</div><div className="stat-lbl">Duration (min)</div></div>
                </div>
              </div>
            )}

            {errorMsg && <div style={{ padding: "12px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", color: "#f87171", fontSize: "0.85rem" }}>{errorMsg}</div>}
          </>}

          {/* ══════════════ SAVE ADDRESS TAB ══════════════ */}
          {activeTab === "address" && <>
            {/* Search address */}
            <div className="card">
              <div className="card-title">Search or Tap Map</div>
              <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginTop: "-4px" }}>
                Search for a place or tap anywhere on the map to drop a pin.
              </p>
              <div className="input-group">
                <div className="input-wrapper">
                  <input type="text" placeholder="Search address, colony, landmark..." value={addrQuery}
                    onChange={e => setAddrQuery(e.target.value)} className="input-field" />
                  {addrQuery && <button onClick={() => { setAddrQuery(""); setAddrResults([]); }} className="clear-btn">×</button>}
                </div>
                {isAddrSearching && <div style={{ fontSize: "0.75rem", color: "#9ca3af", padding: "4px 2px" }}>Searching…</div>}
                {addrResults.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {addrResults.map((f, i) => (
                      <div key={i} className="autocomplete-item" onClick={() => selectAddrFromSearch(f)}>
                        <span className="autocomplete-item-name">{f.properties.name || f.properties.street}</span>
                        <span className="autocomplete-item-address">{formatAddress(f.properties)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Selected address preview + label + save */}
            {selectedCoords && Array.isArray(selectedCoords) && selectedCoords.length >= 2 && (
              <div className="card" style={{ border: "1px solid rgba(99,102,241,0.25)" }}>
                <div className="card-title">Confirm Address</div>
                <div style={{ background: "rgba(99,102,241,0.08)", borderRadius: "8px", padding: "12px", fontSize: "0.85rem" }}>
                  <div style={{ fontWeight: 600, color: "white", marginBottom: "4px" }}>📍 {selectedAddress}</div>
                  <div style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{selectedCoords[1].toFixed(6)}, {selectedCoords[0].toFixed(6)}</div>
                </div>
                <div className="input-group">
                  <span className="label">Label this address as</span>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {["Home", "Work", "Favourite Place", "Other"].map(l => (
                      <button key={l} onClick={() => setAddrLabel(l)}
                        style={{
                          padding: "6px 12px", borderRadius: "20px", border: "1px solid",
                          borderColor: addrLabel === l ? "#6366f1" : "rgba(255,255,255,0.1)",
                          background: addrLabel === l ? "rgba(99,102,241,0.2)" : "transparent",
                          color: addrLabel === l ? "#818cf8" : "#9ca3af",
                          cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 600,
                          transition: "all 0.15s"
                        }}>
                        {l === "Home" ? "🏠" : l === "Work" ? "💼" : l === "Favourite Place" ? "⭐" : "📍"} {l}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={saveAddress} className="btn btn-primary btn-block">
                  💾 Save {addrLabel} Address
                </button>
                {saveSuccess && (
                  <div style={{ textAlign: "center", color: "#10b981", fontSize: "0.85rem", fontWeight: 600, animation: "fadeIn 0.3s ease" }}>
                    ✓ Address saved successfully!
                  </div>
                )}
              </div>
            )}

            {/* Saved addresses list */}
            {savedAddresses.length > 0 && (
              <div className="card">
                <div className="card-title">Saved Addresses ({savedAddresses.length})</div>
                <div className="stops-list">
                  {savedAddresses.map(addr => (
                    <div key={addr.id} className="stop-item"
                      onClick={() => flyToCoords(addr.coords, 15)}
                      style={{ cursor: "pointer" }}>
                      <div style={{ fontSize: "1.4rem", lineHeight: 1 }}>{addr.icon}</div>
                      <div className="stop-info">
                        <div className="stop-name">{addr.label}</div>
                        <div className="stop-coords" style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{addr.name}</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); removeAddress(addr.id); }} className="remove-stop-btn">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {savedAddresses.length === 0 && !selectedCoords && (
              <div style={{ textAlign: "center", padding: "24px 16px", color: "#9ca3af", fontSize: "0.85rem" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>📍</div>
                No saved addresses yet.<br />Search above or tap the map to add one.
              </div>
            )}
          </>}
        </div>
      </aside>

      {/* Map */}
      <section className="map-container">
        <div ref={mapContainerRef} className="map-wrapper" />
        {webglError && (
          <iframe
            ref={iframeRef}
            title="2D Interactive Map Fallback"
            srcDoc={LEAFLET_HTML}
            style={{ width: "100%", height: "100%", border: "none", position: "absolute", inset: 0, zIndex: 10 }}
          />
        )}
        <div className="map-badge">
          <span className={`badge-dot ${connectionStatus !== "connected" ? "badge-dot-offline" : ""}`} />
          {activeTab === "address" ? "Tap map to drop a pin" : "Click map to add stop · Maharashtra"}
        </div>
      </section>
    </div>
  );
}
