import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";

// ── Types ────────────────────────────────────────────────────────────────────
const AlertTypeEnum = z.enum([
  "accident",
  "construction",
  "closure",
  "weather",
  "chain_law",
  "dot_checkpoint",
  "weigh_station",
  "low_clearance",
]);

const SeverityEnum = z.enum(["low", "medium", "high", "critical"]);

interface RoadAlert {
  id: number;
  userId: number | null;
  alertType: string;
  title: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  severity: string;
  reportedAt: string;
  expiresAt: string | null;
  upvotes: number;
  downvotes: number;
  verified: boolean;
}

// ── In-memory store ──────────────────────────────────────────────────────────
let alerts: RoadAlert[] = [
  {
    id: 1, userId: null, alertType: "construction",
    title: "Construction on I-5 North near Grapevine",
    description: "Right lane closed for 3 miles. Expect delays of 15-20 minutes.",
    latitude: 34.9500, longitude: -118.9300,
    severity: "medium", reportedAt: new Date(Date.now() - 3600000).toISOString(),
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
    upvotes: 12, downvotes: 1, verified: true,
  },
  {
    id: 2, userId: null, alertType: "accident",
    title: "Accident I-10 East at Exit 47",
    description: "Multi-vehicle accident blocking middle lane. CHP on scene.",
    latitude: 34.0200, longitude: -118.1500,
    severity: "high", reportedAt: new Date(Date.now() - 1800000).toISOString(),
    expiresAt: new Date(Date.now() + 5400000).toISOString(),
    upvotes: 8, downvotes: 0, verified: true,
  },
  {
    id: 3, userId: null, alertType: "weigh_station",
    title: "Weigh Station Open — I-15 SB MM 35",
    description: "Commercial vehicle inspection in progress. All trucks must exit.",
    latitude: 34.1500, longitude: -117.4800,
    severity: "low", reportedAt: new Date(Date.now() - 7200000).toISOString(),
    expiresAt: new Date(Date.now() + 14400000).toISOString(),
    upvotes: 5, downvotes: 2, verified: true,
  },
  {
    id: 4, userId: null, alertType: "chain_law",
    title: "Chain Law in Effect — I-80 Donner Pass",
    description: "Caltrans requires chains on all trucks. Conditions worsening.",
    latitude: 39.3200, longitude: -120.3200,
    severity: "critical", reportedAt: new Date(Date.now() - 2400000).toISOString(),
    expiresAt: new Date(Date.now() + 28800000).toISOString(),
    upvotes: 25, downvotes: 1, verified: true,
  },
  {
    id: 5, userId: null, alertType: "weather",
    title: "High Winds — I-40 West of Flagstaff",
    description: "Wind gusts up to 55 mph. High-profile vehicles use caution.",
    latitude: 35.2000, longitude: -111.6500,
    severity: "high", reportedAt: new Date(Date.now() - 5400000).toISOString(),
    expiresAt: new Date(Date.now() + 10800000).toISOString(),
    upvotes: 18, downvotes: 0, verified: true,
  },
  {
    id: 6, userId: null, alertType: "low_clearance",
    title: "Low Clearance Warning — US-101 Underpass MM 12",
    description: "Low clearance of 13'6\". Overheight trucks must use detour.",
    latitude: 34.0800, longitude: -118.3100,
    severity: "medium", reportedAt: new Date(Date.now() - 600000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    upvotes: 7, downvotes: 0, verified: true,
  },
];

let nextAlertId = 7;

// ── Haversine distance ───────────────────────────────────────────────────────
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
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
export const alertsReviewsRouter = router({
  alerts: router({
    /**
     * Get all active road alerts.
     */
    getAll: publicProcedure
      .query(async () => {
        const now = new Date();
        return alerts.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);
      }),

    /**
     * Get road alerts near a location.
     */
    nearby: publicProcedure
      .input(
        z.object({
          latitude: z.number(),
          longitude: z.number(),
          radiusMiles: z.number().min(5).max(500).default(200),
        })
      )
      .query(async ({ input }) => {
        const now = new Date();
        return alerts
          .filter((a) => {
            if (a.expiresAt && new Date(a.expiresAt) <= now) return false;
            if (a.latitude == null || a.longitude == null) return false;
            const dist = haversineMiles(
              input.latitude,
              input.longitude,
              a.latitude,
              a.longitude
            );
            return dist <= input.radiusMiles;
          })
          .map((a) => {
            const dist =
              a.latitude != null && a.longitude != null
                ? haversineMiles(
                    input.latitude,
                    input.longitude,
                    a.latitude,
                    a.longitude
                  )
                : null;
            return { ...a, distance: dist != null ? Math.round(dist * 10) / 10 : null };
          })
          .sort((a, b) => {
            if (a.distance != null && b.distance != null) return a.distance - b.distance;
            if (a.distance != null) return -1;
            if (b.distance != null) return 1;
            return 0;
          });
      }),

    /**
     * Report a new road hazard.
     */
    report: protectedProcedure
      .input(
        z.object({
          alertType: AlertTypeEnum,
          title: z.string().min(1).max(200),
          description: z.string().max(1000).default(""),
          latitude: z.number(),
          longitude: z.number(),
          severity: SeverityEnum.default("medium"),
          expiresIn: z.number().min(1).max(168).default(24), // hours
        })
      )
      .mutation(async ({ ctx, input }) => {
        const alert: RoadAlert = {
          id: nextAlertId++,
          userId: ctx.user.id,
          alertType: input.alertType,
          title: input.title,
          description: input.description || null,
          latitude: input.latitude,
          longitude: input.longitude,
          severity: input.severity,
          reportedAt: new Date().toISOString(),
          expiresAt: new Date(
            Date.now() + input.expiresIn * 3600000
          ).toISOString(),
          upvotes: 0,
          downvotes: 0,
          verified: false,
        };
        alerts.push(alert);
        return alert;
      }),

    /**
     * Upvote an alert (verify it's still active).
     */
    upvote: protectedProcedure
      .input(z.object({ alertId: z.number() }))
      .mutation(async ({ input }) => {
        const alert = alerts.find((a) => a.id === input.alertId);
        if (!alert) throw new Error("Alert not found");
        alert.upvotes++;
        // Auto-verify at 10 upvotes
        if (alert.upvotes >= 10) alert.verified = true;
        return alert;
      }),

    /**
     * Downvote an alert (mark as inaccurate/expired).
     */
    downvote: protectedProcedure
      .input(z.object({ alertId: z.number() }))
      .mutation(async ({ input }) => {
        const alert = alerts.find((a) => a.id === input.alertId);
        if (!alert) throw new Error("Alert not found");
        alert.downvotes++;
        // Auto-remove if downvoted enough
        if (alert.downvotes >= 5) {
          alerts = alerts.filter((a) => a.id !== input.alertId);
          return { removed: true };
        }
        return alert;
      }),
  }),
});
