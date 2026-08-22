"use client";

import dynamic from "next/dynamic";
import React from "react";

// Dynamically import MapDashboard with SSR disabled as WebGL requires browser APIs
const MapDashboard = dynamic(
  () => import("../components/MapDashboard"),
  {
    ssr: false,
    loading: () => (
      <div style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        backgroundColor: "#0a0c10",
        color: "white",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "16px",
        fontFamily: "sans-serif"
      }}>
        <div style={{
          border: "4px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "50%",
          borderTop: "4px solid #6366f1",
          width: "40px",
          height: "40px",
          animation: "spin 1s linear infinite"
        }} />
        <p style={{ letterSpacing: "0.05em", fontSize: "0.9rem", color: "#9ca3af" }}>
          INITIALIZING GEOSPATIAL ENGINE...
        </p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }
);

export default function Page() {
  return <MapDashboard />;
}
