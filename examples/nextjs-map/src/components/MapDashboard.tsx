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

  // ── Save Address state ──
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<PhotonFeature[]>([]);
  const [isAddrSearching, setIsAddrSearching] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(null);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addrLabel, setAddrLabel] = useState("Home");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

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

  // ── Map init ──
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let maplibre: any;

    const initMap = async () => {
      maplibre = await import("maplibre-gl");

      // MapLibre 6.x: set worker URL explicitly
      if (maplibre.addProtocol) {
        // v6 protocol support
      }
      (maplibre as any).setWorkerUrl?.("/maplibre-worker.js");

      if (mapRef.current) { mapRef.current.remove(); }

      try {
        const map = new maplibre.Map({
          container: mapContainerRef.current!,
          style: TILE_URL,
          center: [76.0, 19.0],
          zoom: 7,
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
            else {
              const el = document.createElement("div");
              el.style.cssText = "font-size:32px;cursor:pointer;";
              el.textContent = "📍";
              pinMarkerRef.current = new maplibre.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
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
        });
        mapRef.current = map;
      } catch {
        setErrorMsg("Failed to load map tiles.");
      }
    };
    initMap();
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TILE_URL]);

  // Track active tab in ref so map click handler can access latest value
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // ── Stop markers ──
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    import("maplibre-gl").then(maplibre => {
      stops.forEach((stop, i) => {
        const el = document.createElement("div");
        el.className = `custom-marker ${i === 0 ? "custom-marker-first" : i === stops.length - 1 ? "custom-marker-last" : ""}`;
        el.innerHTML = `<div class="custom-marker-inner">${i + 1}</div>`;
        const popup = new maplibre.Popup({ offset: 25 }).setHTML(
          `<div style="color:black;font-family:sans-serif;font-size:13px"><strong>Stop #${i + 1}</strong><br/>${stop.name}</div>`
        );
        markersRef.current.push(new maplibre.Marker({ element: el }).setLngLat(stop.coords).setPopup(popup).addTo(mapRef.current));
      });
      if (stops.length > 0) {
        const bounds = new maplibre.LngLatBounds(stops[0].coords, stops[0].coords);
        stops.forEach(s => bounds.extend(s.coords));
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      }
    });
  }, [stops]);

  // ── Route search autocomplete ──
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const center = mapRef.current ? [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat] as [number, number] : undefined;
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
    const coords = feature.geometry.coordinates as [number, number];
    setStops(prev => [...prev, { id: crypto.randomUUID(), name: formatAddress(feature.properties), coords }]);
    setSearchQuery(""); setSearchResults([]);
    mapRef.current?.flyTo({ center: coords, zoom: 14 });
  };

  const selectAddrFromSearch = (feature: PhotonFeature) => {
    const coords = feature.geometry.coordinates as [number, number];
    setSelectedCoords(coords);
    setSelectedAddress(formatAddress(feature.properties));
    setAddrQuery(feature.properties.name || "");
    setAddrResults([]);
    mapRef.current?.flyTo({ center: coords, zoom: 15 });
    // Place pin marker
    import("maplibre-gl").then(maplibre => {
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
    if (stops.length < 2) { setErrorMsg("Add at least 2 stops."); return; }
    setIsRouting(true); setErrorMsg(null);
    try {
      const result = await sdkClientRef.current.calculateMultiStopTrip(stops.map(s => s.coords), optimizeRoute);
      setTripResult(result);
      const map = mapRef.current;
      if (map) {
        if (map.getSource("route")) map.getSource("route").setData(result.geometry);
        else {
          map.addSource("route", { type: "geojson", data: result.geometry });
          map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#6366f1", "line-width": 6, "line-opacity": 0.85 } });
        }
        const bounds = (await import("maplibre-gl")).LngLatBounds;
        const b = new bounds(result.geometry.coordinates[0] as any, result.geometry.coordinates[0] as any);
        (result.geometry.coordinates as any[]).forEach(c => b.extend(c));
        map.fitBounds(b, { padding: 80, maxZoom: 16 });
        if (optimizeRoute && result.visitOrder.length === stops.length) setStops(result.visitOrder.map(i => stops[i]));
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
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 14 });
      try {
        const geo = await sdkClientRef.current.reverseGeocode(lng, lat);
        const name = geo?.properties ? formatAddress(geo.properties) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setStops(prev => [{ id: "current-loc", name, coords: [lng, lat] }, ...prev.filter(s => s.id !== "current-loc")]);
      } catch {
        setStops(prev => [{ id: "current-loc", name: `My Location`, coords: [lng, lat] }, ...prev.filter(s => s.id !== "current-loc")]);
      }
    });
  };

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
                        <div className="stop-coords">{s.coords[0].toFixed(5)}, {s.coords[1].toFixed(5)}</div>
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
            {selectedCoords && (
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
                      onClick={() => mapRef.current?.flyTo({ center: addr.coords, zoom: 15 })}
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
        <div className="map-badge">
          <span className={`badge-dot ${connectionStatus !== "connected" ? "badge-dot-offline" : ""}`} />
          {activeTab === "address" ? "Tap map to drop a pin" : "Click map to add stop · Maharashtra"}
        </div>
      </section>
    </div>
  );
}
