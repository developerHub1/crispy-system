/**
 * Core types for the TetsifyMaps Core SDK
 */

export interface MapClientConfig {
  geocodeUrl?: string; // Default: 'http://localhost:2322'
  routingUrl?: string; // Default: 'http://localhost:5000'
}

export interface PhotonProperties {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  state?: string;
  country?: string;
  extent?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export interface PhotonFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: PhotonProperties;
}

export interface PhotonResponse {
  type: "FeatureCollection";
  features: PhotonFeature[];
}

export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][]; // Array of [lng, lat]
}

export interface RouteLeg {
  distance: number; // meters
  duration: number; // seconds
  summary: string;
  steps?: any[];
}

export interface TripResult {
  distance: number; // Total distance in kilometers
  duration: number; // Total duration in minutes
  legs: RouteLeg[];
  geometry: RouteGeometry;
  visitOrder: number[]; // Index array indicating visiting sequence of input coordinates
}

/**
 * Format address from Photon Properties
 */
export function formatAddress(properties: PhotonProperties): string {
  const parts: string[] = [];
  
  if (properties.name) {
    parts.push(properties.name);
  }
  
  const streetAndNumber = [properties.street, properties.housenumber]
    .filter(Boolean)
    .join(" ");
    
  if (streetAndNumber && properties.name !== properties.street) {
    parts.push(streetAndNumber);
  }
  
  const cityZip = [properties.postcode, properties.city]
    .filter(Boolean)
    .join(" ");
    
  if (cityZip) {
    parts.push(cityZip);
  }
  
  if (properties.country) {
    parts.push(properties.country);
  }
  
  return parts.join(", ");
}

/**
 * TetsifyMaps core client to communicate with self-hosted Docker instances.
 */
export class MapClient {
  private geocodeUrl: string;
  private routingUrl: string;

  constructor(config?: MapClientConfig) {
    // Default to localhost ports or specified env/config variables
    this.geocodeUrl = config?.geocodeUrl || "http://localhost:2322";
    this.routingUrl = config?.routingUrl || "http://localhost:5000";
    
    // Remove trailing slashes
    this.geocodeUrl = this.geocodeUrl.replace(/\/$/, "");
    this.routingUrl = this.routingUrl.replace(/\/$/, "");
  }

  /**
   * Search for locations, addresses, and landmarks.
   * @param query Address or landmark search term
   * @param focusCoords Optional [lng, lat] coordinates to bias search results
   * @param limit Maximum results (default 10)
   */
  async searchLandmarks(
    query: string,
    focusCoords?: [number, number],
    limit = 10
  ): Promise<PhotonFeature[]> {
    if (!query.trim()) return [];

    let url = `${this.geocodeUrl}/api?q=${encodeURIComponent(query)}&limit=${limit}`;
    
    if (focusCoords && focusCoords.length === 2) {
      const [lng, lat] = focusCoords;
      url += `&lon=${lng}&lat=${lat}`;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Photon search request failed with status: ${response.status}`);
      }
      const data: PhotonResponse = await response.json();
      return data.features || [];
    } catch (error) {
      console.error("Photon Geocoder Error:", error);
      throw error;
    }
  }

  /**
   * Performs reverse geocoding to find address near device coordinates.
   * @param lng Longitude
   * @param lat Latitude
   */
  async reverseGeocode(lng: number, lat: number): Promise<PhotonFeature | null> {
    const url = `${this.geocodeUrl}/reverse?lon=${lng}&lat=${lat}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Photon reverse geocode request failed with status: ${response.status}`);
      }
      const data: PhotonResponse = await response.json();
      return data.features && data.features.length > 0 ? data.features[0] : null;
    } catch (error) {
      console.error("Photon Reverse Geocode Error:", error);
      throw error;
    }
  }

  /**
   * Calculates route for up to 30 coordinates.
   * If optimize = true, runs TSP optimization using OSRM /trip/v1.
   * Otherwise, calculates sequentially using OSRM /route/v1.
   * @param points Array of [lng, lat] coordinates
   * @param optimize Set to true to optimize route stops (TSP solver)
   */
  async calculateMultiStopTrip(
    points: [number, number][],
    optimize = false
  ): Promise<TripResult> {
    if (points.length < 2) {
      throw new Error("At least 2 points are required to calculate a trip.");
    }
    if (points.length > 30) {
      throw new Error("OSRM supports a maximum of 30 stops in this configuration.");
    }

    // Format coordinates: "lon1,lat1;lon2,lat2;..."
    const coordString = points.map(p => `${p[0]},${p[1]}`).join(";");
    const service = optimize ? "trip" : "route";
    
    // Request full geojson geometry and routing legs/steps
    const url = `${this.routingUrl}/${service}/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `OSRM routing request failed: ${errorData.message || response.statusText} (${response.status})`
        );
      }
      
      const data = await response.json();

      if (data.code !== "Ok") {
        throw new Error(`OSRM Engine Error: ${data.code}`);
      }

      if (optimize) {
        // Parse /trip/v1 output
        const trip = data.trips[0];
        
        // Map visiting order from waypoints.
        // OSRM /trip waypoints correspond to input order, containing `waypoint_index`
        // which represents their order in the optimized route.
        const visitOrder = new Array<number>(points.length);
        const waypoints = data.waypoints as Array<{ waypoint_index: number; trips_index: number }>;
        
        waypoints.forEach((wp, originalIndex) => {
          visitOrder[wp.waypoint_index] = originalIndex;
        });

        return {
          distance: +(trip.distance / 1000).toFixed(2), // Convert meters to km
          duration: +(trip.duration / 60).toFixed(1),   // Convert seconds to minutes
          legs: trip.legs || [],
          geometry: trip.geometry,
          visitOrder
        };
      } else {
        // Parse /route/v1 output
        const route = data.routes[0];
        const visitOrder = points.map((_, index) => index); // Linear sequential order

        return {
          distance: +(route.distance / 1000).toFixed(2),
          duration: +(route.duration / 60).toFixed(1),
          legs: route.legs || [],
          geometry: route.geometry,
          visitOrder
        };
      }
    } catch (error) {
      console.error("OSRM Routing Error:", error);
      throw error;
    }
  }
}
