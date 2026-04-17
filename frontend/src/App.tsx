import { FormEvent, useEffect, useRef, useState } from "react";

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
  velocityMin: 84,
  velocityMax: 118,
};

const DEFAULT_SNARE = {
  enabled: true,
  density: 0.4,
  syncopation: 1,
  timingFeel: "neutral" as const,
  velocityMin: 78,
  velocityMax: 114,
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
  velocityMin: 66,
  velocityMax: 94,
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
  velocityMin: 68,
  velocityMax: 96,
};

const DEFAULT_CRASH = {
  enabled: true,
  density: 0.12,
  velocityMin: 96,
  velocityMax: 112,
};

const DEFAULT_TOMS = {
  highHits: 0,
  midHits: 0,
  lowHits: 0,
  velocityMin: 74,
  velocityMax: 106,
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

function velocityColor(velocity: number): string {
  const clamped = Math.max(1, Math.min(127, velocity));
  const t = (clamped - 1) / 126;
  const start = { r: 186, g: 239, b: 174 };
  const end = { r: 111, g: 76, b: 214 };
  const r = Math.round(start.r + (end.r - start.r) * t);
  const g = Math.round(start.g + (end.g - start.g) * t);
  const b = Math.round(start.b + (end.b - start.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(CUSTOM_PRESET_ID);
  const [bpm, setBpm] = useState(120);
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
  const patternPlayerRef = useRef<PatternPlayer | null>(null);

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
    setPattern(null);
  }

  function applyPreset(preset: Preset) {
    setSelectedPreset(preset.id);
    setBpm(preset.settings.bpm);
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
    setPattern(null);
    setGenerateError("");
  }

  function handlePresetChange(value: string) {
    if (value === CUSTOM_PRESET_ID) {
      setSelectedPreset(CUSTOM_PRESET_ID);
      stopPlaybackStatefully();
      setPattern(null);
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
      const nextPattern = await generatePattern(buildRequest());
      setPattern(nextPattern);
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
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to generate ghost notes.");
    } finally {
      setIsGeneratingGhosts(false);
    }
  }

  async function handlePlay() {
    if (!pattern) {
      setGenerateError("Generate a pattern before playback.");
      return;
    }

    setGenerateError("");
    try {
      await getPatternPlayer().play(pattern, isLoopEnabled, bpm);
      setPlaybackStatus("Playing");
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to start playback.");
      setPlaybackStatus("Stopped");
    }
  }

  function handleStop() {
    stopPlaybackStatefully();
  }

  async function handleRestart() {
    if (!pattern) {
      setGenerateError("Generate a pattern before restarting playback.");
      return;
    }

    setGenerateError("");
    try {
      await getPatternPlayer().restart(bpm);
      setPlaybackStatus("Playing");
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Failed to restart playback.");
      setPlaybackStatus("Stopped");
    }
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

              <label className="field">
                <span>Preset</span>
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

              <label className="field">
                <span>BPM</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={bpm}
                  onChange={(event) => {
                    setBpm(Number(event.target.value));
                  }}
                />
              </label>

              <label className="field">
                <span>Pattern Length</span>
                <select
                  value={bars}
                  onChange={(event) => {
                    switchToCustomIfNeeded();
                    setBars(Number(event.target.value));
                  }}
                >
                  {[1, 2, 4, 8].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
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

              <label className="field">
                <span>Time Signature</span>
                <input type="text" value={timeSignature} readOnly />
              </label>
            </section>

            <section className="section-card">
              <div className="section-card-head">
                <h2>Humanization</h2>
                <p>Shape feel and repetition without changing the core groove logic.</p>
              </div>

              <label className="field">
                <span>Swing</span>
                <input
                  type="number"
                  min={0}
                  max={0.65}
                  step={0.01}
                  value={swing}
                  onChange={(event) => {
                    switchToCustomIfNeeded();
                    setSwing(Number(event.target.value));
                  }}
                />
              </label>

              <label className="field">
                <span>Humanize Timing</span>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={humanizeTiming}
                  onChange={(event) => {
                    switchToCustomIfNeeded();
                    setHumanizeTiming(Number(event.target.value));
                  }}
                />
              </label>

              <label className="field">
                <span>Humanize Velocity</span>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={humanizeVelocity}
                  onChange={(event) => {
                    switchToCustomIfNeeded();
                    setHumanizeVelocity(Number(event.target.value));
                  }}
                />
              </label>

              <label className="field">
                <span>Bar Similarity</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={barSimilarity}
                  onChange={(event) => {
                    switchToCustomIfNeeded();
                    setBarSimilarity(Number(event.target.value));
                  }}
                />
              </label>
            </section>

            <section className="section-card">
              <div className="section-card-head">
                <h2>Fill</h2>
                <p>Control how often fills appear and how far they stretch the phrase.</p>
              </div>

              <div className="inline-fields">
                <label className="field">
                  <span>Intensity</span>
                  <select
                    value={fillIntensity}
                    onChange={(event) => {
                      switchToCustomIfNeeded();
                      setFillIntensity(event.target.value as "off" | "low" | "medium" | "high");
                    }}
                  >
                    {["off", "low", "medium", "high"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={`field ${fillIntensity === "off" ? "field-muted" : ""}`}>
                  <span>Length</span>
                  <select
                    value={fillLength}
                    onChange={(event) => {
                      switchToCustomIfNeeded();
                      setFillLength(event.target.value as "short" | "medium" | "long");
                    }}
                    disabled={fillIntensity === "off"}
                  >
                    {["short", "medium", "long"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={`field ${fillIntensity === "off" ? "field-muted" : ""}`}>
                  <span>Every</span>
                  <select
                    value={fillEvery}
                    onChange={(event) => {
                      switchToCustomIfNeeded();
                      setFillEvery(Number(event.target.value));
                    }}
                    disabled={fillIntensity === "off"}
                  >
                    {[1, 2, 4, 8].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
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

                <p className="message">Playback: {playbackStatus}</p>
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
            <section className="band-card band-card-backbone">
              <div className="band-header">
                <h3>Backbone</h3>
                <p>Kick and snare define the structural weight of the groove.</p>
              </div>

              <div className="band-grid band-grid-2">
              <section className="instrument-card">
                <div className="instrument-head">
                  <h3>Kick</h3>
                  <p>Dial in the backbone of the groove first.</p>
                </div>

                <div className="instrument-body">
                  <label className="field-checkbox">
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

                  <label className="field">
                    <span>Density</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={kickDensity}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setKickDensity(Number(event.target.value));
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Syncopation</span>
                    <select
                      value={kickSyncopation}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setKickSyncopation(Number(event.target.value));
                      }}
                    >
                      {SYNCOPATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Timing Feel</span>
                    <select
                      value={kickTimingFeel}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setKickTimingFeel(event.target.value as (typeof TIMING_FEEL_OPTIONS)[number]["value"]);
                      }}
                    >
                      {TIMING_FEEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={kickVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setKickVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={kickVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setKickVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </section>

              <section className="instrument-card">
                <div className="instrument-head">
                  <h3>Snare</h3>
                  <p>Set the backbeat weight and how much it pushes or relaxes the groove.</p>
                </div>

                <div className="instrument-body">
                  <label className="field-checkbox">
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

                  <label className="field">
                    <span>Density</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={snareDensity}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setSnareDensity(Number(event.target.value));
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Syncopation</span>
                    <select
                      value={snareSyncopation}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setSnareSyncopation(Number(event.target.value));
                      }}
                    >
                      {SYNCOPATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Timing Feel</span>
                    <select
                      value={snareTimingFeel}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setSnareTimingFeel(event.target.value as (typeof TIMING_FEEL_OPTIONS)[number]["value"]);
                      }}
                    >
                      {TIMING_FEEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={snareVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setSnareVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={snareVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setSnareVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="ghost-card">
                    <div className="ghost-card-head">
                      <h4>Ghost Layer</h4>
                      <p>Secondary snare notes, aligned with the desktop behavior.</p>
                    </div>

                    <label className="field-checkbox">
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

                    <label className="field">
                      <span>Density</span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={snareGhostDensity}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setSnareGhostDensity(Number(event.target.value));
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Velocity</span>
                      <input
                        type="number"
                        min={1}
                        max={127}
                        step={1}
                        value={snareGhostVelocity}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setSnareGhostVelocity(Number(event.target.value));
                        }}
                      />
                    </label>

                    <div className="field">
                      <span>Placement</span>
                      <div className="segmented-control" role="group" aria-label="Snare ghost placement">
                        {GHOST_PLACEMENT_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={
                              option.value === snareGhostPlacement
                                ? "segment-button segment-button-active"
                                : "segment-button"
                            }
                            onClick={() => {
                              switchToCustomIfNeeded();
                              setSnareGhostPlacement(option.value);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              </div>
            </section>

            <section className="band-card band-card-pulse">
              <div className="band-header">
                <h3>Pulse</h3>
                <p>Closed hat and ride handle spacing, subdivision, and forward motion.</p>
              </div>

              <div className="band-grid band-grid-2">
              <section className="instrument-card">
                <div className="instrument-head">
                  <h3>Hi-Hat Closed</h3>
                  <p>Shape the pulse layer with spacing, subdivision, and feel.</p>
                </div>

                <div className="instrument-body">
                  <label className="field-checkbox">
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

                  <label className="field">
                    <span>Division</span>
                    <select
                      value={hihatClosedDivision}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setHihatClosedDivision(event.target.value as (typeof DIVISION_OPTIONS)[number]["value"]);
                      }}
                    >
                      {DIVISION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Space</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={hihatClosedSpace}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setHihatClosedSpace(Number(event.target.value));
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Timing Feel</span>
                    <select
                      value={hihatClosedTimingFeel}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setHihatClosedTimingFeel(event.target.value as (typeof TIMING_FEEL_OPTIONS)[number]["value"]);
                      }}
                    >
                      {TIMING_FEEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={hihatClosedVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setHihatClosedVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={hihatClosedVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setHihatClosedVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="ghost-card">
                    <div className="ghost-card-head">
                      <h4>Ghost Layer</h4>
                      <p>Subtle pulse notes around the main closed-hat anchors.</p>
                    </div>

                    <label className="field-checkbox">
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

                    <label className="field">
                      <span>Density</span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={hihatClosedGhostDensity}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setHihatClosedGhostDensity(Number(event.target.value));
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Velocity</span>
                      <input
                        type="number"
                        min={1}
                        max={127}
                        step={1}
                        value={hihatClosedGhostVelocity}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setHihatClosedGhostVelocity(Number(event.target.value));
                        }}
                      />
                    </label>

                    <div className="field">
                      <span>Placement</span>
                      <div className="segmented-control" role="group" aria-label="Hi-Hat Closed ghost placement">
                        {GHOST_PLACEMENT_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={
                              option.value === hihatClosedGhostPlacement
                                ? "segment-button segment-button-active"
                                : "segment-button"
                            }
                            onClick={() => {
                              switchToCustomIfNeeded();
                              setHihatClosedGhostPlacement(option.value);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="instrument-card">
                <div className="instrument-head">
                  <h3>Ride</h3>
                  <p>Use it as an alternate pulse layer with its own spacing and feel.</p>
                </div>

                <div className="instrument-body">
                  <label className="field-checkbox">
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

                  <label className="field">
                    <span>Division</span>
                    <select
                      value={rideDivision}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setRideDivision(event.target.value as (typeof DIVISION_OPTIONS)[number]["value"]);
                      }}
                    >
                      {DIVISION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Space</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={rideSpace}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setRideSpace(Number(event.target.value));
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Timing Feel</span>
                    <select
                      value={rideTimingFeel}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setRideTimingFeel(event.target.value as (typeof TIMING_FEEL_OPTIONS)[number]["value"]);
                      }}
                    >
                      {TIMING_FEEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={rideVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setRideVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={rideVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setRideVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="ghost-card">
                    <div className="ghost-card-head">
                      <h4>Ghost Layer</h4>
                      <p>Low-velocity ride taps, matching the Python desktop controls.</p>
                    </div>

                    <label className="field-checkbox">
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

                    <label className="field">
                      <span>Density</span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={rideGhostDensity}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setRideGhostDensity(Number(event.target.value));
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Velocity</span>
                      <input
                        type="number"
                        min={1}
                        max={127}
                        step={1}
                        value={rideGhostVelocity}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setRideGhostVelocity(Number(event.target.value));
                        }}
                      />
                    </label>

                    <div className="field">
                      <span>Placement</span>
                      <div className="segmented-control" role="group" aria-label="Ride ghost placement">
                        {GHOST_PLACEMENT_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={option.value === rideGhostPlacement ? "segment-button segment-button-active" : "segment-button"}
                            onClick={() => {
                              switchToCustomIfNeeded();
                              setRideGhostPlacement(option.value);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
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

              <div className="band-grid band-grid-3">
              <section className="instrument-card instrument-card-compact">
                <div className="instrument-head">
                  <h3>Hi-Hat Open</h3>
                  <p>Use it as a release layer that punctuates the pulse instead of carrying it.</p>
                </div>

                <div className="instrument-body">
                  <label className="field-checkbox">
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

                  <label className="field">
                    <span>Density</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={hihatOpenDensity}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setHihatOpenDensity(Number(event.target.value));
                      }}
                    />
                  </label>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={hihatOpenVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setHihatOpenVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={hihatOpenVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setHihatOpenVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </section>

              <section className="instrument-card instrument-card-compact">
                <div className="instrument-head">
                  <h3>Crash</h3>
                  <p>Use it for accent hits that frame sections without turning into a continuous layer.</p>
                </div>

                <div className="instrument-body">
                  <label className="field-checkbox">
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

                  <label className="field">
                    <span>Density</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={crashDensity}
                      onChange={(event) => {
                        switchToCustomIfNeeded();
                        setCrashDensity(Number(event.target.value));
                      }}
                    />
                  </label>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={crashVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setCrashVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={crashVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setCrashVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </section>

              <section className="instrument-card instrument-card-compact">
                <div className="instrument-head">
                  <h3>Toms</h3>
                  <p>Shape tom movement as one family, with separate hit budgets and shared dynamics.</p>
                </div>

                <div className="instrument-body">
                  <div className="inline-fields">
                    <label className="field">
                      <span>High Hits</span>
                      <input
                        type="number"
                        min={0}
                        max={3}
                        step={1}
                        value={tomsHighHits}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setTomsHighHits(Number(event.target.value));
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Mid Hits</span>
                      <input
                        type="number"
                        min={0}
                        max={3}
                        step={1}
                        value={tomsMidHits}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setTomsMidHits(Number(event.target.value));
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Low Hits</span>
                      <input
                        type="number"
                        min={0}
                        max={3}
                        step={1}
                        value={tomsLowHits}
                        onChange={(event) => {
                          switchToCustomIfNeeded();
                          setTomsLowHits(Number(event.target.value));
                        }}
                      />
                    </label>
                  </div>

                  <div className="field">
                    <span>Velocity</span>
                    <div className="range-fields">
                      <label className="field">
                        <span>Min</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={tomsVelocityMin}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setTomsVelocityMin(Number(event.target.value));
                          }}
                        />
                      </label>

                      <label className="field">
                        <span>Max</span>
                        <input
                          type="number"
                          min={1}
                          max={127}
                          step={1}
                          value={tomsVelocityMax}
                          onChange={(event) => {
                            switchToCustomIfNeeded();
                            setTomsVelocityMax(Number(event.target.value));
                          }}
                        />
                      </label>
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
              <div className={`pattern-grid-scroll ${isEditGridEnabled ? "" : "pattern-grid-scroll-locked"}`}>
                <div className="pattern-grid">
                  {gridRows.map((row) => (
                    <div key={row.instrument} className="pattern-row">
                      <div className="pattern-row-label">{row.label}</div>

                      <div className="pattern-row-bars">
                        {row.bars.map((bar, barIndex) => (
                          <div
                            key={`${row.instrument}-${barIndex}`}
                            className="pattern-bar"
                            style={{ gridTemplateColumns: `repeat(${pattern.meta.slots_per_bar}, minmax(14px, 1fr))` }}
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
              <div className="pattern-empty">
                <p>Generate a pattern to inspect the exact events coming back from the backend.</p>
              </div>
            )}
          </section>
        </section>
      </form>
    </main>
  );
}

export default App;
