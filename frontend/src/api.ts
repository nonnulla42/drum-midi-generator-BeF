export type Preset = {
  id: string;
  label: string;
  settings: {
    bpm: number;
    bars: number;
    grouping: string;
    swing: number;
    humanize_timing: number;
    humanize_velocity: number;
    bar_similarity: number;
    fill_intensity: "off" | "low" | "medium" | "high";
    fill_length: "short" | "medium" | "long";
    fill_every: number;
  };
  kick: {
    enabled: boolean;
    density: number;
    syncopation: number;
    timing_feel: "neutral" | "push" | "drag" | "random";
    velocity_min: number;
    velocity_max: number;
  };
  snare: {
    enabled: boolean;
    density: number;
    syncopation: number;
    timing_feel: "neutral" | "push" | "drag" | "random";
    velocity_min: number;
    velocity_max: number;
  };
  hihat_closed: {
    enabled: boolean;
    division: "quarter" | "eighth" | "sixteenth";
    space: number;
    timing_feel: "neutral" | "push" | "drag" | "random";
    velocity_min: number;
    velocity_max: number;
  };
  ride: {
    enabled: boolean;
    division: "quarter" | "eighth" | "sixteenth";
    space: number;
    timing_feel: "neutral" | "push" | "drag" | "random";
    velocity_min: number;
    velocity_max: number;
  };
  hihat_open: {
    enabled: boolean;
    density: number;
    velocity_min: number;
    velocity_max: number;
  };
  crash: {
    enabled: boolean;
    density: number;
    velocity_min: number;
    velocity_max: number;
  };
  toms: {
    high_hits: number;
    mid_hits: number;
    low_hits: number;
    velocity_min: number;
    velocity_max: number;
  };
};

export type GenerateMidiInput = {
  bpm: number;
  preset?: string;
  bars: number;
  grouping: string;
  swing: number;
  humanize_timing: number;
  humanize_velocity: number;
  bar_similarity: number;
  fill_intensity: "off" | "low" | "medium" | "high";
  fill_length: "short" | "medium" | "long";
  fill_every: number;
  kick_enabled?: boolean;
  kick_density?: number;
  kick_syncopation?: number;
  kick_timing_feel?: "neutral" | "push" | "drag" | "random";
  kick_velocity_min?: number;
  kick_velocity_max?: number;
  snare_enabled?: boolean;
  snare_density?: number;
  snare_syncopation?: number;
  snare_timing_feel?: "neutral" | "push" | "drag" | "random";
  snare_velocity_min?: number;
  snare_velocity_max?: number;
  hihat_closed_enabled?: boolean;
  hihat_closed_division?: "quarter" | "eighth" | "sixteenth";
  hihat_closed_space?: number;
  hihat_closed_timing_feel?: "neutral" | "push" | "drag" | "random";
  hihat_closed_velocity_min?: number;
  hihat_closed_velocity_max?: number;
  ride_enabled?: boolean;
  ride_division?: "quarter" | "eighth" | "sixteenth";
  ride_space?: number;
  ride_timing_feel?: "neutral" | "push" | "drag" | "random";
  ride_velocity_min?: number;
  ride_velocity_max?: number;
  hihat_open_enabled?: boolean;
  hihat_open_density?: number;
  hihat_open_velocity_min?: number;
  hihat_open_velocity_max?: number;
  crash_enabled?: boolean;
  crash_density?: number;
  crash_velocity_min?: number;
  crash_velocity_max?: number;
  toms_high_hits?: number;
  toms_mid_hits?: number;
  toms_low_hits?: number;
  toms_velocity_min?: number;
  toms_velocity_max?: number;
};

export type PatternEvent = {
  bar: number;
  slot: number;
  hit_type: "main" | "accent" | "ghost";
  velocity: number;
  offset: number;
  length_ticks: number;
  source: string;
};

export type GeneratedPattern = {
  pattern_version: number;
  meta: {
    bpm: number;
    bars: number;
    grouping: string;
    slots_per_bar: number;
    swing: number;
    humanize_timing: number;
    humanize_velocity: number;
  };
  instrument_order: string[];
  events: Record<string, PatternEvent[]>;
  fill_regions: Array<{
    bar: number;
    slots: number[];
    intensity: string;
  }>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      return data.detail;
    }
  } catch {
    // Fall back to a generic message when the backend does not return JSON.
  }

  return `Request failed with status ${response.status}`;
}

export async function fetchPresets(): Promise<Preset[]> {
  const response = await fetch(`${API_BASE_URL}/presets`);

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<Preset[]>;
}

export async function generateMidi(input: GenerateMidiInput): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.blob();
}

export async function generatePattern(input: GenerateMidiInput): Promise<GeneratedPattern> {
  const response = await fetch(`${API_BASE_URL}/generate-pattern`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<GeneratedPattern>;
}

export async function exportPatternMidi(pattern: GeneratedPattern): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/export-midi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pattern),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.blob();
}

type PatternCellEditInput = {
  pattern: GeneratedPattern;
  instrument: string;
  bar: number;
  slot: number;
};

type PatternMoveEditInput = {
  pattern: GeneratedPattern;
  instrument: string;
  from_bar: number;
  from_slot: number;
  to_bar: number;
  to_slot: number;
  hit_type: "main" | "accent" | "ghost";
};

async function postPatternEdit<TInput>(path: string, input: TInput): Promise<GeneratedPattern> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<GeneratedPattern>;
}

export function addPatternBaseHit(input: PatternCellEditInput): Promise<GeneratedPattern> {
  return postPatternEdit("/pattern/add-base-hit", input);
}

export function removePatternHit(input: PatternCellEditInput): Promise<GeneratedPattern> {
  return postPatternEdit("/pattern/remove-hit", input);
}

export function movePatternHit(input: PatternMoveEditInput): Promise<GeneratedPattern> {
  return postPatternEdit("/pattern/move-hit", input);
}
