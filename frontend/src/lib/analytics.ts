import { API_BASE_URL } from "../api";

const TRACK_ENDPOINT = `${API_BASE_URL}/track`;
const ALLOWED_EVENT_NAMES = new Set([
  "generate_pattern",
  "generate_ghosts",
  "play_preview",
  "export_midi",
]);
const ALLOWED_PAYLOAD_KEYS = new Set(["bpm", "bars", "grouping", "preset_id", "edit_grid_active"]);

type AnalyticsValue = string | number | boolean;

function sanitizePayload(payload?: Record<string, unknown>): Record<string, AnalyticsValue> | undefined {
  if (!payload) {
    return undefined;
  }

  const sanitized = Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => {
      if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
        return false;
      }

      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    }),
  ) as Record<string, AnalyticsValue>;

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function trackEvent(eventName: string, payload?: Record<string, unknown>): void {
  if (!ALLOWED_EVENT_NAMES.has(eventName)) {
    return;
  }

  try {
    const body = JSON.stringify({
      event_name: eventName,
      payload: sanitizePayload(payload),
    });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const beaconQueued = navigator.sendBeacon(TRACK_ENDPOINT, new Blob([body], { type: "application/json" }));
      if (beaconQueued) {
        return;
      }
    }

    void fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never affect product behavior.
  }
}
