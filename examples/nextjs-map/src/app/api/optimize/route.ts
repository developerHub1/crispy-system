import { NextResponse } from "next/server";
import { MapClient } from "@tetsifymaps/core";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rider, orders } = body;

    // Validate rider coordinates
    if (!rider || !Array.isArray(rider) || rider.length !== 2) {
      return NextResponse.json(
        { error: "rider location must be a valid coordinate array: [lng, lat]" },
        { status: 400 }
      );
    }

    // Validate orders array
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { error: "orders must be a non-empty array of { id, pickup: [lng, lat], dropoff: [lng, lat] }" },
        { status: 400 }
      );
    }

    // Validate each order structure
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (!order.id) {
        return NextResponse.json(
          { error: `order at index ${i} is missing 'id'` },
          { status: 400 }
        );
      }
      if (!order.pickup || !Array.isArray(order.pickup) || order.pickup.length !== 2) {
        return NextResponse.json(
          { error: `order '${order.id}' has an invalid pickup coordinate array` },
          { status: 400 }
        );
      }
      if (!order.dropoff || !Array.isArray(order.dropoff) || order.dropoff.length !== 2) {
        return NextResponse.json(
          { error: `order '${order.id}' has an invalid dropoff coordinate array` },
          { status: 400 }
        );
      }
    }

    // Use environment variable for Routing URL or default to the verified public endpoint
    const routingUrl = process.env.ROUTING_URL || "https://routing.testifysamples.com";
    const client = new MapClient({ routingUrl });

    // Solve and return PDP results with explicit tuple casting
    const result = await client.optimizeDeliveryRoute(
      rider as [number, number],
      orders.map(o => ({
        id: o.id,
        pickup: o.pickup as [number, number],
        dropoff: o.dropoff as [number, number]
      }))
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Optimize API Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to optimize route" },
      { status: 500 }
    );
  }
}
