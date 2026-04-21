import {
  FormEvent,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type SetStateAction,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  addPatternBaseHit,
  exportPatternMidi,
  fetchPresets,
  generateMidi,
  generatePatternGhosts,
  generatePattern,
  movePatternHit,
  removePatternHit,
  type GenerateMidiInput,
  type GeneratedPattern,
  type PatternEvent,
  type Preset,
} from "./api";
import { trackEvent } from "./lib/analytics";
import { PatternPlayer } from "./playback";

const CUSTOM_PRESET_ID = "custom";

const DEFAULT_KICK = {
  enabled: true,
  density: 0.45,
  syncopation: 2,
  timingFeel: "neutral" as const,
  velocityMin: 64,
  velocityMax: 98,
};

const DEFAULT_SNARE = {
  enabled: true,
  density: 0.4,
  syncopation: 1,
  timingFeel: "neutral" as const,
  velocityMin: 58,
  velocityMax: 94,
  ghost: {
    enabled: true,
    density: 0.28,
    velocity: 33,
    placement: "both" as const,
  },
};

const DEFAULT_HIHAT_CLOSED = {
  enabled: true,
  division: "sixteenth" as const,
  space: 0,
  timingFeel: "neutral" as const,
  velocityMin: 62,
  velocityMax: 92,
  ghost: {
    enabled: true,
    density: 0.18,
    velocity: 27,
    placement: "after" as const,
  },
};

const DEFAULT_RIDE = {
  enabled: true,
  division: "eighth" as const,
  space: 0,
  timingFeel: "neutral" as const,
  velocityMin: 46,
  velocityMax: 74,
  ghost: {
    enabled: true,
    density: 0.12,
    velocity: 29,
    placement: "after" as const,
  },
};

const DEFAULT_HIHAT_OPEN = {
  enabled: true,
  density: 0.18,
  velocityMin: 48,
  velocityMax: 76,
};

const DEFAULT_CRASH = {
  enabled: true,
  density: 0.12,
  velocityMin: 76,
  velocityMax: 92,
};

const DEFAULT_TOMS = {
  highHits: 0,
  midHits: 0,
  lowHits: 0,
  velocityMin: 54,
  velocityMax: 86,
};

const SYNCOPATION_OPTIONS = [
  { value: 0, label: "0 Structure" },
  { value: 1, label: "1 Light" },
  { value: 2, label: "2 Medium" },
  { value: 3, label: "3 Active" },
  { value: 4, label: "4 Loose" },
  { value: 5, label: "5 Free" },
];

const TIMING_FEEL_OPTIONS = [
  { value: "neutral", label: "Neutral" },
  { value: "push", label: "Push" },
  { value: "drag", label: "Drag" },
  { value: "random", label: "Random" },
] as const;

const DIVISION_OPTIONS = [
  { value: "quarter", label: "Quarter" },
  { value: "eighth", label: "Eighth" },
  { value: "sixteenth", label: "Sixteenth" },
] as const;

const TOMS_HIT_OPTIONS = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
] as const;

const FILL_INTENSITY_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Mid" },
  { value: "high", label: "High" },
] as const;

const FILL_LENGTH_OPTIONS = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Mid" },
  { value: "long", label: "Long" },
] as const;

const FILL_EVERY_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "4", label: "4" },
  { value: "8", label: "8" },
] as const;

const PATTERN_LENGTH_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "4", label: "4" },
  { value: "8", label: "8" },
] as const;

const GHOST_PLACEMENT_OPTIONS = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "both", label: "Both" },
] as const;

const INSTRUMENT_LABELS: Record<string, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat_closed: "Hi-Hat Closed",
  hihat_open: "Hi-Hat Open",
  ride: "Ride",
  crash: "Crash",
  tom_high: "Tom High",
  tom_mid: "Tom Mid",
  tom_low: "Tom Low",
};

const INSTRUMENT_IDS = [
  "kick",
  "snare",
  "hihat_closed",
  "hihat_open",
  "ride",
  "crash",
  "tom_high",
  "tom_mid",
  "tom_low",
] as const;

const PLACEHOLDER_GRID_INSTRUMENTS = [...INSTRUMENT_IDS];

type InstrumentId = (typeof INSTRUMENT_IDS)[number];
type TimingFeelValue = (typeof TIMING_FEEL_OPTIONS)[number]["value"];
type DivisionValue = (typeof DIVISION_OPTIONS)[number]["value"];
type FillIntensityValue = (typeof FILL_INTENSITY_OPTIONS)[number]["value"];
type FillLengthValue = (typeof FILL_LENGTH_OPTIONS)[number]["value"];
type SeedValue = number | "random";

type InstrumentControlSnapshot = {
  enabled: boolean;
  density?: number;
  syncopation?: number;
  division?: DivisionValue;
  space?: number;
  timingFeel?: TimingFeelValue;
  velocityMin: number;
  velocityMax: number;
  tomHits?: number;
};

type GlobalGenerationContext = {
  bpm: number;
  swing: number;
  humanizeTiming: number;
  humanizeVelocity: number;
  barSimilarity: number;
  fillIntensity: FillIntensityValue;
  fillLength: FillLengthValue;
  fillEvery: number;
  seed: SeedValue;
};

type PendingGridEdit =
  | {
      kind: "toggle";
      instrument: InstrumentId;
      bar: number;
      slot: number;
      hasVisibleEvent: boolean;
    }
  | {
      kind: "move";
      instrument: InstrumentId;
      fromBar: number;
      fromSlot: number;
      toBar: number;
      toSlot: number;
      hitType: PatternEvent["hit_type"];
    };

type InstrumentStatus = {
  kind: "dirty" | "queued";
  label: string;
};

function setInstrumentQueuedState(current: InstrumentId[], instrument: InstrumentId, enabled: boolean): InstrumentId[] {
  const alreadyIncluded = current.includes(instrument);
  if (enabled === alreadyIncluded) {
    return current;
  }

  const next = enabled ? [...current, instrument] : current.filter((item) => item !== instrument);
  return INSTRUMENT_IDS.filter((candidate) => next.includes(candidate));
}

function mergeSelectedInstrumentEvents(
  basePattern: GeneratedPattern,
  nextPattern: GeneratedPattern,
  instruments: InstrumentId[],
): GeneratedPattern {
  if (instruments.length === 0) {
    return basePattern;
  }

  const mergedEvents = { ...basePattern.events };
  for (const instrument of instruments) {
    mergedEvents[instrument] = sortPatternEvents([...(nextPattern.events[instrument] ?? [])]);
  }

  return {
    ...basePattern,
    events: mergedEvents,
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function scaledHumanizeAmount(value: number, maximum = 24, exponent = 1.5): number {
  const clamped = clampNumber(value, 0, maximum);
  if (clamped === 0 || maximum <= 0) {
    return 0;
  }

  const normalized = clamped / maximum;
  return Math.round(maximum * (normalized ** exponent));
}

function timingFeelBiasAmount(baseTimingAmount: number): number {
  return clampNumber(4 + Math.round(baseTimingAmount * 0.25), 4, 8);
}

function timingOffsetLimit(baseTimingAmount: number): number {
  const biasAmount = timingFeelBiasAmount(baseTimingAmount);
  return clampNumber(Math.max(8, baseTimingAmount + biasAmount), 8, 24);
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function deterministicRangeValue(key: string, minimum: number, maximum: number): number {
  if (maximum <= minimum) {
    return minimum;
  }

  return minimum + (hashString(key) % (maximum - minimum + 1));
}

function eventIdentity(event: PatternEvent): string {
  return `${event.bar}:${event.slot}:${event.hit_type}:${event.source}`;
}

function timingFeelBiasForEvent(feel: TimingFeelValue | undefined, baseTimingAmount: number, event: PatternEvent): number {
  if (!feel || feel === "neutral") {
    return 0;
  }

  const biasAmount = timingFeelBiasAmount(baseTimingAmount);
  if (feel === "push") {
    return -biasAmount;
  }
  if (feel === "drag") {
    return biasAmount;
  }

  return deterministicRangeValue(`timing:${eventIdentity(event)}`, -biasAmount, biasAmount);
}

function defaultVelocityPriority(hitType: PatternEvent["hit_type"]): number {
  if (hitType === "accent") {
    return 0.94;
  }
  if (hitType === "ghost") {
    return 0.28;
  }
  return 0.72;
}

function classifyInstrumentChange(
  instrument: InstrumentId,
  previous: InstrumentControlSnapshot,
  next: InstrumentControlSnapshot,
): { structural: boolean; executive: boolean } {
  if (instrument === "kick" || instrument === "snare") {
    return {
      structural:
        previous.enabled !== next.enabled ||
        previous.density !== next.density ||
        previous.syncopation !== next.syncopation,
      executive:
        previous.timingFeel !== next.timingFeel ||
        previous.velocityMin !== next.velocityMin ||
        previous.velocityMax !== next.velocityMax,
    };
  }

  if (instrument === "hihat_closed" || instrument === "ride") {
    return {
      structural:
        previous.enabled !== next.enabled ||
        previous.division !== next.division ||
        previous.space !== next.space,
      executive:
        previous.timingFeel !== next.timingFeel ||
        previous.velocityMin !== next.velocityMin ||
        previous.velocityMax !== next.velocityMax,
    };
  }

  if (instrument === "hihat_open" || instrument === "crash") {
    return {
      structural: previous.enabled !== next.enabled || previous.density !== next.density,
      executive: previous.velocityMin !== next.velocityMin || previous.velocityMax !== next.velocityMax,
    };
  }

  return {
    structural: previous.tomHits !== next.tomHits,
    executive: previous.velocityMin !== next.velocityMin || previous.velocityMax !== next.velocityMax,
  };
}

function applyExecutiveUpdateToPattern(
  pattern: GeneratedPattern,
  instrument: InstrumentId,
  previousSnapshot: InstrumentControlSnapshot,
  nextSnapshot: InstrumentControlSnapshot,
  humanizeTiming: number,
): GeneratedPattern {
  const events = pattern.events[instrument] ?? [];
  const baseTimingAmount = scaledHumanizeAmount(humanizeTiming);
  const offsetLimit = timingOffsetLimit(baseTimingAmount);

  const nextEvents = events.map((event) => {
    if (event.hit_type === "ghost") {
      return event;
    }

    let nextVelocity = event.velocity;
    const previousVelocitySpan = previousSnapshot.velocityMax - previousSnapshot.velocityMin;
    const normalizedPriority =
      previousVelocitySpan > 0
        ? (event.velocity - previousSnapshot.velocityMin) / previousVelocitySpan
        : defaultVelocityPriority(event.hit_type);
    const clampedPriority = clampNumber(normalizedPriority, 0, 1);
    nextVelocity = Math.round(
      nextSnapshot.velocityMin + (nextSnapshot.velocityMax - nextSnapshot.velocityMin) * clampedPriority,
    );
    nextVelocity = clampNumber(nextVelocity, 1, 127);

    const previousBias = timingFeelBiasForEvent(previousSnapshot.timingFeel, baseTimingAmount, event);
    const nextBias = timingFeelBiasForEvent(nextSnapshot.timingFeel, baseTimingAmount, event);
    const baseOffset = event.offset - previousBias;
    const nextOffset = clampNumber(baseOffset + nextBias, -offsetLimit, offsetLimit);

    return {
      ...event,
      velocity: nextVelocity,
      offset: nextOffset,
    };
  });

  return {
    ...pattern,
    events: {
      ...pattern.events,
      [instrument]: sortPatternEvents(nextEvents),
    },
  };
}

function normalizeGrouping(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function groupingError(value: string): string {
  const normalized = normalizeGrouping(value);

  if (!normalized) {
    return "Beat Grouping is required.";
  }

  const parts = normalized.split("+");
  if (parts.some((part) => !/^[1-4]$/.test(part))) {
    return "Use integers 1, 2, 3, or 4 separated by '+'.";
  }

  return "";
}

function timeSignatureFromGrouping(value: string): string {
  if (groupingError(value)) {
    return "-";
  }

  const numerator = normalizeGrouping(value)
    .split("+")
    .reduce((sum, part) => sum + Number(part), 0);

  return `${numerator}/4`;
}

function numeratorFromGrouping(value: string): number | null {
  if (groupingError(value)) {
    return null;
  }

  return normalizeGrouping(value)
    .split("+")
    .reduce((sum, part) => sum + Number(part), 0);
}

function groupingCombinationsForTotal(total: number): string[] {
  if (total === 0) {
    return [""];
  }

  const combinations: string[] = [];
  for (let part = 1; part <= 4; part += 1) {
    if (part > total) {
      break;
    }
    for (const suffix of groupingCombinationsForTotal(total - part)) {
      combinations.push(suffix ? `${part}+${suffix}` : `${part}`);
    }
  }
  return combinations;
}

function randomGroupingValue(rng: () => number): string {
  const total = Math.floor(rng() * 8) + 3;
  const combinations = groupingCombinationsForTotal(total);
  return combinations[Math.floor(rng() * combinations.length)] ?? "4";
}

function hitPriority(hitType: PatternEvent["hit_type"]): number {
  if (hitType === "accent") {
    return 0;
  }
  if (hitType === "main") {
    return 1;
  }
  return 2;
}

function sortPatternEvents(events: PatternEvent[]): PatternEvent[] {
  return [...events].sort((left, right) => {
    if (left.bar !== right.bar) {
      return left.bar - right.bar;
    }
    if (left.slot !== right.slot) {
      return left.slot - right.slot;
    }
    return hitPriority(left.hit_type) - hitPriority(right.hit_type);
  });
}

function mergeLockedInstrumentEvents(
  currentPattern: GeneratedPattern | null,
  nextPattern: GeneratedPattern,
  lockedInstruments: string[],
): GeneratedPattern {
  if (!currentPattern || lockedInstruments.length === 0) {
    return nextPattern;
  }

  const mergedEvents = { ...nextPattern.events };
  for (const instrument of lockedInstruments) {
    const preservedVisibleHits = (currentPattern.events[instrument] ?? []).filter((event) => event.hit_type !== "ghost");
    const regeneratedGhostHits = (nextPattern.events[instrument] ?? []).filter((event) => event.hit_type === "ghost");
    mergedEvents[instrument] = sortPatternEvents([...preservedVisibleHits, ...regeneratedGhostHits]);
  }

  return {
    ...nextPattern,
    events: mergedEvents,
  };
}

function buildGridRows(pattern: GeneratedPattern) {
  const fillLookup = new Set(pattern.fill_regions.flatMap((region) => region.slots.map((slot) => `${region.bar}:${slot}`)));

  return pattern.instrument_order.map((instrument) => {
    const cellMap = new Map<string, PatternEvent>();
    for (const event of pattern.events[instrument] ?? []) {
      const key = `${event.bar}:${event.slot}`;
      const existing = cellMap.get(key);
      if (!existing || hitPriority(event.hit_type) < hitPriority(existing.hit_type)) {
        cellMap.set(key, event);
      }
    }

    const bars = Array.from({ length: pattern.meta.bars }, (_, barIndex) =>
      Array.from({ length: pattern.meta.slots_per_bar }, (_, slotIndex) => {
        const key = `${barIndex}:${slotIndex}`;
        return {
          event: cellMap.get(key) ?? null,
          fillActive: fillLookup.has(key),
        };
      }),
    );

    return {
      instrument,
      label: INSTRUMENT_LABELS[instrument] ?? instrument,
      bars,
    };
  });
}

function patternHasEvents(pattern: GeneratedPattern): boolean {
  return pattern.instrument_order.some((instrument) => (pattern.events[instrument] ?? []).length > 0);
}

function createEmptyPattern(input: {
  bpm: number;
  bars: number;
  grouping: string;
  swing: number;
  humanizeTiming: number;
  humanizeVelocity: number;
}): GeneratedPattern {
  const normalizedGrouping = normalizeGrouping(input.grouping);
  const numerator = numeratorFromGrouping(normalizedGrouping) ?? 4;

  return {
    pattern_version: 1,
    meta: {
      bpm: input.bpm,
      bars: input.bars,
      grouping: normalizedGrouping,
      slots_per_bar: numerator * 8,
      swing: input.swing,
      humanize_timing: input.humanizeTiming,
      humanize_velocity: input.humanizeVelocity,
    },
    instrument_order: [...PLACEHOLDER_GRID_INSTRUMENTS],
    events: Object.fromEntries(PLACEHOLDER_GRID_INSTRUMENTS.map((instrument) => [instrument, []])),
    fill_regions: [],
  };
}

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M5 7V5.5a3 3 0 1 1 6 0V7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 7V5.5a3 3 0 0 1 5.1-2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function velocityColor(velocity: number): string {
  const clamped = Math.max(1, Math.min(127, velocity));
  const mutedGreen = { h: 145, s: 10, l: 34 };
  const activeGreen = { h: 180, s: 52, l: 55 };
  const vividViolet = { h: 271, s: 92, l: 70 };
  const brightViolet = { h: 278, s: 96, l: 74 };
  let from = mutedGreen;
  let to = activeGreen;
  let localT = 0;

  if (clamped <= 84) {
    localT = (clamped - 1) / 83;
    localT = localT * localT * (3 - 2 * localT);
  } else if (clamped <= 100) {
    from = activeGreen;
    to = vividViolet;
    localT = (clamped - 85) / 15;
  } else {
    from = vividViolet;
    to = brightViolet;
    localT = (clamped - 101) / 26;
  }

  const hue =
    Math.abs(to.h - from.h) > 180 && to.h > from.h
      ? from.h + (((to.h - 360) - from.h) * localT)
      : Math.abs(to.h - from.h) > 180
        ? from.h + ((to.h - (from.h - 360)) * localT)
        : from.h + (to.h - from.h) * localT;
  const saturation = from.s + (to.s - from.s) * localT;
  const lightness = from.l + (to.l - from.l) * localT;
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs((2 * lightness) / 100 - 1)) * (saturation / 100);
  const sector = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = lightness / 100 - chroma / 2;
  let redPrime = 0;
  let greenPrime = 0;
  let bluePrime = 0;

  if (sector >= 0 && sector < 1) {
    redPrime = chroma;
    greenPrime = x;
  } else if (sector < 2) {
    redPrime = x;
    greenPrime = chroma;
  } else if (sector < 3) {
    greenPrime = chroma;
    bluePrime = x;
  } else if (sector < 4) {
    greenPrime = x;
    bluePrime = chroma;
  } else if (sector < 5) {
    redPrime = x;
    bluePrime = chroma;
  } else {
    redPrime = chroma;
    bluePrime = x;
  }

  const r = Math.round((redPrime + match) * 255);
  const g = Math.round((greenPrime + match) * 255);
  const b = Math.round((bluePrime + match) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapToStep(value: number, min: number, step: number): number {
  const steps = Math.round((value - min) / step);
  return Number((min + steps * step).toFixed(4));
}

function formatKnobValue(value: number): string {
  return value.toFixed(2);
}

type KnobControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

function KnobControl({ label, value, min, max, step, onChange }: KnobControlProps) {
  const dragStateRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null);
  const normalized = (value - min) / (max - min);
  const angle = -135 + normalized * 270;

  function commitValue(nextValue: number) {
    onChange(snapToStep(clampValue(nextValue, min, max), min, step));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startValue: value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaY = dragState.startY - event.clientY;
    const sensitivity = (max - min) / 140;
    commitValue(dragState.startValue + deltaY * sensitivity);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      commitValue(value + step);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      commitValue(value - step);
      return;
    }

    if (event.key === "PageUp") {
      event.preventDefault();
      commitValue(value + step * 5);
      return;
    }

    if (event.key === "PageDown") {
      event.preventDefault();
      commitValue(value - step * 5);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      commitValue(min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      commitValue(max);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.deltaY < 0) {
      commitValue(value + step);
      return;
    }

    if (event.deltaY > 0) {
      commitValue(value - step);
    }
  }

  return (
    <div className="knob-control">
      <div className="knob-control-head">
        <span>{label}</span>
        <output className="knob-control-readout">{formatKnobValue(value)}</output>
      </div>

      <div
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatKnobValue(value)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => {
          dragStateRef.current = null;
        }}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
      >
        <div className="knob-face">
          <span className="knob-indicator" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
          <span className="knob-value">{formatKnobValue(value)}</span>
        </div>
      </div>
    </div>
  );
}

type SteppedSliderOption = {
  value: number | string;
  label: string;
};

type SteppedSliderControlProps = {
  label: string;
  value: number | string;
  options: SteppedSliderOption[];
  onChange: (value: number | string) => void;
};

function SteppedSliderControl({ label, value, options, onChange }: SteppedSliderControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const activeOption = options[activeIndex] ?? options[0];
  const handlePercent = options.length > 1 ? (activeIndex / (options.length - 1)) * 100 : 0;

  function valueFromClientX(clientX: number): number | string {
    const track = trackRef.current;
    if (!track) {
      return activeOption.value;
    }

    const rect = track.getBoundingClientRect();
    const ratio = clampValue((clientX - rect.left) / rect.width, 0, 1);
    const index = Math.round(ratio * (options.length - 1));
    return options[index]?.value ?? activeOption.value;
  }

  function commitFromClientX(clientX: number) {
    onChange(valueFromClientX(clientX));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    commitFromClientX(event.clientX);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    commitFromClientX(event.clientX);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current === event.pointerId) {
      dragPointerIdRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(options[Math.min(activeIndex + 1, options.length - 1)]?.value ?? activeOption.value);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(options[Math.max(activeIndex - 1, 0)]?.value ?? activeOption.value);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(options[0]?.value ?? activeOption.value);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(options[options.length - 1]?.value ?? activeOption.value);
    }
  }

  return (
    <div className="field">
      <div className="plugin-control-head">
        <span>{label}</span>
        <output className="plugin-control-readout">
          {typeof activeOption.value === "number" ? (
            <>
              <span className="plugin-control-readout-index">{String(activeOption.value)}</span>
              <span className="plugin-control-readout-label">{activeOption.label.replace(/^\d+\s*/, "").toLowerCase()}</span>
            </>
          ) : (
            <span className="plugin-control-readout-label plugin-control-readout-label-standalone">
              {activeOption.label.toLowerCase()}
            </span>
          )}
        </output>
      </div>

      <div
        ref={trackRef}
        className="stepped-slider"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(options.length - 1, 0)}
        aria-valuenow={activeIndex}
        aria-valuetext={activeOption.label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => {
          dragPointerIdRef.current = null;
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="stepped-slider-track">
          <div className="stepped-slider-fill" style={{ width: `${handlePercent}%` }} />
          {options.map((option, index) => {
            const tickPercent = options.length > 1 ? (index / (options.length - 1)) * 100 : 0;
            const isActive = index <= activeIndex;

            return (
              <button
                key={option.value}
                type="button"
                className={option.value === activeOption.value ? "stepped-slider-tick stepped-slider-tick-active" : "stepped-slider-tick"}
                style={{ left: `${tickPercent}%` }}
                aria-label={option.label}
                aria-pressed={option.value === activeOption.value}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(option.value);
                }}
                data-filled={isActive ? "true" : "false"}
              />
            );
          })}
          <div className="stepped-slider-handle" style={{ left: `${handlePercent}%` }} />
        </div>
      </div>
    </div>
  );
}

type HandleOptionSliderControlProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string; slot?: number }[];
  onChange: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  slotCount?: number;
  disabled?: boolean;
  showValueInHandle?: boolean;
  className?: string;
};

function HandleOptionSliderControl({
  label,
  value,
  options,
  onChange,
  orientation = "horizontal",
  slotCount,
  disabled = false,
  showValueInHandle = false,
  className = "",
}: HandleOptionSliderControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const activeOption = options[activeIndex] ?? options[0];
  const totalSlots = Math.max(slotCount ?? options.length, 1);

  function optionSlot(option: (typeof options)[number], index: number): number {
    return Math.min(Math.max(option.slot ?? index, 0), totalSlots - 1);
  }

  const activeSlot = optionSlot(activeOption, activeIndex);
  const handlePercent = totalSlots > 1 ? (activeSlot / (totalSlots - 1)) * 100 : 0;

  function nearestOptionBySlot(slotValue: number): string {
    let nearest = activeOption;
    let nearestDistance = Number.POSITIVE_INFINITY;

    options.forEach((option, index) => {
      const distance = Math.abs(optionSlot(option, index) - slotValue);
      if (distance < nearestDistance) {
        nearest = option;
        nearestDistance = distance;
      }
    });

    return nearest.value;
  }

  function valueFromClientX(clientX: number): string {
    const track = trackRef.current;
    if (!track) {
      return activeOption.value;
    }

    const rect = track.getBoundingClientRect();
    const ratio = clampValue((clientX - rect.left) / rect.width, 0, 1);
    const slotValue = Math.round(ratio * (totalSlots - 1));
    return nearestOptionBySlot(slotValue);
  }

  function valueFromClientY(clientY: number): string {
    const track = trackRef.current;
    if (!track) {
      return activeOption.value;
    }

    const rect = track.getBoundingClientRect();
    const ratio = clampValue((rect.bottom - clientY) / rect.height, 0, 1);
    const slotValue = Math.round(ratio * (totalSlots - 1));
    return nearestOptionBySlot(slotValue);
  }

  function commitFromPointer(clientX: number, clientY: number) {
    if (disabled) {
      return;
    }
    onChange(orientation === "vertical" ? valueFromClientY(clientY) : valueFromClientX(clientX));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    commitFromPointer(event.clientX, event.clientY);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }
    if (event.pointerType === "mouse" && event.buttons === 0) {
      dragPointerIdRef.current = null;
      return;
    }

    commitFromPointer(event.clientX, event.clientY);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current === event.pointerId) {
      dragPointerIdRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(options[Math.min(activeIndex + 1, options.length - 1)]?.value ?? activeOption.value);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(options[Math.max(activeIndex - 1, 0)]?.value ?? activeOption.value);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(options[0]?.value ?? activeOption.value);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(options[options.length - 1]?.value ?? activeOption.value);
    }
  }

  return (
    <div className={className ? `field ${className}` : "field"}>
      <div className="plugin-control-head">
        <span>{label}</span>
      </div>

      <div
        ref={trackRef}
        className={orientation === "vertical" ? "handle-option-slider handle-option-slider-vertical" : "handle-option-slider"}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(totalSlots - 1, 0)}
        aria-valuenow={activeSlot}
        aria-valuetext={activeOption.label}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => {
          dragPointerIdRef.current = null;
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="handle-option-slider-track">
          <div
            className="handle-option-slider-fill"
            style={orientation === "vertical" ? { height: `${handlePercent}%` } : { width: `${handlePercent}%` }}
          />
          {options.map((option, index) => {
            const tickPercent = totalSlots > 1 ? (optionSlot(option, index) / (totalSlots - 1)) * 100 : 0;

            return (
              <button
                key={option.value}
                type="button"
                className={option.value === activeOption.value ? "handle-option-slider-tick handle-option-slider-tick-active" : "handle-option-slider-tick"}
                style={orientation === "vertical" ? { bottom: `${tickPercent}%` } : { left: `${tickPercent}%` }}
                aria-label={option.label}
                aria-pressed={option.value === activeOption.value}
                disabled={disabled}
                onClick={(event) => {
                  if (disabled) {
                    return;
                  }
                  event.stopPropagation();
                  onChange(option.value);
                }}
              />
            );
          })}
          <div
            className={orientation === "vertical" ? "handle-option-slider-handle handle-option-slider-handle-vertical" : "handle-option-slider-handle"}
            style={orientation === "vertical" ? { bottom: `${handlePercent}%` } : { left: `${handlePercent}%` }}
          >
            <span>{showValueInHandle ? activeOption.value : activeOption.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type ContinuousSliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  showValueInHandle?: boolean;
  enableWheel?: boolean;
};

function ContinuousSliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  showValueInHandle = false,
  enableWheel = false,
}: ContinuousSliderControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;

  function valueFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track) {
      return value;
    }

    const rect = track.getBoundingClientRect();
    const ratio = clampValue((clientX - rect.left) / rect.width, 0, 1);
    const rawValue = min + ratio * (max - min);
    return snapToStep(clampValue(rawValue, min, max), min, step);
  }

  function commitFromClientX(clientX: number) {
    onChange(valueFromClientX(clientX));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    commitFromClientX(event.clientX);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    commitFromClientX(event.clientX);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current === event.pointerId) {
      dragPointerIdRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(snapToStep(clampValue(value + step, min, max), min, step));
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(snapToStep(clampValue(value - step, min, max), min, step));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!enableWheel || event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    onChange(snapToStep(clampValue(value + direction * step, min, max), min, step));
  }

  return (
    <div className="field">
      <div className="plugin-control-head">
        <span>{label}</span>
        {showValueInHandle ? null : (
          <output className="plugin-control-readout">
            <span className="plugin-control-readout-index">{formatKnobValue(value)}</span>
          </output>
        )}
      </div>

      <div
        ref={trackRef}
        className="continuous-slider"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatKnobValue(value)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => {
          dragPointerIdRef.current = null;
        }}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
      >
        <div className="continuous-slider-track">
          <div className="continuous-slider-fill" style={{ width: `${percent}%` }} />
          <div className={showValueInHandle ? "continuous-slider-handle continuous-slider-handle-valued" : "continuous-slider-handle"} style={{ left: `${percent}%` }}>
            {showValueInHandle ? <span>{Math.round(value)}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type TimingFeelControlProps = {
  value: (typeof TIMING_FEEL_OPTIONS)[number]["value"];
  onChange: (value: (typeof TIMING_FEEL_OPTIONS)[number]["value"]) => void;
  ariaLabel?: string;
  className?: string;
  options?: readonly {
    value: (typeof TIMING_FEEL_OPTIONS)[number]["value"];
    label: string;
    shape: string;
  }[];
};

const TIMING_FEEL_VISUAL_OPTIONS = [
  { value: "push", label: "Push", shape: "left" },
  { value: "drag", label: "Drag", shape: "right" },
  { value: "neutral", label: "Neutral", shape: "center" },
  { value: "random", label: "Random", shape: "center random" },
] as const;

function TimingFeelControl({
  value,
  onChange,
  ariaLabel = "Timing feel",
  className = "",
  options = TIMING_FEEL_VISUAL_OPTIONS,
}: TimingFeelControlProps) {
  return (
    <div className="field">
      <div className="plugin-control-head">
        <span>Timing Feel</span>
      </div>

      <div className={className ? `timing-feel-control ${className}` : "timing-feel-control"} role="group" aria-label={ariaLabel}>
        {options.map((option) => {
          const isActive = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              className={isActive ? `timing-feel-button timing-feel-button-${option.shape} timing-feel-button-active` : `timing-feel-button timing-feel-button-${option.shape}`}
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
            >
              <span className="timing-feel-button-label">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type VelocityRangeControlProps = {
  label: string;
  minValue: number;
  maxValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (nextMin: number, nextMax: number) => void;
};

function VelocityRangeControl({ label, minValue, maxValue, min, max, step, onChange }: VelocityRangeControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<"min" | "max" | null>(null);
  const range = max - min;
  const minPercent = range > 0 ? ((minValue - min) / range) * 100 : 0;
  const maxPercent = range > 0 ? ((maxValue - min) / range) * 100 : 100;

  function snapClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track) {
      return minValue;
    }

    const rect = track.getBoundingClientRect();
    const ratio = clampValue((clientX - rect.left) / rect.width, 0, 1);
    const rawValue = min + ratio * range;
    return snapToStep(clampValue(rawValue, min, max), min, step);
  }

  function commit(handle: "min" | "max", nextValue: number) {
    if (handle === "min") {
      onChange(clampValue(nextValue, min, maxValue), maxValue);
      return;
    }

    onChange(minValue, clampValue(nextValue, minValue, max));
  }

  function handleTrackPointerDown(event: PointerEvent<HTMLDivElement>) {
    const nextValue = snapClientX(event.clientX);
    const distanceToMin = Math.abs(nextValue - minValue);
    const distanceToMax = Math.abs(nextValue - maxValue);
    const targetHandle = distanceToMin <= distanceToMax ? "min" : "max";

    dragHandleRef.current = targetHandle;
    event.currentTarget.setPointerCapture(event.pointerId);
    commit(targetHandle, nextValue);
  }

  function handleTrackPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragHandleRef.current) {
      return;
    }

    commit(dragHandleRef.current, snapClientX(event.clientX));
  }

  function handleTrackPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragHandleRef.current) {
      dragHandleRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleHandleKeyDown(handle: "min" | "max", event: KeyboardEvent<HTMLButtonElement>) {
    const currentValue = handle === "min" ? minValue : maxValue;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      commit(handle, currentValue + step);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      commit(handle, currentValue - step);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      commit(handle, handle === "min" ? min : minValue);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      commit(handle, handle === "min" ? maxValue : max);
    }
  }

  return (
    <div className="field">
      <div className="velocity-range">
        <div
          ref={trackRef}
          className="velocity-range-slider"
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
          onLostPointerCapture={() => {
            dragHandleRef.current = null;
          }}
        >
          <div className="velocity-range-track" />
          <div
            className="velocity-range-active"
            style={{ left: `${minPercent}%`, width: `${Math.max(maxPercent - minPercent, 0)}%` }}
          />

          <button
            type="button"
            className="velocity-range-handle velocity-range-handle-min"
            style={{ left: `${minPercent}%` }}
            role="slider"
            aria-label={`${label} minimum`}
            aria-valuemin={min}
            aria-valuemax={maxValue}
            aria-valuenow={minValue}
            aria-valuetext={`Min ${minValue}`}
            onKeyDown={(event) => handleHandleKeyDown("min", event)}
          />

          <button
            type="button"
            className="velocity-range-handle velocity-range-handle-max"
            style={{ left: `${maxPercent}%` }}
            role="slider"
            aria-label={`${label} maximum`}
            aria-valuemin={minValue}
            aria-valuemax={max}
            aria-valuenow={maxValue}
            aria-valuetext={`Max ${maxValue}`}
            onKeyDown={(event) => handleHandleKeyDown("max", event)}
          />
        </div>

        <div className="velocity-range-values" aria-hidden="true">
          <span>Min {minValue}</span>
          <span>{label}</span>
          <span>Max {maxValue}</span>
        </div>
      </div>
    </div>
  );
}

type VerticalSliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  showValueInHandle?: boolean;
};

function VerticalSliderControl({ label, value, min, max, step, onChange, showValueInHandle = false }: VerticalSliderControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const range = max - min;
  const handlePercent = range > 0 ? ((value - min) / range) * 100 : 0;

  function valueFromClientY(clientY: number): number {
    const track = trackRef.current;
    if (!track) {
      return value;
    }

    const rect = track.getBoundingClientRect();
    const ratio = clampValue((rect.bottom - clientY) / rect.height, 0, 1);
    const rawValue = min + ratio * range;
    return snapToStep(clampValue(rawValue, min, max), min, step);
  }

  function commitFromClientY(clientY: number) {
    onChange(valueFromClientY(clientY));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    commitFromClientY(event.clientY);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    commitFromClientY(event.clientY);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current === event.pointerId) {
      dragPointerIdRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      onChange(snapToStep(clampValue(value + step, min, max), min, step));
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(snapToStep(clampValue(value - step, min, max), min, step));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
  }

  return (
    <div className="vertical-slider-control">
      <div
        ref={trackRef}
        className="vertical-slider"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${label} ${value}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => {
          dragPointerIdRef.current = null;
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="vertical-slider-track">
          <div className="vertical-slider-fill" style={{ height: `${handlePercent}%` }} />
          <div
            className={showValueInHandle ? "vertical-slider-handle vertical-slider-handle-valued" : "vertical-slider-handle"}
            style={{ bottom: `${handlePercent}%` }}
          >
            {showValueInHandle ? <span>{value}</span> : null}
          </div>
        </div>
      </div>

      <div className="vertical-slider-meta">
        <span className="vertical-slider-value">{value}</span>
        <span className="vertical-slider-label">{label}</span>
      </div>
    </div>
  );
}

type GhostPlacementControlProps = {
  value: (typeof GHOST_PLACEMENT_OPTIONS)[number]["value"];
  onChange: (value: (typeof GHOST_PLACEMENT_OPTIONS)[number]["value"]) => void;
  ariaLabel?: string;
};

const GHOST_PLACEMENT_VISUAL_OPTIONS = [
  { value: "before", label: "Before", shape: "left" },
  { value: "both", label: "Both", shape: "center" },
  { value: "after", label: "After", shape: "right" },
] as const;

function GhostPlacementControl({ value, onChange, ariaLabel = "Ghost placement" }: GhostPlacementControlProps) {
  return (
    <div className="field">
      <div className="ghost-placement-control" role="group" aria-label={ariaLabel}>
        {GHOST_PLACEMENT_VISUAL_OPTIONS.map((option) => {
          const isActive = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              className={
                isActive
                  ? `timing-feel-button timing-feel-button-${option.shape} timing-feel-button-active`
                  : `timing-feel-button timing-feel-button-${option.shape}`
              }
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
            >
              <span className="timing-feel-button-label">{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="plugin-control-head ghost-placement-head">
        <span>Placement</span>
      </div>
    </div>
  );
}

function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(CUSTOM_PRESET_ID);
  const [bpm, setBpm] = useState(120);
  const [seed, setSeed] = useState<number | "random">("random");
  const [bars, setBars] = useState(1);
  const [grouping, setGrouping] = useState("4");
  const [groupingInput, setGroupingInput] = useState("4");
  const [swing, setSwing] = useState(0);
  const [humanizeTiming, setHumanizeTiming] = useState(6);
  const [humanizeVelocity, setHumanizeVelocity] = useState(6);
  const [barSimilarity, setBarSimilarity] = useState(0.7);
  const [fillIntensity, setFillIntensity] = useState<"off" | "low" | "medium" | "high">("off");
  const [fillLength, setFillLength] = useState<"short" | "medium" | "long">("medium");
  const [fillEvery, setFillEvery] = useState(2);
  const [kickEnabled, setKickEnabled] = useState(DEFAULT_KICK.enabled);
  const [kickDensity, setKickDensity] = useState(DEFAULT_KICK.density);
  const [kickSyncopation, setKickSyncopation] = useState(DEFAULT_KICK.syncopation);
  const [kickTimingFeel, setKickTimingFeel] = useState<(typeof TIMING_FEEL_OPTIONS)[number]["value"]>(
    DEFAULT_KICK.timingFeel,
  );
  const [kickVelocityMin, setKickVelocityMin] = useState(DEFAULT_KICK.velocityMin);
  const [kickVelocityMax, setKickVelocityMax] = useState(DEFAULT_KICK.velocityMax);
  const [snareEnabled, setSnareEnabled] = useState(DEFAULT_SNARE.enabled);
  const [snareDensity, setSnareDensity] = useState(DEFAULT_SNARE.density);
  const [snareSyncopation, setSnareSyncopation] = useState(DEFAULT_SNARE.syncopation);
  const [snareTimingFeel, setSnareTimingFeel] = useState<(typeof TIMING_FEEL_OPTIONS)[number]["value"]>(
    DEFAULT_SNARE.timingFeel,
  );
  const [snareVelocityMin, setSnareVelocityMin] = useState(DEFAULT_SNARE.velocityMin);
  const [snareVelocityMax, setSnareVelocityMax] = useState(DEFAULT_SNARE.velocityMax);
  const [snareGhostEnabled, setSnareGhostEnabled] = useState(DEFAULT_SNARE.ghost.enabled);
  const [snareGhostDensity, setSnareGhostDensity] = useState(DEFAULT_SNARE.ghost.density);
  const [snareGhostVelocity, setSnareGhostVelocity] = useState(DEFAULT_SNARE.ghost.velocity);
  const [snareGhostPlacement, setSnareGhostPlacement] = useState<(typeof GHOST_PLACEMENT_OPTIONS)[number]["value"]>(
    DEFAULT_SNARE.ghost.placement,
  );
  const [hihatClosedEnabled, setHihatClosedEnabled] = useState(DEFAULT_HIHAT_CLOSED.enabled);
  const [hihatClosedDivision, setHihatClosedDivision] = useState<(typeof DIVISION_OPTIONS)[number]["value"]>(
    DEFAULT_HIHAT_CLOSED.division,
  );
  const [hihatClosedSpace, setHihatClosedSpace] = useState(DEFAULT_HIHAT_CLOSED.space);
  const [hihatClosedTimingFeel, setHihatClosedTimingFeel] = useState<(typeof TIMING_FEEL_OPTIONS)[number]["value"]>(
    DEFAULT_HIHAT_CLOSED.timingFeel,
  );
  const [hihatClosedVelocityMin, setHihatClosedVelocityMin] = useState(DEFAULT_HIHAT_CLOSED.velocityMin);
  const [hihatClosedVelocityMax, setHihatClosedVelocityMax] = useState(DEFAULT_HIHAT_CLOSED.velocityMax);
  const [hihatClosedGhostEnabled, setHihatClosedGhostEnabled] = useState(DEFAULT_HIHAT_CLOSED.ghost.enabled);
  const [hihatClosedGhostDensity, setHihatClosedGhostDensity] = useState(DEFAULT_HIHAT_CLOSED.ghost.density);
  const [hihatClosedGhostVelocity, setHihatClosedGhostVelocity] = useState(DEFAULT_HIHAT_CLOSED.ghost.velocity);
  const [hihatClosedGhostPlacement, setHihatClosedGhostPlacement] = useState<
    (typeof GHOST_PLACEMENT_OPTIONS)[number]["value"]
  >(DEFAULT_HIHAT_CLOSED.ghost.placement);
  const [rideEnabled, setRideEnabled] = useState(DEFAULT_RIDE.enabled);
  const [rideDivision, setRideDivision] = useState<(typeof DIVISION_OPTIONS)[number]["value"]>(
    DEFAULT_RIDE.division,
  );
  const [rideSpace, setRideSpace] = useState(DEFAULT_RIDE.space);
  const [rideTimingFeel, setRideTimingFeel] = useState<(typeof TIMING_FEEL_OPTIONS)[number]["value"]>(
    DEFAULT_RIDE.timingFeel,
  );
  const [rideVelocityMin, setRideVelocityMin] = useState(DEFAULT_RIDE.velocityMin);
  const [rideVelocityMax, setRideVelocityMax] = useState(DEFAULT_RIDE.velocityMax);
  const [rideGhostEnabled, setRideGhostEnabled] = useState(DEFAULT_RIDE.ghost.enabled);
  const [rideGhostDensity, setRideGhostDensity] = useState(DEFAULT_RIDE.ghost.density);
  const [rideGhostVelocity, setRideGhostVelocity] = useState(DEFAULT_RIDE.ghost.velocity);
  const [rideGhostPlacement, setRideGhostPlacement] = useState<(typeof GHOST_PLACEMENT_OPTIONS)[number]["value"]>(
    DEFAULT_RIDE.ghost.placement,
  );
  const [hihatOpenEnabled, setHihatOpenEnabled] = useState(DEFAULT_HIHAT_OPEN.enabled);
  const [hihatOpenDensity, setHihatOpenDensity] = useState(DEFAULT_HIHAT_OPEN.density);
  const [hihatOpenVelocityMin, setHihatOpenVelocityMin] = useState(DEFAULT_HIHAT_OPEN.velocityMin);
  const [hihatOpenVelocityMax, setHihatOpenVelocityMax] = useState(DEFAULT_HIHAT_OPEN.velocityMax);
  const [crashEnabled, setCrashEnabled] = useState(DEFAULT_CRASH.enabled);
  const [crashDensity, setCrashDensity] = useState(DEFAULT_CRASH.density);
  const [crashVelocityMin, setCrashVelocityMin] = useState(DEFAULT_CRASH.velocityMin);
  const [crashVelocityMax, setCrashVelocityMax] = useState(DEFAULT_CRASH.velocityMax);
  const [tomsHighHits, setTomsHighHits] = useState(DEFAULT_TOMS.highHits);
  const [tomsMidHits, setTomsMidHits] = useState(DEFAULT_TOMS.midHits);
  const [tomsLowHits, setTomsLowHits] = useState(DEFAULT_TOMS.lowHits);
  const [tomsVelocityMin, setTomsVelocityMin] = useState(DEFAULT_TOMS.velocityMin);
  const [tomsVelocityMax, setTomsVelocityMax] = useState(DEFAULT_TOMS.velocityMax);
  const [pattern, setPattern] = useState<GeneratedPattern>(() =>
    createEmptyPattern({
      bpm: 120,
      bars: 1,
      grouping: "4",
      swing: 0,
      humanizeTiming: 6,
      humanizeVelocity: 6,
    }),
  );
  const [lockedInstruments, setLockedInstruments] = useState<string[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [isGeneratingPattern, setIsGeneratingPattern] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingGhosts, setIsGeneratingGhosts] = useState(false);
  const [isEditingPattern, setIsEditingPattern] = useState(false);
  const [isEditGridEnabled, setIsEditGridEnabled] = useState(true);
  const [isLoopEnabled, setIsLoopEnabled] = useState(true);
  const [playbackStatus, setPlaybackStatus] = useState<"Stopped" | "Playing">("Stopped");
  const [dragState, setDragState] = useState<{
    instrument: string;
    bar: number;
    slot: number;
    hitType: PatternEvent["hit_type"];
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [seedFixedWarningVisible, setSeedFixedWarningVisible] = useState(false);
  const [ghostRerollCount, setGhostRerollCount] = useState(0);
  const [needsRegenerationInstruments, setNeedsRegenerationInstruments] = useState<InstrumentId[]>([]);
  const [pendingRegenerationInstruments, setPendingRegenerationInstruments] = useState<InstrumentId[]>([]);
  const [pendingExecutiveInstruments, setPendingExecutiveInstruments] = useState<InstrumentId[]>([]);
  const [pendingGridEdits, setPendingGridEdits] = useState<PendingGridEdit[]>([]);
  const [pendingStructureChange, setPendingStructureChange] = useState<{
    nextBars: number;
    nextGroupingRaw: string;
  } | null>(null);
  const patternPlayerRef = useRef<PatternPlayer | null>(null);
  const patternRef = useRef(pattern);
  const lastGenerateSignatureRef = useRef<string | null>(null);
  const seedWarningTimeoutRef = useRef<number | null>(null);
  const pendingStructureActionRef = useRef<(() => void) | null>(null);
  const preparedLoopPatternRef = useRef<GeneratedPattern | null>(null);
  const latestInstrumentSnapshotsRef = useRef<Record<InstrumentId, InstrumentControlSnapshot> | null>(null);
  const renderedInstrumentSnapshotsRef = useRef<Record<InstrumentId, InstrumentControlSnapshot> | null>(null);
  const previousInstrumentSnapshotsRef = useRef<Record<InstrumentId, InstrumentControlSnapshot> | null>(null);
  const latestGlobalContextRef = useRef<GlobalGenerationContext | null>(null);
  const renderedGlobalContextRef = useRef<GlobalGenerationContext | null>(null);
  const pendingRegenerationRef = useRef<InstrumentId[]>([]);
  const pendingExecutiveRef = useRef<InstrumentId[]>([]);
  const pendingGridEditsRef = useRef<PendingGridEdit[]>([]);
  const previousLockedInstrumentsRef = useRef<InstrumentId[]>([]);
  const rebuildRequestIdRef = useRef(0);
  const suppressInstrumentSyncRef = useRef(false);

  const currentGroupingError = groupingError(groupingInput);
  const kickVelocityError =
    kickVelocityMax < kickVelocityMin ? "Kick velocity max must be greater than or equal to min." : "";
  const snareVelocityError =
    snareVelocityMax < snareVelocityMin ? "Snare velocity max must be greater than or equal to min." : "";
  const hihatClosedVelocityError =
    hihatClosedVelocityMax < hihatClosedVelocityMin
      ? "Hi-Hat Closed velocity max must be greater than or equal to min."
      : "";
  const rideVelocityError = rideVelocityMax < rideVelocityMin ? "Ride velocity max must be greater than or equal to min." : "";
  const hihatOpenVelocityError =
    hihatOpenVelocityMax < hihatOpenVelocityMin ? "Hi-Hat Open velocity max must be greater than or equal to min." : "";
  const crashVelocityError =
    crashVelocityMax < crashVelocityMin ? "Crash velocity max must be greater than or equal to min." : "";
  const tomsVelocityError =
    tomsVelocityMax < tomsVelocityMin ? "Toms velocity max must be greater than or equal to min." : "";
  const inlineErrors = [
    loadError,
    currentGroupingError,
    kickVelocityError,
    snareVelocityError,
    hihatClosedVelocityError,
    rideVelocityError,
    hihatOpenVelocityError,
    crashVelocityError,
    tomsVelocityError,
    generateError,
  ].filter(Boolean);
  const inlineErrorText = inlineErrors.join(" • ");
  const timeSignature = timeSignatureFromGrouping(groupingInput);
  const gridRows = buildGridRows(pattern);
  const pendingGridEditInstruments = INSTRUMENT_IDS.filter((instrument) =>
    pendingGridEdits.some((edit) => edit.instrument === instrument),
  );
  const currentInstrumentSnapshots = buildCurrentInstrumentSnapshots();
  const currentGlobalContext = buildCurrentGlobalContext();

  useEffect(() => {
    let isMounted = true;

    async function loadPresets() {
      setIsLoadingPresets(true);
      setLoadError("");

      try {
        const loadedPresets = await fetchPresets();

        if (!isMounted) {
          return;
        }

        setPresets(loadedPresets);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : "Failed to load presets.");
      } finally {
        if (isMounted) {
          setIsLoadingPresets(false);
        }
      }
    }

    void loadPresets();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      patternPlayerRef.current?.stop();
      if (seedWarningTimeoutRef.current !== null) {
        window.clearTimeout(seedWarningTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    patternRef.current = pattern;
  }, [pattern]);

  useEffect(() => {
    latestInstrumentSnapshotsRef.current = currentInstrumentSnapshots;
    latestGlobalContextRef.current = currentGlobalContext;
    pendingRegenerationRef.current = pendingRegenerationInstruments;
    pendingExecutiveRef.current = pendingExecutiveInstruments;
    pendingGridEditsRef.current = pendingGridEdits;

    if (!renderedInstrumentSnapshotsRef.current) {
      renderedInstrumentSnapshotsRef.current = currentInstrumentSnapshots;
    }
    if (!previousInstrumentSnapshotsRef.current) {
      previousInstrumentSnapshotsRef.current = currentInstrumentSnapshots;
    }
    if (!renderedGlobalContextRef.current) {
      renderedGlobalContextRef.current = currentGlobalContext;
    }
  }, [
    currentInstrumentSnapshots,
    currentGlobalContext,
    pendingExecutiveInstruments,
    pendingGridEdits,
    pendingRegenerationInstruments,
  ]);

  useEffect(() => {
    if (patternHasEvents(pattern)) {
      return;
    }
    if (
      pattern.meta.bpm === bpm &&
      pattern.meta.swing === swing &&
      pattern.meta.humanize_timing === humanizeTiming &&
      pattern.meta.humanize_velocity === humanizeVelocity
    ) {
      return;
    }

    setPattern((current) => ({
      ...current,
      meta: {
        ...current.meta,
        bpm,
        swing,
        humanize_timing: humanizeTiming,
        humanize_velocity: humanizeVelocity,
      },
    }));
  }, [bpm, humanizeTiming, humanizeVelocity, pattern, swing]);

  useEffect(() => {
    const player = getPatternPlayer();
    player.setLoopBoundaryHandler(() => {
      const preparedPattern = preparedLoopPatternRef.current;
      if (!preparedPattern) {
        return;
      }

      preparedLoopPatternRef.current = null;
      setCommittedPattern(preparedPattern);
      updateRenderedInstrumentSnapshots([
        ...pendingExecutiveRef.current,
        ...pendingRegenerationRef.current,
      ]);
      setPendingGridEdits([]);
      setPendingExecutiveInstruments([]);
      setPendingRegenerationInstruments([]);
      setNeedsRegenerationInstruments((current) =>
        current.filter(
          (instrument) =>
            !pendingExecutiveRef.current.includes(instrument) && !pendingRegenerationRef.current.includes(instrument),
        ),
      );

      return {
        pattern: preparedPattern,
      };
    });

    return () => {
      player.setLoopBoundaryHandler(null);
    };
  }, []);

  useEffect(() => {
    const previousSnapshots = previousInstrumentSnapshotsRef.current;
    const renderedSnapshots = renderedInstrumentSnapshotsRef.current;
    if (!previousSnapshots || !renderedSnapshots) {
      previousInstrumentSnapshotsRef.current = currentInstrumentSnapshots;
      return;
    }
    if (suppressInstrumentSyncRef.current) {
      suppressInstrumentSyncRef.current = false;
      previousInstrumentSnapshotsRef.current = currentInstrumentSnapshots;
      return;
    }

    for (const instrument of INSTRUMENT_IDS) {
      const previousSnapshot = previousSnapshots[instrument];
      const currentSnapshot = currentInstrumentSnapshots[instrument];
      const uiChange = classifyInstrumentChange(instrument, previousSnapshot, currentSnapshot);
      if (!uiChange.structural && !uiChange.executive) {
        continue;
      }
      if (lockedInstruments.includes(instrument)) {
        continue;
      }

      const renderedDiff = classifyInstrumentChange(instrument, renderedSnapshots[instrument], currentSnapshot);
      if (playbackStatus === "Playing") {
        updateQueuedInstrumentState(setPendingRegenerationInstruments, instrument, renderedDiff.structural);
        updateQueuedInstrumentState(setPendingExecutiveInstruments, instrument, renderedDiff.executive);
        continue;
      }

      updateQueuedInstrumentState(setNeedsRegenerationInstruments, instrument, renderedDiff.structural);
      if (renderedDiff.executive) {
        const nextPattern = applyExecutiveUpdates(patternRef.current, [instrument], currentInstrumentSnapshots);
        setCommittedPattern(nextPattern);
        updateRenderedInstrumentSnapshots([instrument], "executive");
      }
    }

    previousInstrumentSnapshotsRef.current = currentInstrumentSnapshots;
  }, [currentInstrumentSnapshots, lockedInstruments, playbackStatus]);

  useEffect(() => {
    const previousLocked = previousLockedInstrumentsRef.current;
    const unlockedInstruments = previousLocked.filter((instrument) => !lockedInstruments.includes(instrument));
    if (unlockedInstruments.length > 0 && renderedInstrumentSnapshotsRef.current) {
      for (const instrument of unlockedInstruments) {
        const renderedDiff = classifyInstrumentChange(
          instrument,
          renderedInstrumentSnapshotsRef.current[instrument],
          currentInstrumentSnapshots[instrument],
        );
        if (playbackStatus === "Playing") {
          updateQueuedInstrumentState(setPendingRegenerationInstruments, instrument, renderedDiff.structural);
          updateQueuedInstrumentState(setPendingExecutiveInstruments, instrument, renderedDiff.executive);
          continue;
        }

        updateQueuedInstrumentState(setNeedsRegenerationInstruments, instrument, renderedDiff.structural);
        if (renderedDiff.executive) {
          const nextPattern = applyExecutiveUpdates(patternRef.current, [instrument], currentInstrumentSnapshots);
          setCommittedPattern(nextPattern);
          updateRenderedInstrumentSnapshots([instrument], "executive");
        }
      }
    }

    const lockedInstrumentIds = INSTRUMENT_IDS.filter((instrument) => lockedInstruments.includes(instrument));
    if (lockedInstrumentIds.length > 0) {
      updateQueuedInstrumentStateMany(setNeedsRegenerationInstruments, lockedInstrumentIds, false);
      updateQueuedInstrumentStateMany(setPendingExecutiveInstruments, lockedInstrumentIds, false);
      updateQueuedInstrumentStateMany(setPendingRegenerationInstruments, lockedInstrumentIds, false);
    }

    previousLockedInstrumentsRef.current = lockedInstrumentIds;
  }, [currentInstrumentSnapshots, lockedInstruments, playbackStatus]);

  useEffect(() => {
    if (playbackStatus !== "Playing") {
      preparedLoopPatternRef.current = null;
      rebuildRequestIdRef.current += 1;
      return;
    }

    const hasQueuedChanges =
      pendingGridEdits.length > 0 || pendingExecutiveInstruments.length > 0 || pendingRegenerationInstruments.length > 0;
    if (!hasQueuedChanges) {
      preparedLoopPatternRef.current = null;
      rebuildRequestIdRef.current += 1;
      return;
    }

    const requestId = rebuildRequestIdRef.current + 1;
    rebuildRequestIdRef.current = requestId;

    async function rebuildLoopPattern() {
      try {
        const nextPattern = await materializeQueuedPattern(
          patternRef.current,
          pendingGridEdits,
          pendingExecutiveInstruments,
          pendingRegenerationInstruments,
          currentInstrumentSnapshots,
        );

        if (requestId !== rebuildRequestIdRef.current) {
          return;
        }

        preparedLoopPatternRef.current = nextPattern;
      } catch (error) {
        if (requestId !== rebuildRequestIdRef.current) {
          return;
        }

        setGenerateError(error instanceof Error ? error.message : "Failed to prepare the next loop.");
      }
    }

    void rebuildLoopPattern();
  }, [
    currentInstrumentSnapshots,
    pendingExecutiveInstruments,
    pendingGridEdits,
    pendingRegenerationInstruments,
    playbackStatus,
  ]);

  useEffect(() => {
    if (!pendingStructureChange) {
      return;
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPendingStructureChange();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [pendingStructureChange, pattern]);

  function getPatternPlayer() {
    if (!patternPlayerRef.current) {
      patternPlayerRef.current = new PatternPlayer();
    }
    return patternPlayerRef.current;
  }

  function stopPlaybackStatefully() {
    patternPlayerRef.current?.stop();
    setPlaybackStatus("Stopped");
  }

  function resetPatternToEmpty(nextBars = bars, nextGrouping = grouping) {
    const nextPattern = createEmptyPattern({
      bpm,
      bars: nextBars,
      grouping: nextGrouping,
      swing,
      humanizeTiming,
      humanizeVelocity,
    });
    setCommittedPattern(nextPattern);
    clearQueuedLoopChanges();
    setNeedsRegenerationInstruments([]);
    renderedInstrumentSnapshotsRef.current = latestInstrumentSnapshotsRef.current ?? buildCurrentInstrumentSnapshots();
    renderedGlobalContextRef.current = latestGlobalContextRef.current ?? buildCurrentGlobalContext();
    previousInstrumentSnapshotsRef.current = latestInstrumentSnapshotsRef.current ?? buildCurrentInstrumentSnapshots();
    setLockedInstruments([]);
    setGhostRerollCount(0);
    setGenerateError("");
  }

  function commitStructureChange(nextBars: number, nextGroupingRaw: string) {
    const normalizedGrouping = normalizeGrouping(nextGroupingRaw);
    stopPlaybackStatefully();
    setBars(nextBars);
    setGrouping(normalizedGrouping);
    setGroupingInput(nextGroupingRaw);
    resetPatternToEmpty(nextBars, normalizedGrouping);
  }

  function cancelPendingStructureChange() {
    pendingStructureActionRef.current = null;
    setPendingStructureChange(null);
    setBars(pattern.meta.bars);
    setGrouping(pattern.meta.grouping);
    setGroupingInput(pattern.meta.grouping);
  }

  function confirmPendingStructureChange() {
    if (!pendingStructureChange) {
      return;
    }

    const { nextBars, nextGroupingRaw } = pendingStructureChange;
    const pendingAction = pendingStructureActionRef.current;
    pendingStructureActionRef.current = null;
    setPendingStructureChange(null);
    commitStructureChange(nextBars, nextGroupingRaw);
    pendingAction?.();
  }

  function applyStructureChange(nextBars: number, nextGroupingRaw: string, onApplied?: () => void): boolean {
    if (groupingError(nextGroupingRaw)) {
      setBars(nextBars);
      setGroupingInput(nextGroupingRaw);
      pendingStructureActionRef.current = null;
      return false;
    }

    const normalizedGrouping = normalizeGrouping(nextGroupingRaw);
    const structureChanged = pattern.meta.bars !== nextBars || pattern.meta.grouping !== normalizedGrouping;

    if (!structureChanged) {
      setBars(nextBars);
      setGrouping(normalizedGrouping);
      setGroupingInput(nextGroupingRaw);
      onApplied?.();
      return true;
    }

    if (patternHasEvents(pattern)) {
      pendingStructureActionRef.current = onApplied ?? null;
      setPendingStructureChange({ nextBars, nextGroupingRaw });
      return false;
    }

    commitStructureChange(nextBars, nextGroupingRaw);
    onApplied?.();
    return true;
  }

  function ensureGroupingCommitted() {
    const normalizedGrouping = normalizeGrouping(groupingInput);
    if (currentGroupingError) {
      return false;
    }
    if (normalizedGrouping === grouping) {
      return true;
    }

    return applyStructureChange(bars, groupingInput);
  }

  function switchToCustomIfNeeded() {
    if (selectedPreset !== CUSTOM_PRESET_ID) {
      setSelectedPreset(CUSTOM_PRESET_ID);
    }
  }

  function applyPreset(preset: Preset) {
    applyStructureChange(preset.settings.bars, preset.settings.grouping, () => {
      setSelectedPreset(preset.id);
      setBpm(preset.settings.bpm);
      setSeed("random");
      setSwing(preset.settings.swing);
      setHumanizeTiming(preset.settings.humanize_timing);
      setHumanizeVelocity(preset.settings.humanize_velocity);
      setBarSimilarity(preset.settings.bar_similarity);
      setFillIntensity(preset.settings.fill_intensity);
      setFillLength(preset.settings.fill_length);
      setFillEvery(preset.settings.fill_every);
      setKickEnabled(preset.kick.enabled);
      setKickDensity(preset.kick.density);
      setKickSyncopation(preset.kick.syncopation);
      setKickTimingFeel(preset.kick.timing_feel);
      setKickVelocityMin(preset.kick.velocity_min);
      setKickVelocityMax(preset.kick.velocity_max);
      setSnareEnabled(preset.snare.enabled);
      setSnareDensity(preset.snare.density);
      setSnareSyncopation(preset.snare.syncopation);
      setSnareTimingFeel(preset.snare.timing_feel);
      setSnareVelocityMin(preset.snare.velocity_min);
      setSnareVelocityMax(preset.snare.velocity_max);
      setSnareGhostEnabled(preset.snare.ghost_settings?.enabled ?? DEFAULT_SNARE.ghost.enabled);
      setSnareGhostDensity(preset.snare.ghost_settings?.density ?? DEFAULT_SNARE.ghost.density);
      setSnareGhostVelocity(preset.snare.ghost_settings?.velocity ?? DEFAULT_SNARE.ghost.velocity);
      setSnareGhostPlacement(preset.snare.ghost_settings?.placement ?? DEFAULT_SNARE.ghost.placement);
      setHihatClosedEnabled(preset.hihat_closed.enabled);
      setHihatClosedDivision(preset.hihat_closed.division);
      setHihatClosedSpace(preset.hihat_closed.space);
      setHihatClosedTimingFeel(preset.hihat_closed.timing_feel);
      setHihatClosedVelocityMin(preset.hihat_closed.velocity_min);
      setHihatClosedVelocityMax(preset.hihat_closed.velocity_max);
      setHihatClosedGhostEnabled(preset.hihat_closed.ghost_settings?.enabled ?? DEFAULT_HIHAT_CLOSED.ghost.enabled);
      setHihatClosedGhostDensity(preset.hihat_closed.ghost_settings?.density ?? DEFAULT_HIHAT_CLOSED.ghost.density);
      setHihatClosedGhostVelocity(
        preset.hihat_closed.ghost_settings?.velocity ?? DEFAULT_HIHAT_CLOSED.ghost.velocity,
      );
      setHihatClosedGhostPlacement(
        preset.hihat_closed.ghost_settings?.placement ?? DEFAULT_HIHAT_CLOSED.ghost.placement,
      );
      setRideEnabled(preset.ride.enabled);
      setRideDivision(preset.ride.division);
      setRideSpace(preset.ride.space);
      setRideTimingFeel(preset.ride.timing_feel);
      setRideVelocityMin(preset.ride.velocity_min);
      setRideVelocityMax(preset.ride.velocity_max);
      setRideGhostEnabled(preset.ride.ghost_settings?.enabled ?? DEFAULT_RIDE.ghost.enabled);
      setRideGhostDensity(preset.ride.ghost_settings?.density ?? DEFAULT_RIDE.ghost.density);
      setRideGhostVelocity(preset.ride.ghost_settings?.velocity ?? DEFAULT_RIDE.ghost.velocity);
      setRideGhostPlacement(preset.ride.ghost_settings?.placement ?? DEFAULT_RIDE.ghost.placement);
      setHihatOpenEnabled(preset.hihat_open.enabled);
      setHihatOpenDensity(preset.hihat_open.density);
      setHihatOpenVelocityMin(preset.hihat_open.velocity_min);
      setHihatOpenVelocityMax(preset.hihat_open.velocity_max);
      setCrashEnabled(preset.crash.enabled);
      setCrashDensity(preset.crash.density);
      setCrashVelocityMin(preset.crash.velocity_min);
      setCrashVelocityMax(preset.crash.velocity_max);
      setTomsHighHits(preset.toms.high_hits);
      setTomsMidHits(preset.toms.mid_hits);
      setTomsLowHits(preset.toms.low_hits);
      setTomsVelocityMin(preset.toms.velocity_min);
      setTomsVelocityMax(preset.toms.velocity_max);
      stopPlaybackStatefully();
      setGenerateError("");
    });
  }

  function handlePresetChange(value: string) {
    if (value === CUSTOM_PRESET_ID) {
      setSelectedPreset(CUSTOM_PRESET_ID);
      stopPlaybackStatefully();
      return;
    }

    const preset = presets.find((item) => item.id === value);
    if (preset) {
      applyPreset(preset);
    }
  }

  function getValidationError() {
    if (!selectedPreset) {
      return "Select a preset before generating.";
    }
    if (currentGroupingError) {
      return currentGroupingError;
    }
    if (kickVelocityError) {
      return kickVelocityError;
    }
    if (snareVelocityError) {
      return snareVelocityError;
    }
    if (hihatClosedVelocityError) {
      return hihatClosedVelocityError;
    }
    if (rideVelocityError) {
      return rideVelocityError;
    }
    if (hihatOpenVelocityError) {
      return hihatOpenVelocityError;
    }
    if (crashVelocityError) {
      return crashVelocityError;
    }
    if (tomsVelocityError) {
      return tomsVelocityError;
    }
    return "";
  }

  function buildRequest(): GenerateMidiInput {
    return {
      bpm,
      seed: seed === "random" ? undefined : seed,
      bars,
      grouping: normalizeGrouping(groupingInput),
      swing,
      humanize_timing: humanizeTiming,
      humanize_velocity: humanizeVelocity,
      bar_similarity: barSimilarity,
      fill_intensity: fillIntensity,
      fill_length: fillLength,
      fill_every: fillEvery,
      kick_enabled: kickEnabled,
      kick_density: kickDensity,
      kick_syncopation: kickSyncopation,
      kick_timing_feel: kickTimingFeel,
      kick_velocity_min: kickVelocityMin,
      kick_velocity_max: kickVelocityMax,
      snare_enabled: snareEnabled,
      snare_density: snareDensity,
      snare_syncopation: snareSyncopation,
      snare_timing_feel: snareTimingFeel,
      snare_velocity_min: snareVelocityMin,
      snare_velocity_max: snareVelocityMax,
      snare_ghost_enabled: snareGhostEnabled,
      snare_ghost_density: snareGhostDensity,
      snare_ghost_velocity: snareGhostVelocity,
      snare_ghost_placement: snareGhostPlacement,
      hihat_closed_enabled: hihatClosedEnabled,
      hihat_closed_division: hihatClosedDivision,
      hihat_closed_space: hihatClosedSpace,
      hihat_closed_timing_feel: hihatClosedTimingFeel,
      hihat_closed_velocity_min: hihatClosedVelocityMin,
      hihat_closed_velocity_max: hihatClosedVelocityMax,
      hihat_closed_ghost_enabled: hihatClosedGhostEnabled,
      hihat_closed_ghost_density: hihatClosedGhostDensity,
      hihat_closed_ghost_velocity: hihatClosedGhostVelocity,
      hihat_closed_ghost_placement: hihatClosedGhostPlacement,
      ride_enabled: rideEnabled,
      ride_division: rideDivision,
      ride_space: rideSpace,
      ride_timing_feel: rideTimingFeel,
      ride_velocity_min: rideVelocityMin,
      ride_velocity_max: rideVelocityMax,
      ride_ghost_enabled: rideGhostEnabled,
      ride_ghost_density: rideGhostDensity,
      ride_ghost_velocity: rideGhostVelocity,
      ride_ghost_placement: rideGhostPlacement,
      hihat_open_enabled: hihatOpenEnabled,
      hihat_open_density: hihatOpenDensity,
      hihat_open_velocity_min: hihatOpenVelocityMin,
      hihat_open_velocity_max: hihatOpenVelocityMax,
      crash_enabled: crashEnabled,
      crash_density: crashDensity,
      crash_velocity_min: crashVelocityMin,
      crash_velocity_max: crashVelocityMax,
      toms_high_hits: tomsHighHits,
      toms_mid_hits: tomsMidHits,
      toms_low_hits: tomsLowHits,
      toms_velocity_min: tomsVelocityMin,
      toms_velocity_max: tomsVelocityMax,
    };
  }

  function buildPatternEditContext(): GenerateMidiInput {
    return buildPatternEditContextForPattern(patternRef.current);
  }

  function buildPatternEditContextForPattern(basePattern: GeneratedPattern): GenerateMidiInput {
    return {
      ...buildRequest(),
      bars: basePattern.meta.bars,
      grouping: basePattern.meta.grouping,
    };
  }

  function buildAnalyticsPayload() {
    return {
      bpm,
      bars,
      grouping: normalizeGrouping(groupingInput),
      preset_id: selectedPreset === CUSTOM_PRESET_ID ? CUSTOM_PRESET_ID : selectedPreset,
      edit_grid_active: isEditGridEnabled,
    };
  }

  function buildCurrentInstrumentSnapshots(): Record<InstrumentId, InstrumentControlSnapshot> {
    return {
      kick: {
        enabled: kickEnabled,
        density: kickDensity,
        syncopation: kickSyncopation,
        timingFeel: kickTimingFeel,
        velocityMin: kickVelocityMin,
        velocityMax: kickVelocityMax,
      },
      snare: {
        enabled: snareEnabled,
        density: snareDensity,
        syncopation: snareSyncopation,
        timingFeel: snareTimingFeel,
        velocityMin: snareVelocityMin,
        velocityMax: snareVelocityMax,
      },
      hihat_closed: {
        enabled: hihatClosedEnabled,
        division: hihatClosedDivision,
        space: hihatClosedSpace,
        timingFeel: hihatClosedTimingFeel,
        velocityMin: hihatClosedVelocityMin,
        velocityMax: hihatClosedVelocityMax,
      },
      hihat_open: {
        enabled: hihatOpenEnabled,
        density: hihatOpenDensity,
        velocityMin: hihatOpenVelocityMin,
        velocityMax: hihatOpenVelocityMax,
      },
      ride: {
        enabled: rideEnabled,
        division: rideDivision,
        space: rideSpace,
        timingFeel: rideTimingFeel,
        velocityMin: rideVelocityMin,
        velocityMax: rideVelocityMax,
      },
      crash: {
        enabled: crashEnabled,
        density: crashDensity,
        velocityMin: crashVelocityMin,
        velocityMax: crashVelocityMax,
      },
      tom_high: {
        enabled: tomsHighHits > 0,
        tomHits: tomsHighHits,
        velocityMin: tomsVelocityMin,
        velocityMax: tomsVelocityMax,
      },
      tom_mid: {
        enabled: tomsMidHits > 0,
        tomHits: tomsMidHits,
        velocityMin: tomsVelocityMin,
        velocityMax: tomsVelocityMax,
      },
      tom_low: {
        enabled: tomsLowHits > 0,
        tomHits: tomsLowHits,
        velocityMin: tomsVelocityMin,
        velocityMax: tomsVelocityMax,
      },
    };
  }

  function buildCurrentGlobalContext(): GlobalGenerationContext {
    return {
      bpm,
      swing,
      humanizeTiming,
      humanizeVelocity,
      barSimilarity,
      fillIntensity,
      fillLength,
      fillEvery,
      seed,
    };
  }

  function updateRenderedInstrumentSnapshots(
    instruments: InstrumentId[],
    mode: "full" | "executive" = "full",
  ) {
    const currentSnapshots = latestInstrumentSnapshotsRef.current ?? buildCurrentInstrumentSnapshots();
    const nextSnapshots = {
      ...(renderedInstrumentSnapshotsRef.current ?? currentSnapshots),
    };
    for (const instrument of instruments) {
      if (mode === "full") {
        nextSnapshots[instrument] = currentSnapshots[instrument];
        continue;
      }

      nextSnapshots[instrument] = {
        ...nextSnapshots[instrument],
        timingFeel: currentSnapshots[instrument].timingFeel,
        velocityMin: currentSnapshots[instrument].velocityMin,
        velocityMax: currentSnapshots[instrument].velocityMax,
      };
    }
    renderedInstrumentSnapshotsRef.current = nextSnapshots;
  }

  function clearQueuedLoopChanges() {
    preparedLoopPatternRef.current = null;
    rebuildRequestIdRef.current += 1;
    setPendingGridEdits([]);
    setPendingExecutiveInstruments([]);
    setPendingRegenerationInstruments([]);
  }

  function updateQueuedInstrumentState(
    setter: Dispatch<SetStateAction<InstrumentId[]>>,
    instrument: InstrumentId,
    enabled: boolean,
  ) {
    setter((current) => setInstrumentQueuedState(current, instrument, enabled));
  }

  function updateQueuedInstrumentStateMany(
    setter: Dispatch<SetStateAction<InstrumentId[]>>,
    instruments: InstrumentId[],
    enabled: boolean,
  ) {
    setter((current) =>
      instruments.reduce(
        (nextList, instrument) => setInstrumentQueuedState(nextList, instrument, enabled),
        current,
      ),
    );
  }

  function buildPartialRegenerationRequest(basePattern: GeneratedPattern): GenerateMidiInput {
    const renderedGlobalContext = renderedGlobalContextRef.current ?? buildCurrentGlobalContext();

    return {
      bpm: basePattern.meta.bpm,
      seed: renderedGlobalContext.seed === "random" ? undefined : renderedGlobalContext.seed,
      bars: basePattern.meta.bars,
      grouping: basePattern.meta.grouping,
      swing: renderedGlobalContext.swing,
      humanize_timing: renderedGlobalContext.humanizeTiming,
      humanize_velocity: renderedGlobalContext.humanizeVelocity,
      bar_similarity: renderedGlobalContext.barSimilarity,
      fill_intensity: renderedGlobalContext.fillIntensity,
      fill_length: renderedGlobalContext.fillLength,
      fill_every: renderedGlobalContext.fillEvery,
      kick_enabled: kickEnabled,
      kick_density: kickDensity,
      kick_syncopation: kickSyncopation,
      kick_timing_feel: kickTimingFeel,
      kick_velocity_min: kickVelocityMin,
      kick_velocity_max: kickVelocityMax,
      snare_enabled: snareEnabled,
      snare_density: snareDensity,
      snare_syncopation: snareSyncopation,
      snare_timing_feel: snareTimingFeel,
      snare_velocity_min: snareVelocityMin,
      snare_velocity_max: snareVelocityMax,
      snare_ghost_enabled: snareGhostEnabled,
      snare_ghost_density: snareGhostDensity,
      snare_ghost_velocity: snareGhostVelocity,
      snare_ghost_placement: snareGhostPlacement,
      hihat_closed_enabled: hihatClosedEnabled,
      hihat_closed_division: hihatClosedDivision,
      hihat_closed_space: hihatClosedSpace,
      hihat_closed_timing_feel: hihatClosedTimingFeel,
      hihat_closed_velocity_min: hihatClosedVelocityMin,
      hihat_closed_velocity_max: hihatClosedVelocityMax,
      hihat_closed_ghost_enabled: hihatClosedGhostEnabled,
      hihat_closed_ghost_density: hihatClosedGhostDensity,
      hihat_closed_ghost_velocity: hihatClosedGhostVelocity,
      hihat_closed_ghost_placement: hihatClosedGhostPlacement,
      ride_enabled: rideEnabled,
      ride_division: rideDivision,
      ride_space: rideSpace,
      ride_timing_feel: rideTimingFeel,
      ride_velocity_min: rideVelocityMin,
      ride_velocity_max: rideVelocityMax,
      ride_ghost_enabled: rideGhostEnabled,
      ride_ghost_density: rideGhostDensity,
      ride_ghost_velocity: rideGhostVelocity,
      ride_ghost_placement: rideGhostPlacement,
      hihat_open_enabled: hihatOpenEnabled,
      hihat_open_density: hihatOpenDensity,
      hihat_open_velocity_min: hihatOpenVelocityMin,
      hihat_open_velocity_max: hihatOpenVelocityMax,
      crash_enabled: crashEnabled,
      crash_density: crashDensity,
      crash_velocity_min: crashVelocityMin,
      crash_velocity_max: crashVelocityMax,
      toms_high_hits: tomsHighHits,
      toms_mid_hits: tomsMidHits,
      toms_low_hits: tomsLowHits,
      toms_velocity_min: tomsVelocityMin,
      toms_velocity_max: tomsVelocityMax,
    };
  }

  async function regenerateSelectedInstruments(
    basePattern: GeneratedPattern,
    instruments: InstrumentId[],
  ): Promise<GeneratedPattern> {
    const unlockedInstruments = instruments.filter((instrument) => !lockedInstruments.includes(instrument));
    if (unlockedInstruments.length === 0) {
      return basePattern;
    }

    const freshPattern = await generatePattern(buildPartialRegenerationRequest(basePattern));
    return mergeSelectedInstrumentEvents(basePattern, freshPattern, unlockedInstruments);
  }

  async function applyPendingGridEdits(basePattern: GeneratedPattern, queuedEdits: PendingGridEdit[]): Promise<GeneratedPattern> {
    let nextPattern = basePattern;

    for (const edit of queuedEdits) {
      if (edit.kind === "toggle") {
        nextPattern = edit.hasVisibleEvent
          ? await removePatternHit({
              pattern: nextPattern,
              instrument: edit.instrument,
              bar: edit.bar,
              slot: edit.slot,
              context: buildPatternEditContextForPattern(nextPattern),
            })
          : await addPatternBaseHit({
              pattern: nextPattern,
              instrument: edit.instrument,
              bar: edit.bar,
              slot: edit.slot,
              context: buildPatternEditContextForPattern(nextPattern),
            });
        continue;
      }

      nextPattern = await movePatternHit({
        pattern: nextPattern,
        instrument: edit.instrument,
        from_bar: edit.fromBar,
        from_slot: edit.fromSlot,
        to_bar: edit.toBar,
        to_slot: edit.toSlot,
        hit_type: edit.hitType,
        context: buildPatternEditContextForPattern(nextPattern),
      });
    }

    return nextPattern;
  }

  function applyExecutiveUpdates(
    basePattern: GeneratedPattern,
    instruments: InstrumentId[],
    snapshots: Record<InstrumentId, InstrumentControlSnapshot>,
  ): GeneratedPattern {
    const renderedSnapshots = renderedInstrumentSnapshotsRef.current ?? snapshots;
    const renderedGlobalContext = renderedGlobalContextRef.current ?? currentGlobalContext;
    let nextPattern = basePattern;

    for (const instrument of instruments) {
      nextPattern = applyExecutiveUpdateToPattern(
        nextPattern,
        instrument,
        renderedSnapshots[instrument],
        snapshots[instrument],
        renderedGlobalContext.humanizeTiming,
      );
    }

    return nextPattern;
  }

  async function materializeQueuedPattern(
    basePattern: GeneratedPattern,
    queuedEdits: PendingGridEdit[] = pendingGridEditsRef.current,
    executiveInstruments: InstrumentId[] = pendingExecutiveRef.current,
    regenerationInstruments: InstrumentId[] = pendingRegenerationRef.current,
    snapshots: Record<InstrumentId, InstrumentControlSnapshot> = latestInstrumentSnapshotsRef.current ??
      buildCurrentInstrumentSnapshots(),
  ): Promise<GeneratedPattern> {
    let nextPattern = basePattern;
    if (queuedEdits.length > 0) {
      nextPattern = await applyPendingGridEdits(nextPattern, queuedEdits);
    }
    if (executiveInstruments.length > 0) {
      nextPattern = applyExecutiveUpdates(nextPattern, executiveInstruments, snapshots);
    }
    if (regenerationInstruments.length > 0) {
      nextPattern = await regenerateSelectedInstruments(nextPattern, regenerationInstruments);
    }
    return nextPattern;
  }

  function setCommittedPattern(nextPattern: GeneratedPattern) {
    patternRef.current = nextPattern;
    setPattern(nextPattern);
  }

  function getInstrumentStatus(instrument: InstrumentId | InstrumentId[]): InstrumentStatus | null {
    const targets = Array.isArray(instrument) ? instrument : [instrument];
    const hasQueuedUpdate = targets.some(
      (target) =>
        pendingGridEditInstruments.includes(target) ||
        pendingExecutiveInstruments.includes(target) ||
        pendingRegenerationInstruments.includes(target),
    );
    if (hasQueuedUpdate) {
      return {
        kind: "queued",
        label: "updates next loop",
      };
    }

    if (targets.some((target) => needsRegenerationInstruments.includes(target))) {
      return {
        kind: "dirty",
        label: "needs regeneration",
      };
    }

    return null;
  }

  function playbackStatusDetail(): string {
    if (playbackStatus === "Playing") {
      const queuedCount =
        pendingGridEditInstruments.length + pendingExecutiveInstruments.length + pendingRegenerationInstruments.length;
      return queuedCount > 0 ? "Queued changes will land on the next loop." : "Live edits wait for the next loop.";
    }

    return needsRegenerationInstruments.length > 0
      ? "Play will sync only the instruments marked for regeneration."
      : "Stopped mode applies executive changes immediately.";
  }

  function getPatternForCurrentStructure() {
    const activeGrouping = currentGroupingError ? grouping : normalizeGrouping(groupingInput);
    if (pattern.meta.bars === bars && pattern.meta.grouping === activeGrouping) {
      return pattern;
    }

    return createEmptyPattern({
      bpm,
      bars,
      grouping: activeGrouping,
      swing,
      humanizeTiming,
      humanizeVelocity,
    });
  }

  async function handleGridCellClick(instrument: string, barIndex: number, slotIndex: number, event: PatternEvent | null) {
    if (isEditingPattern || !isEditGridEnabled) {
      return;
    }

    setGenerateError("");
    setIsEditingPattern(true);

    try {
      const instrumentId = instrument as InstrumentId;
      if (playbackStatus === "Playing") {
        setPendingGridEdits((current) => [
          ...current,
          {
            kind: "toggle",
            instrument: instrumentId,
            bar: barIndex,
            slot: slotIndex,
            hasVisibleEvent: Boolean(event),
          },
        ]);
        return;
      }

      const nextPattern = event
        ? await removePatternHit({
            pattern: patternRef.current,
            instrument,
            bar: barIndex,
            slot: slotIndex,
            context: buildPatternEditContext(),
          })
        : await addPatternBaseHit({
            pattern: patternRef.current,
            instrument,
            bar: barIndex,
            slot: slotIndex,
            context: buildPatternEditContext(),
          });
      setCommittedPattern(nextPattern);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to edit pattern.");
    } finally {
      setIsEditingPattern(false);
    }
  }

  async function handleGridDrop(instrument: string, barIndex: number, slotIndex: number) {
    if (!dragState || isEditingPattern || !isEditGridEnabled) {
      return;
    }
    if (dragState.instrument !== instrument) {
      setDragState(null);
      return;
    }
    if (dragState.bar === barIndex && dragState.slot === slotIndex) {
      setDragState(null);
      return;
    }

    setGenerateError("");
    setIsEditingPattern(true);

    try {
      if (playbackStatus === "Playing") {
        setPendingGridEdits((current) => [
          ...current,
          {
            kind: "move",
            instrument: instrument as InstrumentId,
            fromBar: dragState.bar,
            fromSlot: dragState.slot,
            toBar: barIndex,
            toSlot: slotIndex,
            hitType: dragState.hitType,
          },
        ]);
        return;
      }

      const nextPattern = await movePatternHit({
        pattern: patternRef.current,
        instrument,
        from_bar: dragState.bar,
        from_slot: dragState.slot,
        to_bar: barIndex,
        to_slot: slotIndex,
        hit_type: dragState.hitType,
        context: buildPatternEditContext(),
      });
      setCommittedPattern(nextPattern);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to move hit.");
    } finally {
      setDragState(null);
      setIsEditingPattern(false);
    }
  }

  function handlePatternGridWheel(event: WheelEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    if (container.scrollWidth <= container.clientWidth) {
      return;
    }

    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (dominantDelta === 0) {
      return;
    }

    container.scrollLeft += dominantDelta;
    event.preventDefault();
  }

  async function handleGeneratePattern(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ensureGroupingCommitted()) {
      if (currentGroupingError) {
        setGenerateError(currentGroupingError);
      }
      return;
    }

    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    setIsGeneratingPattern(true);

    try {
      stopPlaybackStatefully();
      clearQueuedLoopChanges();
      setNeedsRegenerationInstruments([]);
      const request = buildRequest();
      const requestSignature = JSON.stringify(request);
      const shouldShowFixedSeedWarning =
        request.seed !== undefined && lastGenerateSignatureRef.current === requestSignature;
      const currentPattern = getPatternForCurrentStructure();
      const nextPattern = await generatePattern(request);
      const mergedPattern = mergeLockedInstrumentEvents(currentPattern, nextPattern, lockedInstruments);
      const unlockedInstruments = INSTRUMENT_IDS.filter((instrument) => !lockedInstruments.includes(instrument));
      suppressInstrumentSyncRef.current = true;
      setCommittedPattern(mergedPattern);
      updateRenderedInstrumentSnapshots(unlockedInstruments);
      renderedGlobalContextRef.current = latestGlobalContextRef.current ?? buildCurrentGlobalContext();
      previousInstrumentSnapshotsRef.current = latestInstrumentSnapshotsRef.current ?? buildCurrentInstrumentSnapshots();
      setGhostRerollCount(0);
      lastGenerateSignatureRef.current = requestSignature;
      trackEvent("generate_pattern", buildAnalyticsPayload());
      if (shouldShowFixedSeedWarning) {
        setSeedFixedWarningVisible(true);
        if (seedWarningTimeoutRef.current !== null) {
          window.clearTimeout(seedWarningTimeoutRef.current);
        }
        seedWarningTimeoutRef.current = window.setTimeout(() => {
          setSeedFixedWarningVisible(false);
          seedWarningTimeoutRef.current = null;
        }, 5000);
      }
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate pattern.");
    } finally {
      setIsGeneratingPattern(false);
    }
  }

  async function handleDownloadMidi() {
    if (!ensureGroupingCommitted()) {
      if (currentGroupingError) {
        setGenerateError(currentGroupingError);
      }
      return;
    }

    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    setIsGenerating(true);

    try {
      const currentPattern = preparedLoopPatternRef.current ?? getPatternForCurrentStructure();
      const blob = patternHasEvents(currentPattern) ? await exportPatternMidi(currentPattern, bpm) : await generateMidi(buildRequest());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ghostgroove.mid";
      document.body.appendChild(link);
      link.click();
      trackEvent("export_midi", buildAnalyticsPayload());
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate MIDI.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateGhosts() {
    if (!ensureGroupingCommitted()) {
      if (currentGroupingError) {
        setGenerateError(currentGroupingError);
      }
      return;
    }

    const currentPattern = getPatternForCurrentStructure();
    if (!patternHasEvents(currentPattern)) {
      setGenerateError("Add base hits or generate a pattern before generating ghosts.");
      return;
    }

    setGenerateError("");
    setIsGeneratingGhosts(true);

    try {
      stopPlaybackStatefully();
      clearQueuedLoopChanges();
      const nextPattern = await generatePatternGhosts({
        pattern: currentPattern,
        seed: seed === "random" ? undefined : seed + ghostRerollCount + 1,
        snare_enabled: snareEnabled,
        snare_ghost_enabled: snareGhostEnabled,
        snare_ghost_density: snareGhostDensity,
        snare_ghost_velocity: snareGhostVelocity,
        snare_ghost_placement: snareGhostPlacement,
        hihat_closed_enabled: hihatClosedEnabled,
        hihat_closed_division: hihatClosedDivision,
        hihat_closed_ghost_enabled: hihatClosedGhostEnabled,
        hihat_closed_ghost_density: hihatClosedGhostDensity,
        hihat_closed_ghost_velocity: hihatClosedGhostVelocity,
        hihat_closed_ghost_placement: hihatClosedGhostPlacement,
        ride_enabled: rideEnabled,
        ride_division: rideDivision,
        ride_ghost_enabled: rideGhostEnabled,
        ride_ghost_density: rideGhostDensity,
        ride_ghost_velocity: rideGhostVelocity,
        ride_ghost_placement: rideGhostPlacement,
      });
      suppressInstrumentSyncRef.current = true;
      setCommittedPattern(nextPattern);
      setGhostRerollCount((current) => current + 1);
      trackEvent("generate_ghosts", buildAnalyticsPayload());
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate ghost notes.");
    } finally {
      setIsGeneratingGhosts(false);
    }
  }

  async function handlePlay() {
    if (!ensureGroupingCommitted()) {
      if (currentGroupingError) {
        setGenerateError(currentGroupingError);
      }
      return;
    }

    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    try {
      let currentPattern = getPatternForCurrentStructure();
      if (needsRegenerationInstruments.length > 0) {
        currentPattern = await regenerateSelectedInstruments(currentPattern, needsRegenerationInstruments);
        suppressInstrumentSyncRef.current = true;
        setCommittedPattern(currentPattern);
        updateRenderedInstrumentSnapshots(needsRegenerationInstruments);
        setNeedsRegenerationInstruments([]);
      }
      if (!patternHasEvents(currentPattern)) {
        setGenerateError("Add hits or generate a pattern first.");
        return;
      }
      await getPatternPlayer().play(currentPattern, isLoopEnabled, bpm);
      setPlaybackStatus("Playing");
      trackEvent("play_preview", buildAnalyticsPayload());
    } catch (error) {
      setIsGeneratingPattern(false);
      setGenerateError(error instanceof Error ? error.message : "Failed to start playback.");
      setPlaybackStatus("Stopped");
    }
  }

  async function handleStop() {
    stopPlaybackStatefully();
    try {
      const nextPattern = preparedLoopPatternRef.current ?? (await materializeQueuedPattern(patternRef.current));
      if (
        pendingGridEditsRef.current.length > 0 ||
        pendingExecutiveRef.current.length > 0 ||
        pendingRegenerationRef.current.length > 0
      ) {
        suppressInstrumentSyncRef.current = true;
        setCommittedPattern(nextPattern);
        updateRenderedInstrumentSnapshots([
          ...pendingExecutiveRef.current,
          ...pendingRegenerationRef.current,
        ]);
      }
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to land queued changes.");
    } finally {
      suppressInstrumentSyncRef.current = true;
      preparedLoopPatternRef.current = null;
      clearQueuedLoopChanges();
    }
  }

  async function handleRestart() {
    if (!ensureGroupingCommitted()) {
      if (currentGroupingError) {
        setGenerateError(currentGroupingError);
      }
      return;
    }

    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    try {
      let currentPattern =
        preparedLoopPatternRef.current ??
        (pendingGridEditsRef.current.length > 0 ||
        pendingExecutiveRef.current.length > 0 ||
        pendingRegenerationRef.current.length > 0
          ? await materializeQueuedPattern(getPatternForCurrentStructure())
          : getPatternForCurrentStructure());
      if (playbackStatus !== "Playing" && needsRegenerationInstruments.length > 0) {
        currentPattern = await regenerateSelectedInstruments(currentPattern, needsRegenerationInstruments);
        suppressInstrumentSyncRef.current = true;
        setCommittedPattern(currentPattern);
        updateRenderedInstrumentSnapshots(needsRegenerationInstruments);
        setNeedsRegenerationInstruments([]);
      }
      if (!patternHasEvents(currentPattern)) {
        setGenerateError("Add hits or generate a pattern first.");
        return;
      }
      if (
        preparedLoopPatternRef.current ||
        pendingGridEditsRef.current.length > 0 ||
        pendingExecutiveRef.current.length > 0 ||
        pendingRegenerationRef.current.length > 0
      ) {
        suppressInstrumentSyncRef.current = true;
        setCommittedPattern(currentPattern);
        updateRenderedInstrumentSnapshots([
          ...pendingExecutiveRef.current,
          ...pendingRegenerationRef.current,
        ]);
        clearQueuedLoopChanges();
      }
      await getPatternPlayer().play(currentPattern, isLoopEnabled, bpm);
      setPlaybackStatus("Playing");
    } catch (error) {
      setIsGeneratingPattern(false);
      setGenerateError(error instanceof Error ? error.message : "Failed to restart playback.");
      setPlaybackStatus("Stopped");
    }
  }

  function handleClearPattern() {
    stopPlaybackStatefully();
    resetPatternToEmpty();
  }

  function handleToggleInstrumentLock(instrument: string) {
    setLockedInstruments((current) =>
      current.includes(instrument)
        ? current.filter((item) => item !== instrument)
        : [...current, instrument],
    );
  }

  function handleRandomizeParameters() {
    const rng = Math.random;
    const randomChoice = <T,>(values: T[]) => values[Math.floor(rng() * values.length)];
    const randomFloat = (min: number, max: number, digits = 2) =>
      Number((min + (max - min) * rng()).toFixed(digits));
    const randomInt = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
    const betaLikePulseSpace = () => Math.min(0.85, Number((Math.pow(rng(), 1.6) * (1 - Math.pow(rng(), 3.2)) + rng() * 0.15).toFixed(2)));
    const nextBars = randomChoice([1, 2, 4, 8]);
    const nextGrouping = randomGroupingValue(rng);

    applyStructureChange(nextBars, nextGrouping, () => {
      setSelectedPreset(CUSTOM_PRESET_ID);
      setGenerateError("");
      setSwing(randomFloat(0, 0.28));
      setBarSimilarity(randomFloat(0, 1));
      setFillEvery(randomChoice([1, 2, 4, 8]));
      setFillLength(randomChoice(["short", "medium", "long"]));
      setFillIntensity(randomChoice(["off", "low", "medium", "high"]));
      setSeed("random");

      setKickDensity(randomFloat(0.1, 0.95));
      setKickSyncopation(randomInt(0, 5));
      setKickTimingFeel(randomChoice(["neutral", "push", "drag", "random"]));

      setSnareDensity(randomFloat(0.1, 0.95));
      setSnareSyncopation(randomInt(0, 5));
      setSnareTimingFeel(randomChoice(["neutral", "push", "drag", "random"]));
      setSnareGhostDensity(randomFloat(0.05, 0.45));
      setSnareGhostVelocity(randomInt(22, 42));

      setHihatClosedDivision(randomChoice(["quarter", "eighth", "sixteenth"]));
      setHihatClosedSpace(betaLikePulseSpace());
      setHihatClosedTimingFeel(randomChoice(["neutral", "push", "drag", "random"]));
      setHihatClosedGhostDensity(randomFloat(0.05, 0.45));
      setHihatClosedGhostVelocity(randomInt(22, 42));

      setRideDivision(randomChoice(["quarter", "eighth", "sixteenth"]));
      setRideSpace(betaLikePulseSpace());
      setRideTimingFeel(randomChoice(["neutral", "push", "drag", "random"]));
      setRideGhostDensity(randomFloat(0.05, 0.45));
      setRideGhostVelocity(randomInt(22, 42));

      setHihatOpenDensity(randomFloat(0.05, 0.9));
      setCrashDensity(randomFloat(0.04, 0.5));
      setTomsHighHits(randomInt(0, 3));
      setTomsMidHits(randomInt(0, 3));
      setTomsLowHits(randomInt(0, 3));
    });
  }

  return (
    <main className="page-shell">
      <form className="app-layout" onSubmit={handleGeneratePattern}>
        <aside className="sidebar card">
          <header className="hero">
            <h1>GhostGroove</h1>
            <p>generate drum MIDI from musical presets</p>
          </header>

          <div className="sidebar-form">
            <section className="section-card">
              <div className="section-card-head">
                <h2>Structure</h2>
                <p>Define meter, grouping, preset, and overall form before shaping individual instruments.</p>
              </div>

              <ContinuousSliderControl
                label="BPM"
                value={bpm}
                min={40}
                max={220}
                step={1}
                enableWheel
                showValueInHandle
                onChange={(nextValue) => {
                  setBpm(nextValue);
                }}
              />

              <HandleOptionSliderControl
                label="Pattern Length"
                value={String(bars)}
                options={PATTERN_LENGTH_OPTIONS}
                slotCount={4}
                className="pattern-length-control"
                showValueInHandle
                onChange={(nextValue) => {
                  switchToCustomIfNeeded();
                  applyStructureChange(Number(nextValue), groupingInput);
                }}
              />

              <div className="structure-grouping-row">
                <label className="field structure-grouping-field">
                  <span>Beat Grouping</span>
                  <input
                    type="text"
                    value={groupingInput}
                    onChange={(event) => {
                      switchToCustomIfNeeded();
                      setGroupingInput(event.target.value);
                    }}
                    onBlur={() => {
                      if (!currentGroupingError) {
                        applyStructureChange(bars, groupingInput);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !currentGroupingError) {
                        event.preventDefault();
                        applyStructureChange(bars, groupingInput);
                      }
                    }}
                    placeholder="4 or 3+2"
                  />
                </label>

                <label className="field structure-time-signature-field">
                  <span>Time Signature</span>
                  <input type="text" value={timeSignature} readOnly />
                </label>
              </div>

              <label className={`field seed-field ${seedFixedWarningVisible ? "seed-field-warning" : ""}`}>
                <span>Seed</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={seed === "random" ? "" : seed}
                  placeholder="Random"
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (value === "") {
                      setSeed("random");
                      return;
                    }
                    switchToCustomIfNeeded();
                    setSeed(Number(value));
                  }}
                />
                <span className={`seed-field-notice ${seedFixedWarningVisible ? "seed-field-notice-visible" : ""}`}>
                  Pattern unchanged because the seed is fixed.
                </span>
              </label>
            </section>

            <section className="section-card">
              <div className="section-card-head">
                <h2>Humanization</h2>
                <p>Shape feel and repetition without changing the core groove logic.</p>
              </div>

              <div className="humanization-knob-grid">
                <div className="humanization-knob-control">
                  <KnobControl
                    label="Humanize Timing"
                    min={0}
                    max={24}
                    step={1}
                    value={humanizeTiming}
                    onChange={(nextValue) => {
                      switchToCustomIfNeeded();
                      setHumanizeTiming(nextValue);
                    }}
                  />
                </div>

                <div className="humanization-knob-control">
                  <KnobControl
                    label="Humanize Velocity"
                    min={0}
                    max={24}
                    step={1}
                    value={humanizeVelocity}
                    onChange={(nextValue) => {
                      switchToCustomIfNeeded();
                      setHumanizeVelocity(nextValue);
                    }}
                  />
                </div>

                <div className="humanization-knob-control">
                  <KnobControl
                    label="Swing"
                    min={0}
                    max={0.65}
                    step={0.01}
                    value={swing}
                    onChange={(nextValue) => {
                      switchToCustomIfNeeded();
                      setSwing(nextValue);
                    }}
                  />
                </div>

                <div className="humanization-knob-control">
                  <KnobControl
                    label="Bar Similarity"
                    min={0}
                    max={1}
                    step={0.01}
                    value={barSimilarity}
                    onChange={(nextValue) => {
                      switchToCustomIfNeeded();
                      setBarSimilarity(nextValue);
                    }}
                  />
                </div>
              </div>
            </section>

            <section className="section-card section-card-status">
              <div className="section-card-head">
                <h2>Playback & Actions</h2>
                <p>Generate, preview, export, and toggle edit mode from one stable control area.</p>
              </div>

              <div className="action-group">
                <div className="playback-actions">
                  <div className="playback-actions-row playback-actions-row-primary">
                    <button
                      type="submit"
                      disabled={
                        isLoadingPresets ||
                        isGeneratingPattern ||
                        isGenerating ||
                        isGeneratingGhosts ||
                        isEditingPattern ||
                        !selectedPreset ||
                        Boolean(currentGroupingError) ||
                        Boolean(kickVelocityError) ||
                        Boolean(snareVelocityError) ||
                        Boolean(hihatClosedVelocityError) ||
                        Boolean(rideVelocityError) ||
                        Boolean(hihatOpenVelocityError) ||
                        Boolean(crashVelocityError) ||
                        Boolean(tomsVelocityError)
                      }
                    >
                      {isGeneratingPattern ? "Generating Pattern..." : "Generate Pattern"}
                    </button>

                    <button
                      type="button"
                      className="button-secondary button-generate-ghosts"
                      onClick={() => void handleGenerateGhosts()}
                      disabled={isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      {isGeneratingGhosts ? "Generating Ghosts..." : "Generate Ghosts"}
                    </button>
                  </div>

                  <div className="playback-actions-row playback-actions-row-secondary">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleClearPattern}
                      disabled={isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      Clear
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleRandomizeParameters}
                      disabled={isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      Randomize
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void handleDownloadMidi()}
                      disabled={
                        isLoadingPresets ||
                        isGeneratingPattern ||
                        isGenerating ||
                        isGeneratingGhosts ||
                        isEditingPattern ||
                        !selectedPreset ||
                        Boolean(currentGroupingError) ||
                        Boolean(kickVelocityError) ||
                        Boolean(snareVelocityError) ||
                        Boolean(hihatClosedVelocityError) ||
                        Boolean(rideVelocityError) ||
                        Boolean(hihatOpenVelocityError) ||
                        Boolean(crashVelocityError) ||
                        Boolean(tomsVelocityError)
                      }
                    >
                      {isGenerating ? "Downloading MIDI..." : patternHasEvents(pattern) ? "Download Edited MIDI" : "Download MIDI"}
                    </button>
                  </div>

                  <div className="playback-actions-row playback-actions-row-transport">
                    <button
                      type="button"
                      onClick={() => void handlePlay()}
                      disabled={isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      Play
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void handleStop()}
                      disabled={playbackStatus !== "Playing"}
                    >
                      Stop
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void handleRestart()}
                      disabled={isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      Restart
                    </button>
                  </div>
                </div>

                <div className="toggle-row">
                  <label className="field-checkbox field-checkbox-panel">
                    <input
                      type="checkbox"
                      checked={isLoopEnabled}
                      onChange={(event) => {
                        const nextValue = event.target.checked;
                        setIsLoopEnabled(nextValue);
                        getPatternPlayer().setLoopEnabled(nextValue);
                      }}
                    />
                    <span>Loop</span>
                  </label>

                  <label className="field-checkbox field-checkbox-panel">
                    <input
                      type="checkbox"
                      checked={isEditGridEnabled}
                      onChange={(event) => {
                        setIsEditGridEnabled(event.target.checked);
                        if (!event.target.checked) {
                          setDragState(null);
                        }
                      }}
                    />
                    <span>Edit Grid</span>
                  </label>
                </div>

                <div className="message playback-status">
                  <span>Playback: {playbackStatus}</span>
                  <span className="playback-status-detail">{playbackStatusDetail()}</span>
                </div>
              </div>
            </section>
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-header">
            <h2>Instruments</h2>
            <p>Shape individual layers without changing the core groove logic or control behavior.</p>
          </div>

          <div className="instrument-bands">
            <div className="backbone-cluster">
            <section className="band-card band-card-backbone">
              <div className="band-header">
                <h3>Backbone</h3>
                <p>Kick and snare define the structural weight of the groove.</p>
              </div>

              <div className="band-grid band-grid-backbone">
              <section
                className={`instrument-card instrument-card-kick ${kickEnabled ? "instrument-card-green-enabled" : "instrument-card-green-disabled"}`}
              >
                <div className="instrument-head">
                  <h3>Kick</h3>
                  <label className="field-checkbox field-checkbox-icon" aria-label="Kick enabled">
                    <input
                      type="checkbox"
                      checked={kickEnabled}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setKickEnabled(event.target.checked);
                      }}
                    />
                    <span>Enabled</span>
                  </label>
                  <p>Dial in the backbone of the groove first.</p>
                </div>

                <div className="instrument-body instrument-body-kick">
                  <div className="kick-top-row">
                    <div className="kick-top-cell kick-top-cell-density">
                      <KnobControl
                        label="Density"
                        min={0}
                        max={1}
                        step={0.01}
                        value={kickDensity}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setKickDensity(nextValue);
                        }}
                      />
                    </div>

                    <div className="kick-top-cell kick-top-cell-timing">
                      <TimingFeelControl
                        value={kickTimingFeel}
                        className="timing-feel-control-vertical"
                        options={[
                          { value: "push", label: "Push", shape: "center" },
                          { value: "neutral", label: "Neutral", shape: "center" },
                          { value: "drag", label: "Drag", shape: "center" },
                          { value: "random", label: "Random", shape: "center random" },
                        ]}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setKickTimingFeel(nextValue);
                        }}
                      />
                    </div>
                  </div>

                  <div className="kick-syncopation-control">
                    <SteppedSliderControl
                      label="Syncopation"
                      value={kickSyncopation}
                      options={SYNCOPATION_OPTIONS}
                      onChange={(nextValue) => {
                        switchToCustomIfNeeded();
                        setKickSyncopation(nextValue as number);
                      }}
                    />
                  </div>

                  <div className="kick-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      min={1}
                      max={127}
                      step={1}
                      minValue={kickVelocityMin}
                      maxValue={kickVelocityMax}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setKickVelocityMin(nextMin);
                        setKickVelocityMax(nextMax);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section
                className={`instrument-card instrument-card-snare ${snareEnabled ? "instrument-card-green-enabled" : "instrument-card-green-disabled"}`}
              >
                <div className="instrument-head">
                  <h3>Snare</h3>
                  <label className="field-checkbox field-checkbox-icon" aria-label="Snare enabled">
                    <input
                      type="checkbox"
                      checked={snareEnabled}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setSnareEnabled(event.target.checked);
                      }}
                    />
                    <span>Enabled</span>
                  </label>
                  <p>Set the backbeat weight and how much it pushes or relaxes the groove.</p>
                </div>

                <div className="instrument-body instrument-body-snare">
                  <div className="snare-top-row">
                    <div className="snare-top-cell snare-top-cell-density">
                      <KnobControl
                        label="Density"
                        min={0}
                        max={1}
                        step={0.01}
                        value={snareDensity}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setSnareDensity(nextValue);
                        }}
                      />
                    </div>

                    <div className="snare-top-cell snare-top-cell-timing">
                      <TimingFeelControl
                        value={snareTimingFeel}
                        ariaLabel="Snare timing feel"
                        className="timing-feel-control-vertical"
                        options={[
                          { value: "push", label: "Push", shape: "center" },
                          { value: "neutral", label: "Neutral", shape: "center" },
                          { value: "drag", label: "Drag", shape: "center" },
                          { value: "random", label: "Random", shape: "center random" },
                        ]}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setSnareTimingFeel(nextValue);
                        }}
                      />
                    </div>
                  </div>

                  <div className="snare-syncopation-control">
                    <SteppedSliderControl
                      label="Syncopation"
                      value={snareSyncopation}
                      options={SYNCOPATION_OPTIONS}
                      onChange={(nextValue) => {
                        switchToCustomIfNeeded();
                        setSnareSyncopation(nextValue as number);
                      }}
                    />
                  </div>

                  <div className="snare-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      min={1}
                      max={127}
                      step={1}
                      minValue={snareVelocityMin}
                      maxValue={snareVelocityMax}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setSnareVelocityMin(nextMin);
                        setSnareVelocityMax(nextMax);
                      }}
                    />
                  </div>

                  <div className={`snare-ghost-section ${snareGhostEnabled ? "ghost-section-enabled" : "ghost-section-disabled"}`}>
                    <div className="snare-ghost-head">
                      <h4>Ghost Layer</h4>
                      <label className="field-checkbox field-checkbox-icon" aria-label="Snare ghost enabled">
                        <input
                          type="checkbox"
                          checked={snareGhostEnabled}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setSnareGhostEnabled(event.target.checked);
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                    </div>

                    <div className="snare-ghost-top-row">
                      <div className="snare-ghost-density">
                        <KnobControl
                          label="Density"
                          min={0}
                          max={1}
                          step={0.01}
                          value={snareGhostDensity}
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setSnareGhostDensity(nextValue);
                          }}
                        />
                      </div>

                      <div className="snare-ghost-velocity">
                        <VerticalSliderControl
                          label="Velocity"
                          min={1}
                          max={127}
                          step={1}
                          value={snareGhostVelocity}
                          showValueInHandle
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setSnareGhostVelocity(nextValue);
                          }}
                        />
                      </div>

                      <div className="snare-ghost-placement">
                        <GhostPlacementControl
                          value={snareGhostPlacement}
                          ariaLabel="Snare ghost placement"
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setSnareGhostPlacement(nextValue);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              </div>
            </section>

            <section className="instrument-card instrument-card-preset preset-floating-card">
              <div className="instrument-head">
                <h3>Preset</h3>
                <p>Load a saved starting point without changing the generation workflow.</p>
              </div>

              <div className="instrument-body instrument-body-preset">
                <label className="field">
                  <select
                    value={selectedPreset}
                    onChange={(event) => handlePresetChange(event.target.value)}
                    disabled={isLoadingPresets}
                  >
                    <option value={CUSTOM_PRESET_ID}>Custom</option>
                    {isLoadingPresets ? (
                      <option>Loading presets...</option>
                    ) : presets.length > 0 ? (
                      presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))
                    ) : (
                      <option>No presets available</option>
                    )}
                  </select>
                </label>
              </div>
            </section>
            </div>

            <section className="band-card band-card-pulse">
              <div className="band-header">
                <h3>Pulse</h3>
                <p>Closed hat and ride handle spacing, subdivision, and forward motion.</p>
              </div>

              <div className="band-grid band-grid-2">
              <section
                className={`instrument-card instrument-card-hihat-closed ${hihatClosedEnabled ? "instrument-card-green-enabled" : "instrument-card-green-disabled"}`}
              >
                <div className="instrument-head">
                  <h3>Hi-Hat Closed</h3>
                  <label className="field-checkbox field-checkbox-icon" aria-label="Hi-Hat Closed enabled">
                    <input
                      type="checkbox"
                      checked={hihatClosedEnabled}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setHihatClosedEnabled(event.target.checked);
                      }}
                    />
                    <span>Enabled</span>
                  </label>
                  <p>Shape the pulse layer with spacing, subdivision, and feel.</p>
                </div>

                <div className="instrument-body instrument-body-hihat-closed">
                  <div className="hihat-closed-top-row">
                    <div className="hihat-closed-top-cell hihat-closed-top-cell-division">
                      <HandleOptionSliderControl
                        label="Division"
                        value={hihatClosedDivision}
                        options={DIVISION_OPTIONS}
                        orientation="vertical"
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setHihatClosedDivision(nextValue as (typeof DIVISION_OPTIONS)[number]["value"]);
                        }}
                      />
                    </div>

                    <div className="hihat-closed-top-cell hihat-closed-top-cell-timing">
                      <TimingFeelControl
                        value={hihatClosedTimingFeel}
                        ariaLabel="Hi-Hat Closed timing feel"
                        className="timing-feel-control-vertical"
                        options={[
                          { value: "push", label: "Push", shape: "center" },
                          { value: "neutral", label: "Neutral", shape: "center" },
                          { value: "drag", label: "Drag", shape: "center" },
                          { value: "random", label: "Random", shape: "center random" },
                        ]}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setHihatClosedTimingFeel(nextValue);
                        }}
                      />
                    </div>
                  </div>

                  <div className="pulse-top-label-row">
                    <span>Division</span>
                    <span>Timing Feel</span>
                  </div>

                  <div className="hihat-closed-space-control">
                    <ContinuousSliderControl
                      label="Space"
                      value={hihatClosedSpace}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(nextValue) => {
                        switchToCustomIfNeeded();
                        setHihatClosedSpace(nextValue);
                      }}
                    />
                  </div>

                  <div className="hihat-closed-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      minValue={hihatClosedVelocityMin}
                      maxValue={hihatClosedVelocityMax}
                      min={1}
                      max={127}
                      step={1}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setHihatClosedVelocityMin(nextMin);
                        setHihatClosedVelocityMax(nextMax);
                      }}
                    />
                  </div>

                  <div
                    className={`hihat-closed-ghost-section ${hihatClosedGhostEnabled ? "ghost-section-enabled" : "ghost-section-disabled"}`}
                  >
                    <div className="hihat-closed-ghost-head">
                      <h4>ghost layer</h4>
                      <label className="field-checkbox field-checkbox-icon" aria-label="Hi-Hat Closed ghost enabled">
                        <input
                          type="checkbox"
                          checked={hihatClosedGhostEnabled}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setHihatClosedGhostEnabled(event.target.checked);
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                    </div>

                    <div className="hihat-closed-ghost-top-row">
                      <div className="hihat-closed-ghost-density">
                        <KnobControl
                          label="density"
                          min={0}
                          max={1}
                          step={0.01}
                          value={hihatClosedGhostDensity}
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setHihatClosedGhostDensity(nextValue);
                          }}
                        />
                      </div>

                      <div className="hihat-closed-ghost-velocity">
                        <VerticalSliderControl
                          label="velocity"
                          min={1}
                          max={127}
                          step={1}
                          value={hihatClosedGhostVelocity}
                          showValueInHandle
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setHihatClosedGhostVelocity(nextValue);
                          }}
                        />
                      </div>

                      <div className="hihat-closed-ghost-placement">
                        <GhostPlacementControl
                          value={hihatClosedGhostPlacement}
                          ariaLabel="Hi-Hat Closed ghost placement"
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setHihatClosedGhostPlacement(nextValue);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section
                className={`instrument-card instrument-card-ride ${rideEnabled ? "instrument-card-green-enabled" : "instrument-card-green-disabled"}`}
              >
                <div className="instrument-head">
                  <h3>Ride</h3>
                  <label className="field-checkbox field-checkbox-icon" aria-label="Ride enabled">
                    <input
                      type="checkbox"
                      checked={rideEnabled}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setRideEnabled(event.target.checked);
                      }}
                    />
                    <span>Enabled</span>
                  </label>
                  <p>Use it as an alternate pulse layer with its own spacing and feel.</p>
                </div>

                <div className="instrument-body instrument-body-ride">
                  <div className="ride-top-row">
                    <div className="ride-top-cell ride-top-cell-division">
                      <HandleOptionSliderControl
                        label="Division"
                        value={rideDivision}
                        options={DIVISION_OPTIONS}
                        orientation="vertical"
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setRideDivision(nextValue as (typeof DIVISION_OPTIONS)[number]["value"]);
                        }}
                      />
                    </div>

                    <div className="ride-top-cell ride-top-cell-timing">
                      <TimingFeelControl
                        value={rideTimingFeel}
                        ariaLabel="Ride timing feel"
                        className="timing-feel-control-vertical"
                        options={[
                          { value: "push", label: "Push", shape: "center" },
                          { value: "neutral", label: "Neutral", shape: "center" },
                          { value: "drag", label: "Drag", shape: "center" },
                          { value: "random", label: "Random", shape: "center random" },
                        ]}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setRideTimingFeel(nextValue);
                        }}
                      />
                    </div>
                  </div>

                  <div className="pulse-top-label-row">
                    <span>Division</span>
                    <span>Timing Feel</span>
                  </div>

                  <div className="ride-space-control">
                    <ContinuousSliderControl
                      label="Space"
                      value={rideSpace}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(nextValue) => {
                        switchToCustomIfNeeded();
                        setRideSpace(nextValue);
                      }}
                    />
                  </div>

                  <div className="ride-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      minValue={rideVelocityMin}
                      maxValue={rideVelocityMax}
                      min={1}
                      max={127}
                      step={1}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setRideVelocityMin(nextMin);
                        setRideVelocityMax(nextMax);
                      }}
                    />
                  </div>

                  <div className={`ride-ghost-section ${rideGhostEnabled ? "ghost-section-enabled" : "ghost-section-disabled"}`}>
                    <div className="ride-ghost-head">
                      <h4>ghost layer</h4>
                      <label className="field-checkbox field-checkbox-icon" aria-label="Ride ghost enabled">
                        <input
                          type="checkbox"
                          checked={rideGhostEnabled}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setRideGhostEnabled(event.target.checked);
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                    </div>

                    <div className="ride-ghost-top-row">
                      <div className="ride-ghost-density">
                        <KnobControl
                          label="density"
                          min={0}
                          max={1}
                          step={0.01}
                          value={rideGhostDensity}
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setRideGhostDensity(nextValue);
                          }}
                        />
                      </div>

                      <div className="ride-ghost-velocity">
                        <VerticalSliderControl
                          label="velocity"
                          min={1}
                          max={127}
                          step={1}
                          value={rideGhostVelocity}
                          showValueInHandle
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setRideGhostVelocity(nextValue);
                          }}
                        />
                      </div>

                      <div className="ride-ghost-placement">
                        <GhostPlacementControl
                          value={rideGhostPlacement}
                          ariaLabel="Ride ghost placement"
                          onChange={(nextValue) => {
                            switchToCustomIfNeeded();
                            setRideGhostPlacement(nextValue);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              </div>
            </section>

            <section className="band-card band-card-accents">
              <div className="band-header">
                <h3>Accents</h3>
                <p>Open hat, crash, and toms add release, punctuation, and movement.</p>
              </div>

              <div className="band-grid band-grid-accents">
              <section
                className={`instrument-card instrument-card-compact instrument-card-accent-knob instrument-card-hihat-open ${hihatOpenEnabled ? "instrument-card-green-enabled" : "instrument-card-green-disabled"}`}
              >
                <div className="instrument-head">
                  <h3>Hi-Hat Open</h3>
                  <label className="field-checkbox field-checkbox-icon" aria-label="Hi-Hat Open enabled">
                    <input
                      type="checkbox"
                      checked={hihatOpenEnabled}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setHihatOpenEnabled(event.target.checked);
                      }}
                    />
                    <span>Enabled</span>
                  </label>
                  <p>Use it as a release layer that punctuates the pulse instead of carrying it.</p>
                </div>

                <div className="instrument-body">
                  <div className="accent-density-control hihat-open-density-control">
                    <KnobControl
                      label="Density"
                      min={0}
                      max={1}
                      step={0.01}
                      value={hihatOpenDensity}
                      onChange={(nextValue) => {
                        switchToCustomIfNeeded();
                        setHihatOpenDensity(nextValue);
                      }}
                    />
                  </div>

                  <div className="accent-velocity-control hihat-open-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      minValue={hihatOpenVelocityMin}
                      maxValue={hihatOpenVelocityMax}
                      min={1}
                      max={127}
                      step={1}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setHihatOpenVelocityMin(nextMin);
                        setHihatOpenVelocityMax(nextMax);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section
                className={`instrument-card instrument-card-compact instrument-card-accent-knob instrument-card-crash ${crashEnabled ? "instrument-card-green-enabled" : "instrument-card-green-disabled"}`}
              >
                <div className="instrument-head">
                  <h3>Crash</h3>
                  <label className="field-checkbox field-checkbox-icon" aria-label="Crash enabled">
                    <input
                      type="checkbox"
                      checked={crashEnabled}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setCrashEnabled(event.target.checked);
                      }}
                    />
                    <span>Enabled</span>
                  </label>
                  <p>Use it for accent hits that frame sections without turning into a continuous layer.</p>
                </div>

                <div className="instrument-body">
                  <div className="accent-density-control crash-density-control">
                    <KnobControl
                      label="Density"
                      min={0}
                      max={1}
                      step={0.01}
                      value={crashDensity}
                      onChange={(nextValue) => {
                        switchToCustomIfNeeded();
                        setCrashDensity(nextValue);
                      }}
                    />
                  </div>

                  <div className="accent-velocity-control crash-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      minValue={crashVelocityMin}
                      maxValue={crashVelocityMax}
                      min={1}
                      max={127}
                      step={1}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setCrashVelocityMin(nextMin);
                        setCrashVelocityMax(nextMax);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="instrument-card instrument-card-compact instrument-card-accent-knob instrument-card-toms">
                <div className="instrument-head">
                  <h3>Toms</h3>
                  <p>Shape tom movement as one family, with separate hit budgets and shared dynamics.</p>
                </div>

                <div className="instrument-body">
                  <div className="toms-hit-controls">
                    <div className="toms-hit-control">
                      <HandleOptionSliderControl
                        label="High Hits"
                        value={String(tomsHighHits)}
                        options={TOMS_HIT_OPTIONS}
                        orientation="vertical"
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setTomsHighHits(Number(nextValue));
                        }}
                      />
                    </div>

                    <div className="toms-hit-control">
                      <HandleOptionSliderControl
                        label="Mid Hits"
                        value={String(tomsMidHits)}
                        options={TOMS_HIT_OPTIONS}
                        orientation="vertical"
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setTomsMidHits(Number(nextValue));
                        }}
                      />
                    </div>

                    <div className="toms-hit-control">
                      <HandleOptionSliderControl
                        label="Low Hits"
                        value={String(tomsLowHits)}
                        options={TOMS_HIT_OPTIONS}
                        orientation="vertical"
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setTomsLowHits(Number(nextValue));
                        }}
                      />
                    </div>
                  </div>

                  <div className="accent-velocity-control toms-velocity-control">
                    <VelocityRangeControl
                      label="Velocity"
                      minValue={tomsVelocityMin}
                      maxValue={tomsVelocityMax}
                      min={1}
                      max={127}
                      step={1}
                      onChange={(nextMin, nextMax) => {
                        switchToCustomIfNeeded();
                        setTomsVelocityMin(nextMin);
                        setTomsVelocityMax(nextMax);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="instrument-card instrument-card-compact instrument-card-fill">
                <div className="instrument-head">
                  <h3>Fill</h3>
                  <p>Control how often fills appear and how far they stretch the phrase.</p>
                </div>

                <div className="instrument-body">
                  <div className="fill-step-controls">
                    <div className="fill-step-control">
                      <HandleOptionSliderControl
                        label="Intensity"
                        value={fillIntensity}
                        options={FILL_INTENSITY_OPTIONS}
                        slotCount={4}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setFillIntensity(nextValue as "off" | "low" | "medium" | "high");
                        }}
                      />
                    </div>

                    <div className={`fill-step-control ${fillIntensity === "off" ? "field-muted" : ""}`}>
                      <HandleOptionSliderControl
                        label="Length"
                        value={fillLength}
                        options={FILL_LENGTH_OPTIONS}
                        slotCount={3}
                        disabled={fillIntensity === "off"}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setFillLength(nextValue as "short" | "medium" | "long");
                        }}
                      />
                    </div>

                    <div className={`fill-step-control ${fillIntensity === "off" ? "field-muted" : ""}`}>
                      <HandleOptionSliderControl
                        label="Every"
                        value={String(fillEvery)}
                        options={FILL_EVERY_OPTIONS}
                        slotCount={4}
                        disabled={fillIntensity === "off"}
                        onChange={(nextValue) => {
                          switchToCustomIfNeeded();
                          setFillEvery(Number(nextValue));
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>
              </div>
            </section>
          </div>

          <section className="pattern-grid-card card">
            <div className="pattern-grid-head">
              <h3>Pattern Grid</h3>
              <div className="pattern-grid-head-meta">
                {inlineErrorText ? (
                  <span className="pattern-grid-error-inline" title={inlineErrorText}>
                    {inlineErrorText}
                  </span>
                ) : null}
                <p>
                  {isEditGridEnabled
                    ? "Click a filled cell to remove the visible hit, click an empty cell to add a manual main hit, and drag horizontally on the same row to move hits."
                    : "Grid editing is off. Inspect the generated pattern visually without changing it."}
                </p>
              </div>
            </div>

            <div
              className={`pattern-grid-scroll ${isEditGridEnabled ? "" : "pattern-grid-scroll-locked"}`}
              onWheel={handlePatternGridWheel}
            >
              <div className="pattern-grid">
                {gridRows.map((row) => (
                  <div key={row.instrument} className="pattern-row">
                    <div className="pattern-row-label">
                      <button
                        type="button"
                        className={`pattern-row-lock ${lockedInstruments.includes(row.instrument) ? "pattern-row-lock-locked" : ""}`}
                        aria-label={lockedInstruments.includes(row.instrument) ? `Unlock ${row.label}` : `Lock ${row.label}`}
                        aria-pressed={lockedInstruments.includes(row.instrument)}
                        onClick={() => {
                          handleToggleInstrumentLock(row.instrument);
                        }}
                      >
                        <LockIcon locked={lockedInstruments.includes(row.instrument)} />
                      </button>
                      <span>{row.label}</span>
                      {getInstrumentStatus(row.instrument as InstrumentId) ? (
                        <span
                          className={`pattern-row-status pattern-row-status-${getInstrumentStatus(row.instrument as InstrumentId)?.kind}`}
                        >
                          {getInstrumentStatus(row.instrument as InstrumentId)?.label}
                        </span>
                      ) : null}
                    </div>

                    <div className="pattern-row-bars">
                      {row.bars.map((bar, barIndex) => (
                        <div
                          key={`${row.instrument}-${barIndex}`}
                          className="pattern-bar"
                          style={{ gridTemplateColumns: `repeat(${pattern.meta.slots_per_bar}, minmax(21px, 1fr))` }}
                        >
                          {bar.map((cell, slotIndex) => {
                            const numerator = numeratorFromGrouping(pattern.meta.grouping) ?? 4;
                            const quarterSize = pattern.meta.slots_per_bar / numerator;
                            const style =
                              cell.event && cell.event.hit_type !== "ghost"
                                ? { backgroundColor: velocityColor(cell.event.velocity) }
                                : undefined;
                            const className = [
                              "pattern-cell",
                              cell.fillActive ? "pattern-cell-fill" : "",
                              cell.event ? `pattern-cell-${cell.event.hit_type}` : "",
                              cell.event && !isEditGridEnabled ? "pattern-cell-readonly" : "",
                              slotIndex % 8 === 0 ? "pattern-cell-strong" : "",
                              slotIndex % 2 === 0 ? "pattern-cell-even" : "",
                              quarterSize > 0 && slotIndex % quarterSize === 0 ? "pattern-cell-quarter" : "",
                            ]
                              .filter(Boolean)
                              .join(" ");

                            return (
                              <div
                                key={`${row.instrument}-${barIndex}-${slotIndex}`}
                                className={className}
                                style={style}
                                onClick={() => void handleGridCellClick(row.instrument, barIndex, slotIndex, cell.event)}
                                draggable={Boolean(cell.event) && !isEditingPattern && isEditGridEnabled}
                                onDragStart={() => {
                                  if (!cell.event || !isEditGridEnabled) {
                                    return;
                                  }
                                  setDragState({
                                    instrument: row.instrument,
                                    bar: barIndex,
                                    slot: slotIndex,
                                    hitType: cell.event.hit_type,
                                  });
                                }}
                                onDragOver={(dragEvent) => {
                                  if (isEditGridEnabled && dragState?.instrument === row.instrument) {
                                    dragEvent.preventDefault();
                                  }
                                }}
                                onDrop={(dragEvent) => {
                                  dragEvent.preventDefault();
                                  void handleGridDrop(row.instrument, barIndex, slotIndex);
                                }}
                                onDragEnd={() => {
                                  setDragState(null);
                                }}
                                role="button"
                                tabIndex={0}
                                title={
                                  cell.event
                                    ? `${row.label} | bar ${barIndex + 1} slot ${slotIndex + 1} | ${cell.event.hit_type} | velocity ${cell.event.velocity} | offset ${cell.event.offset}`
                                    : `${row.label} | bar ${barIndex + 1} slot ${slotIndex + 1}`
                                }
                              >
                                {cell.event && cell.event.offset !== 0 ? (
                                  <span
                                    className={`pattern-offset pattern-offset-${cell.event.offset < 0 ? "left" : "right"}`}
                                  >
                                    {Math.abs(cell.event.offset)}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      </form>
      {pendingStructureChange ? (
        <div
          className="structure-confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              cancelPendingStructureChange();
            }
          }}
        >
          <div
            className="structure-confirm-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="structure-confirm-title"
            aria-describedby="structure-confirm-body"
          >
            <div className="structure-confirm-head">
              <h2 id="structure-confirm-title">Reset current pattern?</h2>
              <p id="structure-confirm-body">
                Changing pattern length or beat grouping will clear the current grid.
              </p>
            </div>

            <div className="structure-confirm-actions">
              <button type="button" className="button-secondary" onClick={cancelPendingStructureChange}>
                Cancel
              </button>
              <button type="button" onClick={confirmPendingStructureChange}>
                Reset grid
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
