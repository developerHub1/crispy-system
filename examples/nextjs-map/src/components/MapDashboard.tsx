"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapClient, PhotonFeature, TripResult, formatAddress } from "@tetsifymaps/core";

// Define Stop Structure
interface MapStop {
  id: string;
  name: string;
  coords: [number, number]; // [lng, lat]
}

export default function MapDashboard() {
  // Connection states (initialized from env or standard defaults)
  const [tileUrl, setTileUrl] = useState(() => 
    process.env.NEXT_PUBLIC_MAP_TILE_URL || "http://localhost:8080/styles/basic/style.json"
  );
  const [geocodeUrl, setGeocodeUrl] = useState(() => 
    process.env.NEXT_PUBLIC_GEOCODE_URL || "http://localhost:2322"
  );
  const [routingUrl, setRoutingUrl] = useState(() => 
    process.env.NEXT_PUBLIC_ROUTING_URL || "http://localhost:5000"
  );

  // Settings visibility
  const [showSettings, setShowSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "checking">("checking");

  // Map & SDK Client refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const sdkClientRef = useRef<MapClient>(new MapClient({ geocodeUrl, routingUrl }));

  // App States
  const [stops, setStops] = useState<MapStop[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [optimizeRoute, setOptimizeRoute] = useState(false);
  const [tripResult, setTripResult] = useState<TripResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Update SDK client when endpoints change
  useEffect(() => {
    sdkClientRef.current = new MapClient({ 
      geocodeUrl: geocodeUrl, 
      routingUrl: routingUrl 
    });
  }, [geocodeUrl, routingUrl]);

  // Test container connectivity
  const checkConnections = useCallback(async () => {
    setConnectionStatus("checking");
    try {
      // Test photon geocoding endpoint with a simple dummy search
      const client = sdkClientRef.current;
      await client.searchLandmarks("test", undefined, 1);
      setConnectionStatus("connected");
    } catch (e) {
      console.warn("Connection test failed", e);
      setConnectionStatus("disconnected");
    }
  }, []);

  // Check connections on load
  useEffect(() => {
    checkConnections();
  }, [checkConnections]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Load maplibre-gl dynamically to ensure window check passes safely
    let maplibre: any;
    
    const initMap = async () => {
      maplibre = await import("maplibre-gl");
      
      if (mapRef.current) {
        mapRef.current.remove();
      }

      try {
        const map = new maplibre.Map({
          container: mapContainerRef.current!,
          style: tileUrl,
          center: [73.8567, 18.5204], // Default: Pune, India
          zoom: 12,
        });

        // Add standard navigation controls
        map.addControl(new maplibre.NavigationControl(), "top-right");

        // Click on map to drop a stop
        map.on("click", async (e: any) => {
          const { lng, lat } = e.lngLat;
          
          try {
            const client = sdkClientRef.current;
            const geoResult = await client.reverseGeocode(lng, lat);
            
            let stopName = `Pinned Location (${lng.toFixed(4)}, ${lat.toFixed(4)})`;
            if (geoResult && geoResult.properties) {
              stopName = formatAddress(geoResult.properties);
            }

            const newStop: MapStop = {
              id: Math.random().toString(36).substring(2, 9),
              name: stopName,
              coords: [lng, lat],
            };

            setStops((prev) => {
              if (prev.length >= 30) {
                setErrorMsg("Maximum of 30 stops reached.");
                return prev;
              }
              return [...prev, newStop];
            });
          } catch (err) {
            console.error("Map click reverse geocoding failed:", err);
            // Add fallback stop anyway
            const newStop: MapStop = {
              id: Math.random().toString(36).substring(2, 9),
              name: `Pinned stop (${lng.toFixed(4)}, ${lat.toFixed(4)})`,
              coords: [lng, lat],
            };
            setStops((prev) => [...prev, newStop]);
          }
        });

        mapRef.current = map;
      } catch (err) {
        console.error("Failed to load map style from TileServer GL:", err);
        setErrorMsg("Failed to connect to TileServer GL. Verify connection settings.");
      }
    };

    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [tileUrl]);

  // Update map markers when stops change
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Import maplibre dynamically to create markers
    import("maplibre-gl").then((maplibre) => {
      stops.forEach((stop, index) => {
        const el = document.createElement("div");
        el.className = "custom-marker";
        
        // Style differently for start/end
        if (index === 0) {
          el.classList.add("custom-marker-first");
        } else if (index === stops.length - 1) {
          el.classList.add("custom-marker-last");
        }

        el.innerHTML = `<div class="custom-marker-inner">${index + 1}</div>`;

        // Create marker popup
        const popup = new maplibre.Popup({ offset: 25 }).setHTML(
          `<div style="color: black; font-family: sans-serif; font-size: 13px;">
             <strong>Stop #${index + 1}</strong><br/>
             ${stop.name}
           </div>`
        );

        const marker = new maplibre.Marker({ element: el })
          .setLngLat(stop.coords)
          .setPopup(popup)
          .addTo(mapRef.current);

        markersRef.current.push(marker);
      });
    });

    // Auto-fit bounds if we have stops
    if (stops.length > 0 && mapRef.current) {
      import("maplibre-gl").then((maplibre) => {
        const bounds = new maplibre.LngLatBounds(stops[0].coords, stops[0].coords);
        stops.forEach(stop => bounds.extend(stop.coords));
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      });
    }
  }, [stops]);

  // Autocomplete search handler
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setErrorMsg(null);
      try {
        const client = sdkClientRef.current;
        // Optionally pass current map center to prioritize nearby search
        let centerCoords: [number, number] | undefined = undefined;
        if (mapRef.current) {
          const center = mapRef.current.getCenter();
          centerCoords = [center.lng, center.lat];
        }
        
        const results = await client.searchLandmarks(searchQuery, centerCoords, 7);
        setSearchResults(results);
      } catch (err) {
        console.error("Geocoding failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Locate User (browser GPS)
  const locateUser = () => {
    if (!navigator.geolocation) {
      setErrorMsg("Geolocation is not supported by your browser.");
      return;
    }

    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { longitude, latitude } = position.coords;
        
        // Pan map
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [longitude, latitude], zoom: 14 });
        }

        try {
          const client = sdkClientRef.current;
          const geoResult = await client.reverseGeocode(longitude, latitude);
          
          let addressName = `My Location (${longitude.toFixed(4)}, ${latitude.toFixed(4)})`;
          if (geoResult && geoResult.properties) {
            addressName = formatAddress(geoResult.properties);
          }

          const newStop: MapStop = {
            id: "current-loc",
            name: addressName,
            coords: [longitude, latitude],
          };

          // Place current location as the first stop
          setStops((prev) => {
            const filtered = prev.filter(s => s.id !== "current-loc");
            return [newStop, ...filtered];
          });
        } catch (err) {
          console.error("Location reverse geocode failed:", err);
          // Add basic fallback stop
          const newStop: MapStop = {
            id: "current-loc",
            name: `My Position (${longitude.toFixed(4)}, ${latitude.toFixed(4)})`,
            coords: [longitude, latitude],
          };
          setStops((prev) => [newStop, ...prev.filter(s => s.id !== "current-loc")]);
        }
      },
      (err) => {
        console.error(err);
        setErrorMsg("Failed to retrieve GPS location: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Add Stop from Search Autocomplete
  const addStopFromSearch = (feature: PhotonFeature) => {
    const coords = feature.geometry.coordinates;
    const name = formatAddress(feature.properties);
    
    if (stops.length >= 30) {
      setErrorMsg("Maximum of 30 stops reached.");
      setSearchQuery("");
      setSearchResults([]);
      return;
    }

    const newStop: MapStop = {
      id: Math.random().toString(36).substring(2, 9),
      name,
      coords,
    };

    setStops((prev) => [...prev, newStop]);
    setSearchQuery("");
    setSearchResults([]);

    if (mapRef.current) {
      mapRef.current.flyTo({ center: coords, zoom: 14 });
    }
  };

  // Remove Stop
  const removeStop = (id: string) => {
    setStops((prev) => prev.filter(s => s.id !== id));
    // Clear route if we fall below 2 stops
    if (stops.length <= 2) {
      setTripResult(null);
      if (mapRef.current && mapRef.current.getSource("route")) {
        mapRef.current.removeLayer("route");
        mapRef.current.removeSource("route");
      }
    }
  };

  // Clear All Stops
  const clearAllStops = () => {
    setStops([]);
    setTripResult(null);
    if (mapRef.current) {
      if (mapRef.current.getLayer("route")) mapRef.current.removeLayer("route");
      if (mapRef.current.getSource("route")) mapRef.current.removeSource("route");
    }
    setErrorMsg(null);
  };

  // Calculate Route
  const calculateRoute = async () => {
    if (stops.length < 2) {
      setErrorMsg("Please add at least 2 stops to plan a route.");
      return;
    }

    setIsRouting(true);
    setErrorMsg(null);

    try {
      const client = sdkClientRef.current;
      const coords = stops.map(s => s.coords);
      const result = await client.calculateMultiStopTrip(coords, optimizeRoute);

      setTripResult(result);

      // Draw path on map
      if (mapRef.current) {
        if (mapRef.current.getSource("route")) {
          mapRef.current.getSource("route").setData(result.geometry);
        } else {
          mapRef.current.addSource("route", {
            type: "geojson",
            data: result.geometry,
          });
          mapRef.current.addLayer({
            id: "route",
            type: "line",
            source: "route",
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#6366f1",
              "line-width": 6,
              "line-opacity": 0.85,
            },
          });
        }

        // Fit map bounds to show full route polyline
        import("maplibre-gl").then((maplibre) => {
          const pathCoordinates = result.geometry.coordinates;
          const bounds = new maplibre.LngLatBounds(pathCoordinates[0], pathCoordinates[0]);
          pathCoordinates.forEach((c: [number, number]) => bounds.extend(c));
          mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 16 });
        });

        // If optimized (TSP), reorder stops state to match the visited order
        if (optimizeRoute && result.visitOrder.length === stops.length) {
          const reorderedStops = result.visitOrder.map(index => stops[index]);
          setStops(reorderedStops);
        }
      }
    } catch (err: any) {
      console.error("Routing error:", err);
      setErrorMsg(err.message || "Failed to calculate route. Check routing engine.");
    } finally {
      setIsRouting(false);
    }
  };

  return (
    <div className="dashboard">
      {/* Sidebar Panel */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>
            <span style={{ color: "#818cf8" }}>Tetsify</span>Maps
          </h1>
          <p>Production Self-Hosted Mapping Dashboard</p>
        </div>

        <div className="sidebar-content">
          {/* Connection Status Indicator */}
          <div className="card">
            <div className="card-title">
              Infrastructure Node
              <button 
                onClick={() => setShowSettings(!showSettings)} 
                className="btn btn-secondary btn-sm"
              >
                {showSettings ? "Close Settings" : "Configure"}
              </button>
            </div>
            
            {!showSettings ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                <span style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className={`badge-dot ${connectionStatus !== "connected" ? "badge-dot-offline" : ""}`} />
                  {connectionStatus === "checking" && "Connecting to node..."}
                  {connectionStatus === "connected" && "Stack Online"}
                  {connectionStatus === "disconnected" && "Offline: Config Needed"}
                </span>
                {connectionStatus === "disconnected" && (
                  <button onClick={checkConnections} className="btn btn-secondary btn-sm">Retry</button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "6px" }}>
                <div className="input-group">
                  <span className="label">Tile JSON Endpoint (TileServer GL)</span>
                  <input 
                    type="text" 
                    value={tileUrl} 
                    onChange={(e) => setTileUrl(e.target.value)} 
                    className="input-field" 
                  />
                </div>
                <div className="input-group">
                  <span className="label">Geocoding Endpoint (Photon)</span>
                  <input 
                    type="text" 
                    value={geocodeUrl} 
                    onChange={(e) => setGeocodeUrl(e.target.value)} 
                    className="input-field" 
                  />
                </div>
                <div className="input-group">
                  <span className="label">Routing Endpoint (OSRM)</span>
                  <input 
                    type="text" 
                    value={routingUrl} 
                    onChange={(e) => setRoutingUrl(e.target.value)} 
                    className="input-field" 
                  />
                </div>
                <button 
                  onClick={() => { setShowSettings(false); checkConnections(); }} 
                  className="btn btn-primary btn-sm btn-block"
                  style={{ marginTop: "4px" }}
                >
                  Save & Apply Config
                </button>
              </div>
            )}
          </div>

          {/* Location Search card */}
          <div className="card">
            <div className="card-title">Search & Add Waypoints</div>
            
            <div className="input-group">
              <div className="input-wrapper">
                <input
                  type="text"
                  placeholder="Search address, city, landmark..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input-field"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="clear-btn">×</button>
                )}
              </div>

              {isSearching && (
                <div style={{ position: "absolute", right: "12px", top: "10px" }}>
                  <span className="spinner" style={{ width: "16px", height: "16px" }} />
                </div>
              )}

              {/* Search Dropdown */}
              {searchResults.length > 0 && (
                <div className="autocomplete-dropdown">
                  {searchResults.map((feature, idx) => (
                    <div
                      key={idx}
                      onClick={() => addStopFromSearch(feature)}
                      className="autocomplete-item"
                    >
                      <span className="autocomplete-item-name">
                        {feature.properties.name || feature.properties.street || "Unknown Landmark"}
                      </span>
                      <span className="autocomplete-item-address">
                        {formatAddress(feature.properties)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={locateUser} className="btn btn-secondary btn-block">
                <span>📍</span> Locate Me
              </button>
            </div>
          </div>

          {/* Stops List Card */}
          <div className="card">
            <div className="card-title">
              Trip Stops ({stops.length}/30)
              {stops.length > 0 && (
                <button 
                  onClick={clearAllStops} 
                  className="btn btn-danger btn-sm"
                  style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                >
                  Clear All
                </button>
              )}
            </div>

            {stops.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "0.85rem", padding: "16px 0" }}>
                No stops added yet.<br/>Search above or double-click the map.
              </div>
            ) : (
              <div className="stops-list">
                {stops.map((stop, index) => {
                  let stopClass = "";
                  if (index === 0) stopClass = "stop-item-first";
                  else if (index === stops.length - 1) stopClass = "stop-item-last";

                  return (
                    <div key={stop.id} className={`stop-item ${stopClass}`}>
                      <div className="stop-number">{index + 1}</div>
                      <div className="stop-info">
                        <div className="stop-name">{stop.name}</div>
                        <div className="stop-coords">
                          {stop.coords[0].toFixed(5)}, {stop.coords[1].toFixed(5)}
                        </div>
                      </div>
                      <button onClick={() => removeStop(stop.id)} className="remove-stop-btn">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Planner Controls Card */}
          {stops.length >= 2 && (
            <div className="card">
              <div className="card-title">Route Optimization</div>
              
              <div className="switch-group">
                <div className="switch-label">
                  <span className="switch-label-title">Optimize Stops Order (TSP)</span>
                  <span className="switch-label-desc">Solve Traveling Salesperson problem</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={optimizeRoute}
                    onChange={(e) => setOptimizeRoute(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <button 
                onClick={calculateRoute} 
                disabled={isRouting}
                className="btn btn-primary btn-block"
              >
                {isRouting ? (
                  <>
                    <span className="spinner" /> Calculating Route...
                  </>
                ) : (
                  <>
                    <span>🚀</span> Calculate Optimal Route
                  </>
                )}
              </button>
            </div>
          )}

          {/* Trip Summary Card */}
          {tripResult && (
            <div className="card" style={{ border: "1px solid rgba(99, 102, 241, 0.3)", background: "linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(168, 85, 247, 0.03))" }}>
              <div className="card-title">Trip Summary</div>
              <div className="stats-grid">
                <div className="stat-box">
                  <div className="stat-val">{tripResult.distance}</div>
                  <div className="stat-lbl">Distance (km)</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val">{tripResult.duration}</div>
                  <div className="stat-lbl">Duration (min)</div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div style={{ padding: "12px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", color: "#f87171", fontSize: "0.85rem", textAlign: "center" }}>
              {errorMsg}
            </div>
          )}
        </div>
      </aside>

      {/* Map Container Panel */}
      <section className="map-container">
        <div ref={mapContainerRef} className="map-wrapper" />
        
        {/* Dynamic connection indicator badge */}
        <div className="map-badge">
          <span className={`badge-dot ${connectionStatus !== "connected" ? "badge-dot-offline" : ""}`} />
          TileServer: Basic Vector (Pune)
        </div>
      </section>
    </div>
  );
}
