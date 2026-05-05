import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";

// ── Types ────────────────────────────────────────────────────────────────────
interface ParkingSpot {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  availableSpaces: number;
  totalSpaces: number;
  starRating: number | null;
  price: number | null;
  locationType: string;
  amenities: string[];
  description: string | null;
  phone: string | null;
  website: string | null;
  lastUpdated: string | null;
}

interface ParkingLog {
  id: number;
  userId: number;
  parkingLocationId: number;
  locationName: string;
  latitude: number;
  longitude: number;
  checkIn: string;
  checkOut: string | null;
  notes: string | null;
}

// ── In-memory store (replace with DB queries in production) ──────────────────
const parkingLots: ParkingSpot[] = [
  {
    id: 1, name: "Pilot Flying J #412", latitude: 34.0522, longitude: -118.2437,
    availableSpaces: 12, totalSpaces: 40, starRating: 4.2, price: 0,
    locationType: "truck_stop", amenities: ["showers", "food", "wifi", "secure"],
    description: "Full-service truck stop with restaurant", phone: "(555) 123-4567",
    website: null, lastUpdated: new Date().toISOString(),
  },
  {
    id: 2, name: "Love's Travel Stop #287", latitude: 34.0700, longitude: -118.2600,
    availableSpaces: 8, totalSpaces: 35, starRating: 4.5, price: 0,
    locationType: "truck_stop", amenities: ["showers", "food", "wifi", "laundry"],
    description: "Clean showers, great food", phone: "(555) 234-5678",
    website: null, lastUpdated: new Date().toISOString(),
  },
  {
    id: 3, name: "TA Travel Center #103", latitude: 34.0300, longitude: -118.2200,
    availableSpaces: 3, totalSpaces: 50, starRating: 3.8, price: 15,
    locationType: "travel_center", amenities: ["showers", "food", "wifi"],
    description: "Large lot with restaurant", phone: "(555) 345-6789",
    website: null, lastUpdated: new Date().toISOString(),
  },
  {
    id: 4, name: "Petro Stopping Center #76", latitude: 34.0900, longitude: -118.2000,
    availableSpaces: 0, totalSpaces: 30, starRating: 4.0, price: 0,
    locationType: "truck_stop", amenities: ["showers", "food", "wifi", "secure", "scale"],
    description: "Has CAT scale on site", phone: "(555) 456-7890",
    website: null, lastUpdated: new Date().toISOString(),
  },
  {
    id: 5, name: "Rest Area I-5 MM 158", latitude: 34.1100, longitude: -118.2800,
    availableSpaces: 22, totalSpaces: 25, starRating: 3.0, price: 0,
    locationType: "rest_area", amenities: ["parking", "restrooms"],
    description: "Free rest area, no services", phone: null,
    website: null, lastUpdated: new Date().toISOString(),
  },
];

let parkingLogs: ParkingLog[] = [];
let nextLogId = 1;
let nextSpotId = 6;

// ── Haversine distance ───────────────────────────────────────────────────────
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Router ───────────────────────────────────────────────────────────────────
export const fuelParkingRouter = router({
  parking: router({
    /**
     * Find parking spots near a location.
     */
    nearby: publicProcedure
      .input(
        z.object({
          latitude: z.number(),
          longitude: z.number(),
          radiusMiles: z.number().min(5).max(500).default(100),
        })
      )
      .query(async ({ input }) => {
        const spots = parkingLots
          .map((s) => ({
            ...s,
            distance: haversineMiles(
              input.latitude,
              input.longitude,
              s.latitude,
              s.longitude
            ),
          }))
          .filter((s) => s.distance <= input.radiusMiles)
          .sort((a, b) => a.distance - b.distance);

        return spots;
      }),

    /**
     * Get the current user's parking logs.
     */
    getParkingLogs: protectedProcedure
      .query(async ({ ctx }) => {
        return parkingLogs.filter((l) => l.userId === ctx.user.id);
      }),

    /**
     * Log parking at a location.
     */
    logParking: protectedProcedure
      .input(
        z.object({
          parkingLocationId: z.number(),
          locationName: z.string(),
          latitude: z.number(),
          longitude: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const log: ParkingLog = {
          id: nextLogId++,
          userId: ctx.user.id,
          parkingLocationId: input.parkingLocationId,
          locationName: input.locationName,
          latitude: input.latitude,
          longitude: input.longitude,
          checkIn: new Date().toISOString(),
          checkOut: null,
          notes: null,
        };
        parkingLogs.push(log);
        return log;
      }),

    /**
     * Check out from parking (update log).
     */
    checkOutParking: protectedProcedure
      .input(z.object({ logId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const idx = parkingLogs.findIndex(
          (l) => l.id === input.logId && l.userId === ctx.user.id
        );
        if (idx === -1) throw new Error("Parking log not found");
        parkingLogs[idx] = {
          ...parkingLogs[idx],
          checkOut: new Date().toISOString(),
        };
        return parkingLogs[idx];
      }),
  }),
});
