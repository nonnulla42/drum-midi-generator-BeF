import { API_BASE_URL, type GeneratedPattern, type PatternEvent } from "./api";

const TICKS_PER_BEAT = 480;
const TICKS_PER_SLOT = TICKS_PER_BEAT / 8;

const MULTI_SAMPLE_LAYER_FILENAMES: Record<string, Record<number, string>> = {
  kick: {
    1: "kick_1.wav",
    2: "kick_2.wav",
    3: "kick_3.wav",
    4: "kick_4.wav",
  },
  snare: {
    1: "snare_1.wav",
    2: "snare_2.wav",
    3: "snare_3.wav",
    4: "snare_4.wav",
    5: "snare_5.wav",
  },
  hihat_closed: {
    1: "hihat_closed_1.wav",
    2: "hihat_closed_2.wav",
    3: "hihat_closed_3.wav",
    4: "hihat_closed_4.wav",
    5: "hihat_closed_5.wav",
  },
  ride: {
    1: "ride_1.wav",
    2: "ride_2.wav",
    3: "ride_3.wav",
  },
  hihat_open: {
    1: "hihat_open_1.wav",
    2: "hihat_open_2.wav",
    3: "hihat_open_3.wav",
  },
  tom_high: {
    1: "tom_high_1.wav",
    2: "tom_high_2.wav",
    3: "tom_high_3.wav",
  },
  tom_mid: {
    1: "tom_mid_1.wav",
    2: "tom_mid_2.wav",
    3: "tom_mid_3.wav",
  },
  tom_low: {
    1: "tom_low_1.wav",
    2: "tom_low_2.wav",
    3: "tom_low_3.wav",
  },
};

const SAMPLE_FILENAMES: Record<string, string> = {
  crash: "crash.wav",
};

const HIT_TYPE_SAMPLE_FILENAMES: Record<string, Record<string, string>> = {
  snare: {
    ghost: "snare_ghost.wav",
  },
  hihat_closed: {
    ghost: "hihat_closed_ghost.wav",
  },
  ride: {
    ghost: "ride_ghost.wav",
  },
};

type CompiledLoopEvent = {
  timeInLoopSec: number;
  instrument: string;
  hitType: PatternEvent["hit_type"];
  velocity: number;
  sampleFilename: string;
};

type PlaybackCommit = {
  pattern: GeneratedPattern;
  bpmOverride?: number | null;
};

type SchedulerConfig = {
  tickMs: number;
  lookaheadSec: number;
  initialStartOffsetSec: number;
};

type CompiledLoop = {
  events: CompiledLoopEvent[];
  durationSec: number;
  bpm: number;
  slotStartTimesSec: number[];
  totalSlots: number;
};

type TransportRuntime = {
  isRunning: boolean;
  loopStartAudioTimeSec: number;
  nextLoopBoundaryAudioTimeSec: number;
  scheduledThroughSec: number;
};

type QueuedPlaybackCommit = {
  pattern: GeneratedPattern;
  bpmOverride?: number;
  remainingSafetyLoops: number;
  onApplied: (() => void) | null;
  compiledLoop: CompiledLoop | null;
};

type QueuedPlaybackCommitState = {
  hasQueuedCommit: boolean;
  remainingSafetyLoops: number;
};

type PlaybackPositionState = {
  currentAbsoluteSlot: number | null;
};

function slotToTicks(slotIndex: number, swing: number): number {
  let ticks = slotIndex * TICKS_PER_SLOT;
  if (slotIndex % 2 === 1 && swing > 0) {
    ticks += TICKS_PER_SLOT * 0.45 * swing;
  }
  return ticks;
}

function ticksToMilliseconds(ticks: number, bpm: number): number {
  if (bpm <= 0) {
    return 0;
  }
  const beatMs = 60000 / bpm;
  return Math.round((ticks / TICKS_PER_BEAT) * beatMs);
}

function velocityLayer4(velocity: number): number {
  const clamped = Math.max(1, Math.min(127, velocity));
  if (clamped <= 31) return 1;
  if (clamped <= 63) return 2;
  if (clamped <= 95) return 3;
  return 4;
}

function velocityLayer3(velocity: number): number {
  const clamped = Math.max(1, Math.min(127, velocity));
  if (clamped <= 42) return 1;
  if (clamped <= 84) return 2;
  return 3;
}

function velocityLayer5(velocity: number): number {
  const clamped = Math.max(1, Math.min(127, velocity));
  if (clamped <= 31) return 1;
  if (clamped <= 55) return 2;
  if (clamped <= 75) return 3;
  if (clamped <= 100) return 4;
  return 5;
}

function velocityLayerForInstrument(instrument: string, velocity: number): number | null {
  if (instrument === "snare" || instrument === "hihat_closed") {
    return velocityLayer5(velocity);
  }
  if (instrument === "kick") {
    return velocityLayer4(velocity);
  }
  if (["ride", "hihat_open", "tom_high", "tom_mid", "tom_low"].includes(instrument)) {
    return velocityLayer3(velocity);
  }
  return null;
}

function playbackVolume(velocity: number, hitType: PatternEvent["hit_type"]): number {
  let volume = Math.max(0.15, Math.min(1, velocity / 127));
  if (hitType === "ghost") {
    volume = Math.min(1, volume * 2.00);
  }
  return volume;
}

function sampleFilenameForEvent(instrument: string, hitType: PatternEvent["hit_type"], velocity: number): string | null {
  const variantFilename = HIT_TYPE_SAMPLE_FILENAMES[instrument]?.[hitType];
  if (variantFilename) {
    return variantFilename;
  }

  const layer = velocityLayerForInstrument(instrument, velocity);
  if (layer !== null) {
    return MULTI_SAMPLE_LAYER_FILENAMES[instrument]?.[layer] ?? null;
  }

  return SAMPLE_FILENAMES[instrument] ?? null;
}

function chokeGroupForInstrument(instrument: string): string | null {
  if (instrument === "hihat_open") {
    return "hihat_open";
  }
  return null;
}

function chokeTargetsForInstrument(instrument: string): string[] {
  if (instrument === "hihat_closed") {
    return ["hihat_open"];
  }
  return [];
}

export class PatternPlayer {
  private static readonly SCHEDULER_CONFIG: SchedulerConfig = {
    tickMs: 25,
    lookaheadSec: 0.1,
    initialStartOffsetSec: 0.03,
  };

  private audioContext: AudioContext | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private activeSources = new Map<string, AudioBufferSourceNode[]>();
  private scheduledSources = new Set<AudioBufferSourceNode>();
  private schedulerTimer: number | null = null;
  private compiledLiveLoop: CompiledLoop | null = null;
  private runtime: TransportRuntime | null = null;
  private loopEnabled = false;
  private currentPattern: GeneratedPattern | null = null;
  private currentBpmOverride: number | null = null;
  private isPlaying = false;
  private queuedPlaybackCommit: QueuedPlaybackCommit | null = null;
  private queuedPlaybackCommitStateHandler: ((state: QueuedPlaybackCommitState) => void) | null = null;
  private playbackPositionStateHandler: ((state: PlaybackPositionState) => void) | null = null;
  private lastEmittedPlaybackSlot: number | null = null;

  async play(pattern: GeneratedPattern, loopEnabled: boolean, bpmOverride?: number): Promise<void> {
    const context = this.ensureAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }

    this.stop();
    this.currentPattern = pattern;
    this.currentBpmOverride = bpmOverride ?? null;
    this.loopEnabled = loopEnabled;
    this.compiledLiveLoop = await this.compileLoop(pattern, this.currentBpmOverride ?? undefined);
    const startTime = context.currentTime + PatternPlayer.SCHEDULER_CONFIG.initialStartOffsetSec;
    this.runtime = {
      isRunning: true,
      loopStartAudioTimeSec: startTime,
      nextLoopBoundaryAudioTimeSec: startTime + this.compiledLiveLoop.durationSec,
      scheduledThroughSec: startTime,
    };
    this.isPlaying = true;
    this.emitPlaybackPositionState(0);
    this.startScheduler();
  }

  async restart(bpmOverride?: number): Promise<void> {
    if (!this.currentPattern) {
      throw new Error("Generate a pattern before restarting playback.");
    }
    await this.play(this.currentPattern, this.loopEnabled, bpmOverride ?? this.currentBpmOverride ?? undefined);
  }

  stop(): void {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // Ignore already-stopped nodes.
      }
    }
    this.scheduledSources.clear();
    for (const sources of this.activeSources.values()) {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Ignore already-stopped nodes.
        }
      }
    }
    this.activeSources.clear();
    this.compiledLiveLoop = null;
    this.runtime = null;
    this.isPlaying = false;
    this.emitPlaybackPositionState(null);
  }

  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
  }

  queueLoopCommit(commit: {
    pattern: GeneratedPattern;
    bpmOverride?: number;
    remainingSafetyLoops?: number;
    onApplied?: () => void;
  }): void {
    const queuedCommit: QueuedPlaybackCommit = {
      pattern: commit.pattern,
      bpmOverride: commit.bpmOverride,
      remainingSafetyLoops: Math.max(0, commit.remainingSafetyLoops ?? 0),
      onApplied: commit.onApplied ?? null,
      compiledLoop: null,
    };
    this.queuedPlaybackCommit = queuedCommit;
    void this.prepareQueuedCommit(queuedCommit);
    this.emitQueuedPlaybackCommitState();
  }

  clearQueuedLoopCommit(): void {
    this.queuedPlaybackCommit = null;
    this.emitQueuedPlaybackCommitState();
  }

  peekQueuedLoopCommitPattern(): GeneratedPattern | null {
    return this.queuedPlaybackCommit?.pattern ?? null;
  }

  setQueuedPlaybackCommitStateHandler(handler: ((state: QueuedPlaybackCommitState) => void) | null): void {
    this.queuedPlaybackCommitStateHandler = handler;
    this.emitQueuedPlaybackCommitState();
  }

  setPlaybackPositionStateHandler(handler: ((state: PlaybackPositionState) => void) | null): void {
    this.playbackPositionStateHandler = handler;
    this.emitPlaybackPositionState(this.lastEmittedPlaybackSlot);
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  private async loadBuffer(filename: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(filename);
    if (cached) {
      return cached;
    }

    const response = await fetch(`${API_BASE_URL}/assets/drums/${filename}`);
    if (!response.ok) {
      throw new Error(`Missing audio sample: ${filename}`);
    }
    const data = await response.arrayBuffer();
    const buffer = await this.ensureAudioContext().decodeAudioData(data);
    this.bufferCache.set(filename, buffer);
    return buffer;
  }

  private async compileLoop(pattern: GeneratedPattern, bpmOverride?: number): Promise<CompiledLoop> {
    const events: CompiledLoopEvent[] = [];
    const playbackBpm = bpmOverride ?? pattern.meta.bpm;
    const totalSlots = pattern.meta.slots_per_bar * pattern.meta.bars;
    const slotStartTimesSec = Array.from({ length: totalSlots }, (_, slotIndex) =>
      Math.max(0, ticksToMilliseconds(slotToTicks(slotIndex, pattern.meta.swing), playbackBpm) / 1000),
    );

    for (const instrument of pattern.instrument_order) {
      for (const event of pattern.events[instrument] ?? []) {
        const sampleFilename = sampleFilenameForEvent(instrument, event.hit_type, event.velocity);
        if (!sampleFilename) {
          continue;
        }
        await this.loadBuffer(sampleFilename);
        const absoluteSlot = event.bar * pattern.meta.slots_per_bar + event.slot;
        const startTick = slotToTicks(absoluteSlot, pattern.meta.swing) + event.offset;
        events.push({
          timeInLoopSec: Math.max(0, ticksToMilliseconds(startTick, playbackBpm) / 1000),
          instrument,
          hitType: event.hit_type,
          velocity: event.velocity,
          sampleFilename,
        });
      }
    }

    return {
      events: events.sort((left, right) => left.timeInLoopSec - right.timeInLoopSec),
      durationSec: this.patternDurationMs(pattern, playbackBpm) / 1000,
      bpm: playbackBpm,
      slotStartTimesSec,
      totalSlots,
    };
  }

  private patternDurationMs(pattern: GeneratedPattern, bpmOverride?: number): number {
    const totalSlots = pattern.meta.slots_per_bar * pattern.meta.bars;
    const endTick = slotToTicks(totalSlots, pattern.meta.swing);
    return Math.max(1, ticksToMilliseconds(endTick, bpmOverride ?? pattern.meta.bpm));
  }

  private startScheduler(): void {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
    }
    this.tickScheduler();
    this.schedulerTimer = window.setInterval(() => {
      this.tickScheduler();
    }, PatternPlayer.SCHEDULER_CONFIG.tickMs);
  }

  private tickScheduler(): void {
    const context = this.audioContext;
    const runtime = this.runtime;
    const compiledLoop = this.compiledLiveLoop;
    if (!context || !runtime || !compiledLoop || !runtime.isRunning || !this.isPlaying) {
      return;
    }

    this.emitPlaybackPositionState(this.currentAbsoluteSlotForTime(context.currentTime, runtime, compiledLoop));

    const horizonSec = context.currentTime + PatternPlayer.SCHEDULER_CONFIG.lookaheadSec;
    while (runtime.scheduledThroughSec < horizonSec) {
      const segmentEndSec = this.loopEnabled
        ? Math.min(horizonSec, runtime.nextLoopBoundaryAudioTimeSec)
        : Math.min(horizonSec, runtime.loopStartAudioTimeSec + compiledLoop.durationSec);

      this.scheduleSegment(runtime.scheduledThroughSec, segmentEndSec, runtime.loopStartAudioTimeSec, compiledLoop);
      runtime.scheduledThroughSec = segmentEndSec;

      if (!this.loopEnabled || runtime.scheduledThroughSec < runtime.nextLoopBoundaryAudioTimeSec) {
        break;
      }

      const nextLoopStartSec = runtime.nextLoopBoundaryAudioTimeSec;
      this.applyQueuedPlaybackCommit();
      const nextCompiledLoop = this.compiledLiveLoop;
      if (!nextCompiledLoop) {
        runtime.isRunning = false;
        break;
      }
      runtime.loopStartAudioTimeSec = nextLoopStartSec;
      runtime.nextLoopBoundaryAudioTimeSec = nextLoopStartSec + nextCompiledLoop.durationSec;
      runtime.scheduledThroughSec = nextLoopStartSec;
    }
  }

  private applyQueuedPlaybackCommit(): void {
    if (!this.queuedPlaybackCommit) {
      return;
    }

    if (this.queuedPlaybackCommit.remainingSafetyLoops > 0) {
      this.queuedPlaybackCommit.remainingSafetyLoops -= 1;
      this.emitQueuedPlaybackCommitState();
      return;
    }

    const commit = this.queuedPlaybackCommit;
    if (!commit.compiledLoop) {
      return;
    }

    this.queuedPlaybackCommit = null;
    this.currentPattern = commit.pattern;
    this.currentBpmOverride = commit.bpmOverride ?? this.currentBpmOverride;
    this.compiledLiveLoop = commit.compiledLoop;
    this.emitQueuedPlaybackCommitState();
    commit.onApplied?.();
  }

  private emitQueuedPlaybackCommitState(): void {
    this.queuedPlaybackCommitStateHandler?.({
      hasQueuedCommit: this.queuedPlaybackCommit !== null,
      remainingSafetyLoops: this.queuedPlaybackCommit?.remainingSafetyLoops ?? 0,
    });
  }

  private emitPlaybackPositionState(currentAbsoluteSlot: number | null): void {
    if (this.lastEmittedPlaybackSlot === currentAbsoluteSlot) {
      return;
    }

    this.lastEmittedPlaybackSlot = currentAbsoluteSlot;
    this.playbackPositionStateHandler?.({ currentAbsoluteSlot });
  }

  private currentAbsoluteSlotForTime(
    currentTimeSec: number,
    runtime: TransportRuntime,
    compiledLoop: CompiledLoop,
  ): number {
    if (compiledLoop.totalSlots <= 0) {
      return 0;
    }

    const elapsedInLoopSec = Math.min(
      Math.max(0, currentTimeSec - runtime.loopStartAudioTimeSec),
      Math.max(0, compiledLoop.durationSec - Number.EPSILON),
    );

    for (let slotIndex = compiledLoop.slotStartTimesSec.length - 1; slotIndex >= 0; slotIndex -= 1) {
      if (elapsedInLoopSec >= compiledLoop.slotStartTimesSec[slotIndex]) {
        return slotIndex;
      }
    }

    return 0;
  }

  private async prepareQueuedCommit(commit: QueuedPlaybackCommit): Promise<void> {
    const compiledLoop = await this.compileLoop(commit.pattern, commit.bpmOverride);
    if (this.queuedPlaybackCommit !== commit) {
      return;
    }
    commit.compiledLoop = compiledLoop;
  }

  private scheduleSegment(
    windowStartSec: number,
    windowEndSec: number,
    loopStartAudioTimeSec: number,
    compiledLoop: CompiledLoop,
  ): void {
    const loopWindowStartSec = windowStartSec - loopStartAudioTimeSec;
    const loopWindowEndSec = windowEndSec - loopStartAudioTimeSec;
    for (const event of compiledLoop.events) {
      if (event.timeInLoopSec < loopWindowStartSec || event.timeInLoopSec >= loopWindowEndSec) {
        continue;
      }
      this.scheduleEvent(event, loopStartAudioTimeSec + event.timeInLoopSec);
    }
  }

  private scheduleEvent(event: CompiledLoopEvent, startTimeSec: number): void {
    const context = this.ensureAudioContext();
    const buffer = this.bufferCache.get(event.sampleFilename);
    if (!buffer) {
      return;
    }

    for (const chokeGroup of chokeTargetsForInstrument(event.instrument)) {
      const sources = this.activeSources.get(chokeGroup) ?? [];
      for (const source of sources) {
        try {
          source.stop(startTimeSec);
        } catch {
          // Ignore already-stopped nodes.
        }
      }
      this.activeSources.set(chokeGroup, []);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const gainNode = context.createGain();
    gainNode.gain.value = playbackVolume(event.velocity, event.hitType);

    source.connect(gainNode);
    gainNode.connect(context.destination);
    source.start(startTimeSec);
    this.scheduledSources.add(source);

    const chokeGroup = chokeGroupForInstrument(event.instrument);
    if (chokeGroup) {
      const sources = this.activeSources.get(chokeGroup) ?? [];
      sources.push(source);
      this.activeSources.set(chokeGroup, sources);
    }
    source.onended = () => {
      this.scheduledSources.delete(source);
      if (!chokeGroup) {
        return;
      }
      const remaining = (this.activeSources.get(chokeGroup) ?? []).filter((item) => item !== source);
      this.activeSources.set(chokeGroup, remaining);
    };
  }
}
