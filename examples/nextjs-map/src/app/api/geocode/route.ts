import { NextRequest, NextResponse } from "next/server";

// The real upstream Photon geocoding service
const UPSTREAM = "https://geocode.testifysamples.com";

// Proxy search: GET /api/geocode?q=...  (or /api/geocode/api?q=... from SDK)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const limit = searchParams.get("limit") || "7";
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  let upstreamUrl = `${UPSTREAM}/api?q=${encodeURIComponent(q)}&limit=${limit}`;
  if (lat && lon) upstreamUrl += `&lat=${lat}&lon=${lon}`;

  const res = await fetch(upstreamUrl);
  const data = await res.json();
  return NextResponse.json(data, {
    headers: { "Access-Control-Allow-Origin": "*" }
  });
}

// Proxy reverse: POST /api/geocode  with { lon, lat }
export async function POST(request: NextRequest) {
  const { lon, lat } = await request.json();
  const res = await fetch(`${UPSTREAM}/reverse?lon=${lon}&lat=${lat}`);
  const data = await res.json();
  return NextResponse.json(data, {
    headers: { "Access-Control-Allow-Origin": "*" }
  });
}
