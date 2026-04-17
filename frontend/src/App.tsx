import { FormEvent, useEffect, useState } from "react";

import { fetchPresets, generateMidi, type GenerateMidiInput, type Preset } from "./api";

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
};

const DEFAULT_HIHAT_CLOSED = {
  enabled: true,
  division: "sixteenth" as const,
  space: 0,
  timingFeel: "neutral" as const,
  velocityMin: 62,
  velocityMax: 92,
};

const DEFAULT_RIDE = {
  enabled: true,
  division: "eighth" as const,
  space: 0,
  timingFeel: "neutral" as const,
  velocityMin: 66,
  velocityMax: 94,
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
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [generateError, setGenerateError] = useState("");

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

  function switchToCustomIfNeeded() {
    if (selectedPreset !== CUSTOM_PRESET_ID) {
      setSelectedPreset(CUSTOM_PRESET_ID);
    }
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
    setHihatClosedEnabled(preset.hihat_closed.enabled);
    setHihatClosedDivision(preset.hihat_closed.division);
    setHihatClosedSpace(preset.hihat_closed.space);
    setHihatClosedTimingFeel(preset.hihat_closed.timing_feel);
    setHihatClosedVelocityMin(preset.hihat_closed.velocity_min);
    setHihatClosedVelocityMax(preset.hihat_closed.velocity_max);
    setRideEnabled(preset.ride.enabled);
    setRideDivision(preset.ride.division);
    setRideSpace(preset.ride.space);
    setRideTimingFeel(preset.ride.timing_feel);
    setRideVelocityMin(preset.ride.velocity_min);
    setRideVelocityMax(preset.ride.velocity_max);
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
    setGenerateError("");
  }

  function handlePresetChange(value: string) {
    if (value === CUSTOM_PRESET_ID) {
      setSelectedPreset(CUSTOM_PRESET_ID);
      return;
    }

    const preset = presets.find((item) => item.id === value);
    if (preset) {
      applyPreset(preset);
    }
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPreset) {
      setGenerateError("Select a preset before generating.");
      return;
    }
    if (currentGroupingError) {
      setGenerateError(currentGroupingError);
      return;
    }
    if (kickVelocityError) {
      setGenerateError(kickVelocityError);
      return;
    }
    if (snareVelocityError) {
      setGenerateError(snareVelocityError);
      return;
    }
    if (hihatClosedVelocityError) {
      setGenerateError(hihatClosedVelocityError);
      return;
    }
    if (rideVelocityError) {
      setGenerateError(rideVelocityError);
      return;
    }
    if (hihatOpenVelocityError) {
      setGenerateError(hihatOpenVelocityError);
      return;
    }
    if (crashVelocityError) {
      setGenerateError(crashVelocityError);
      return;
    }
    if (tomsVelocityError) {
      setGenerateError(tomsVelocityError);
      return;
    }

    setGenerateError("");
    setIsGenerating(true);

    try {
      const request: GenerateMidiInput = {
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
        hihat_closed_enabled: hihatClosedEnabled,
        hihat_closed_division: hihatClosedDivision,
        hihat_closed_space: hihatClosedSpace,
        hihat_closed_timing_feel: hihatClosedTimingFeel,
        hihat_closed_velocity_min: hihatClosedVelocityMin,
        hihat_closed_velocity_max: hihatClosedVelocityMax,
        ride_enabled: rideEnabled,
        ride_division: rideDivision,
        ride_space: rideSpace,
        ride_timing_feel: rideTimingFeel,
        ride_velocity_min: rideVelocityMin,
        ride_velocity_max: rideVelocityMax,
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

      const blob = await generateMidi(request);
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

  return (
    <main className="page-shell">
      <form className="app-layout" onSubmit={handleGenerate}>
        <aside className="sidebar card">
          <header className="hero">
            <h1>GhostGroove</h1>
            <p>generate drum MIDI from musical presets</p>
          </header>

          <div className="sidebar-form">
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
                  switchToCustomIfNeeded();
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

            <div className="section">
              <h2>Humanization</h2>

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
            </div>

            <div className="section">
              <h2>Fill</h2>

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

            <button
              type="submit"
              disabled={
                isLoadingPresets ||
                isGenerating ||
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
              {isGenerating ? "Generating..." : "Generate MIDI"}
            </button>
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-header">
            <h2>Instruments</h2>
            <p>Shape individual layers without changing the global groove architecture.</p>
          </div>

          <div className="workspace-panels">
            <div className="instrument-strip">
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
                </div>
              </section>

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
                </div>
              </section>
            </div>

            <aside className="special-column">
              <div className="special-column-header">
                <h3>Accent / Special</h3>
                <p>Short-form layers for release, accents, and future fill voices.</p>
              </div>

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
            </aside>
          </div>
        </section>
      </form>
    </main>
  );
}

export default App;
