import { FormEvent, type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from "react";

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

const PLACEHOLDER_GRID_INSTRUMENTS = [
  "kick",
  "snare",
  "hihat_closed",
  "hihat_open",
  "ride",
  "crash",
  "tom_high",
  "tom_mid",
  "tom_low",
];

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

function buildPlaceholderGridRows() {
  return PLACEHOLDER_GRID_INSTRUMENTS.map((instrument) => ({
    instrument,
    label: INSTRUMENT_LABELS[instrument] ?? instrument,
    bars: [
      Array.from({ length: 32 }, () => ({
        event: null,
        fillActive: false,
      })),
    ],
  }));
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
    <div className="field">
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
};

function ContinuousSliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  showValueInHandle = false,
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
};

function VerticalSliderControl({ label, value, min, max, step, onChange }: VerticalSliderControlProps) {
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
          <div className="vertical-slider-handle" style={{ bottom: `${handlePercent}%` }} />
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
  const [pattern, setPattern] = useState<GeneratedPattern | null>(null);
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
  const patternPlayerRef = useRef<PatternPlayer | null>(null);
  const lockResetKeyRef = useRef(`${bars}:${normalizeGrouping(grouping)}`);
  const lastGenerateSignatureRef = useRef<string | null>(null);
  const seedWarningTimeoutRef = useRef<number | null>(null);

  const currentGroupingError = groupingError(grouping);
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
  const timeSignature = timeSignatureFromGrouping(grouping);
  const gridRows = pattern ? buildGridRows(pattern) : [];
  const placeholderGridRows = buildPlaceholderGridRows();

  useEffect(() => {
    const nextKey = `${bars}:${normalizeGrouping(grouping)}`;
    if (lockResetKeyRef.current === nextKey) {
      return;
    }
    lockResetKeyRef.current = nextKey;
    setLockedInstruments([]);
  }, [bars, grouping]);

  useEffect(() => {
    if (!pattern) {
      setLockedInstruments([]);
    }
  }, [pattern]);

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
    if (playbackStatus !== "Playing" || !pattern) {
      return;
    }

    void getPatternPlayer().restart(bpm).catch(() => {
      setPlaybackStatus("Stopped");
    });
  }, [bpm, pattern, playbackStatus]);

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

  function switchToCustomIfNeeded() {
    if (selectedPreset !== CUSTOM_PRESET_ID) {
      setSelectedPreset(CUSTOM_PRESET_ID);
    }
    stopPlaybackStatefully();
  }

  function applyPreset(preset: Preset) {
    setSelectedPreset(preset.id);
    setBpm(preset.settings.bpm);
    setSeed("random");
    setBars(preset.settings.bars);
    setGrouping(preset.settings.grouping);
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
    setGhostRerollCount(0);
    setGenerateError("");
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
      grouping: normalizeGrouping(grouping),
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

  async function handleGridCellClick(instrument: string, barIndex: number, slotIndex: number, event: PatternEvent | null) {
    if (!pattern || isEditingPattern || !isEditGridEnabled) {
      return;
    }

    setGenerateError("");
    setIsEditingPattern(true);

    try {
      const nextPattern = event
        ? await removePatternHit({
            pattern,
            instrument,
            bar: barIndex,
            slot: slotIndex,
          })
        : await addPatternBaseHit({
            pattern,
            instrument,
            bar: barIndex,
            slot: slotIndex,
          });
      setPattern(nextPattern);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to edit pattern.");
    } finally {
      setIsEditingPattern(false);
    }
  }

  async function handleGridDrop(instrument: string, barIndex: number, slotIndex: number) {
    if (!pattern || !dragState || isEditingPattern || !isEditGridEnabled) {
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
      const nextPattern = await movePatternHit({
        pattern,
        instrument,
        from_bar: dragState.bar,
        from_slot: dragState.slot,
        to_bar: barIndex,
        to_slot: slotIndex,
        hit_type: dragState.hitType,
      });
      setPattern(nextPattern);
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

    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    setIsGeneratingPattern(true);

    try {
      const request = buildRequest();
      const requestSignature = JSON.stringify(request);
      const shouldShowFixedSeedWarning =
        request.seed !== undefined && lastGenerateSignatureRef.current === requestSignature;
      const currentPattern = pattern;
      const nextPattern = await generatePattern(request);
      setPattern(mergeLockedInstrumentEvents(currentPattern, nextPattern, lockedInstruments));
      setGhostRerollCount(0);
      lastGenerateSignatureRef.current = requestSignature;
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
    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    setIsGenerating(true);

    try {
      const blob = pattern ? await exportPatternMidi(pattern, bpm) : await generateMidi(buildRequest());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ghostgroove.mid";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate MIDI.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateGhosts() {
    if (!pattern) {
      setGenerateError("Generate a pattern before generating ghosts.");
      return;
    }

    setGenerateError("");
    setIsGeneratingGhosts(true);

    try {
      stopPlaybackStatefully();
      const nextPattern = await generatePatternGhosts({
        pattern,
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
      setPattern(nextPattern);
      setGhostRerollCount((current) => current + 1);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate ghost notes.");
    } finally {
      setIsGeneratingGhosts(false);
    }
  }

  async function handlePlay() {
    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    try {
      let activePattern = pattern;
      if (!activePattern) {
        setIsGeneratingPattern(true);
        activePattern = await generatePattern(buildRequest());
        setPattern(activePattern);
        setGhostRerollCount(0);
        setIsGeneratingPattern(false);
      }
      await getPatternPlayer().play(activePattern, isLoopEnabled, bpm);
      setPlaybackStatus("Playing");
    } catch (error) {
      setIsGeneratingPattern(false);
      setGenerateError(error instanceof Error ? error.message : "Failed to start playback.");
      setPlaybackStatus("Stopped");
    }
  }

  function handleStop() {
    stopPlaybackStatefully();
  }

  async function handleRestart() {
    const validationError = getValidationError();
    if (validationError) {
      setGenerateError(validationError);
      return;
    }

    setGenerateError("");
    try {
      if (!pattern) {
        setIsGeneratingPattern(true);
        const nextPattern = await generatePattern(buildRequest());
        setPattern(nextPattern);
        setGhostRerollCount(0);
        setIsGeneratingPattern(false);
        await getPatternPlayer().play(nextPattern, isLoopEnabled, bpm);
      } else {
        await getPatternPlayer().restart(bpm);
      }
      setPlaybackStatus("Playing");
    } catch (error) {
      setIsGeneratingPattern(false);
      setGenerateError(error instanceof Error ? error.message : "Failed to restart playback.");
      setPlaybackStatus("Stopped");
    }
  }

  function handleClearPattern() {
    stopPlaybackStatefully();
    setPattern(null);
    setLockedInstruments([]);
    setGhostRerollCount(0);
    setGenerateError("");
  }

  function handleToggleInstrumentLock(instrument: string) {
    if (!pattern) {
      return;
    }

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

    setSelectedPreset(CUSTOM_PRESET_ID);
    setGhostRerollCount(0);
    setGenerateError("");
    setSwing(randomFloat(0, 0.28));
    setBarSimilarity(randomFloat(0, 1));
    setBars(randomChoice([1, 2, 4, 8]));
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
                showValueInHandle
                onChange={(nextValue) => {
                  switchToCustomIfNeeded();
                  setBars(Number(nextValue));
                }}
              />

              <div className="structure-grouping-row">
                <label className="field structure-grouping-field">
                  <span>Beat Grouping</span>
                  <input
                    type="text"
                    value={grouping}
                    onChange={(event) => {
                      switchToCustomIfNeeded();
                      setGrouping(event.target.value);
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

              {loadError ? <p className="message error">{loadError}</p> : null}
              {currentGroupingError ? <p className="message error">{currentGroupingError}</p> : null}
              {kickVelocityError ? <p className="message error">{kickVelocityError}</p> : null}
              {snareVelocityError ? <p className="message error">{snareVelocityError}</p> : null}
              {hihatClosedVelocityError ? <p className="message error">{hihatClosedVelocityError}</p> : null}
              {rideVelocityError ? <p className="message error">{rideVelocityError}</p> : null}
              {hihatOpenVelocityError ? <p className="message error">{hihatOpenVelocityError}</p> : null}
              {crashVelocityError ? <p className="message error">{crashVelocityError}</p> : null}
              {tomsVelocityError ? <p className="message error">{tomsVelocityError}</p> : null}
              {generateError ? <p className="message error">{generateError}</p> : null}

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
                      className="button-secondary"
                      onClick={() => void handleGenerateGhosts()}
                      disabled={!pattern || isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      {isGeneratingGhosts ? "Generating Ghosts..." : "Generate Ghosts"}
                    </button>
                  </div>

                  <div className="playback-actions-row playback-actions-row-secondary">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleClearPattern}
                      disabled={!pattern || isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
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
                      {isGenerating ? "Downloading MIDI..." : pattern ? "Download Edited MIDI" : "Download MIDI"}
                    </button>
                  </div>

                  <div className="playback-actions-row playback-actions-row-transport">
                    <button
                      type="button"
                      onClick={() => void handlePlay()}
                      disabled={!pattern || isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
                    >
                      Play
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleStop}
                      disabled={playbackStatus !== "Playing"}
                    >
                      Stop
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void handleRestart()}
                      disabled={!pattern || isLoadingPresets || isGeneratingPattern || isGenerating || isGeneratingGhosts || isEditingPattern}
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

                <p className="message playback-status">Playback: {playbackStatus}</p>
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
              <p>
                {isEditGridEnabled
                  ? "Click a filled cell to remove the visible hit, click an empty cell to add a manual main hit, and drag horizontally on the same row to move hits."
                  : "Grid editing is off. Inspect the generated pattern visually without changing it."}
              </p>
            </div>

            {pattern ? (
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
            ) : (
              <div
                className="pattern-grid-scroll pattern-grid-scroll-placeholder pattern-grid-scroll-locked"
                onWheel={handlePatternGridWheel}
              >
                <div className="pattern-grid">
                  {placeholderGridRows.map((row) => (
                    <div key={row.instrument} className="pattern-row pattern-row-placeholder">
                      <div className="pattern-row-label">
                        <button type="button" className="pattern-row-lock" disabled aria-label={`Lock ${row.label}`}>
                          <LockIcon locked={false} />
                        </button>
                        <span>{row.label}</span>
                      </div>

                      <div className="pattern-row-bars">
                        {row.bars.map((bar, barIndex) => (
                          <div
                            key={`${row.instrument}-${barIndex}`}
                            className="pattern-bar pattern-bar-placeholder"
                            style={{ gridTemplateColumns: "repeat(32, minmax(21px, 1fr))" }}
                          >
                            {bar.map((_, slotIndex) => {
                              const className = [
                                "pattern-cell",
                                "pattern-cell-placeholder",
                                slotIndex % 8 === 0 ? "pattern-cell-strong" : "",
                                slotIndex % 2 === 0 ? "pattern-cell-even" : "",
                                slotIndex % 8 === 0 ? "pattern-cell-quarter" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");

                              return <div key={`${row.instrument}-${barIndex}-${slotIndex}`} className={className} aria-hidden="true" />;
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </section>
      </form>
    </main>
  );
}

export default App;
