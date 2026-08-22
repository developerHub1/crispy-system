import { NextRequest, NextResponse } from "next/server";

// The real upstream Photon geocoding service
const UPSTREAM = "https://geocode.testifysamples.com";

// Catch-all: handles /api/geocode/api?q=... (from SDK) and /api/geocode/reverse?...
export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { searchParams } = new URL(request.url);
  const { path } = await params;
  const subPath = (path || []).join("/"); // e.g. "api" or "reverse"

  const q = searchParams.get("q") || "";
  const limit = searchParams.get("limit") || "7";
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  let upstreamUrl: string;

  if (subPath === "reverse" || (!q && lon && lat)) {
    upstreamUrl = `${UPSTREAM}/reverse?lon=${lon}&lat=${lat}`;
  } else {
    upstreamUrl = `${UPSTREAM}/api?q=${encodeURIComponent(q)}&limit=${limit}`;
    if (lat && lon) upstreamUrl += `&lat=${lat}&lon=${lon}`;
  }

  const res = await fetch(upstreamUrl);
  const data = await res.json();

  return NextResponse.json(data, {
    headers: { "Access-Control-Allow-Origin": "*" }
  });
}
