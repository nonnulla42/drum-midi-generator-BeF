from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

from PySide6.QtCore import QObject, Qt, QTimer, Signal

from core.pattern import DrumHit, DrumPattern
from core.timing import slot_to_ticks, ticks_to_milliseconds

try:
    import pygame
except ImportError:  # pragma: no cover - depends on local environment
    pygame = None


SAMPLE_FILENAMES = {
    "kick": "kick.wav",
    "snare": "snare.wav",
    "hihat_closed": "hihat_closed.wav",
    "hihat_open": "hihat_open.wav",
    "tom_high": "tom_high.wav",
    "tom_mid": "tom_mid.wav",
    "tom_low": "tom_low.wav",
    "crash": "crash.wav",
    "ride": "ride.wav",
}

MULTI_SAMPLE_LAYER_FILENAMES = {
    "kick": {
        1: "kick_1.wav",
        2: "kick_2.wav",
        3: "kick_3.wav",
        4: "kick_4.wav",
    },
    "snare": {
        1: "snare_1.wav",
        2: "snare_2.wav",
        3: "snare_3.wav",
        4: "snare_4.wav",
        5: "snare_5.wav",
    },
    "hihat_closed": {
        1: "hihat_closed_1.wav",
        2: "hihat_closed_2.wav",
        3: "hihat_closed_3.wav",
        4: "hihat_closed_4.wav",
        5: "hihat_closed_5.wav",
    },
    "ride": {
        1: "ride_1.wav",
        2: "ride_2.wav",
        3: "ride_3.wav",
    },
    "hihat_open": {
        1: "hihat_open_1.wav",
        2: "hihat_open_2.wav",
        3: "hihat_open_3.wav",
    },
    "tom_high": {
        1: "tom_high_1.wav",
        2: "tom_high_2.wav",
        3: "tom_high_3.wav",
    },
    "tom_mid": {
        1: "tom_mid_1.wav",
        2: "tom_mid_2.wav",
        3: "tom_mid_3.wav",
    },
    "tom_low": {
        1: "tom_low_1.wav",
        2: "tom_low_2.wav",
        3: "tom_low_3.wav",
    },
}

HIT_TYPE_SAMPLE_FILENAMES = {
    "snare": {
        "ghost": "snare_ghost.wav",
    },
    "hihat_closed": {
        "ghost": "hihat_closed_ghost.wav",
    },
    "ride": {
        "ghost": "ride_ghost.wav",
    },
}


@dataclass(slots=True)
class ScheduledHit:
    time_ms: int
    instrument: str
    hit_type: str
    sample_key: str
    velocity: int


class PatternPlaybackEngine(QObject):
    state_changed = Signal(str)
    info_message = Signal(str)

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setTimerType(Qt.TimerType.PreciseTimer)
        self._timer.timeout.connect(self._process_next_event)

        self._sample_root = Path(__file__).resolve().parents[1] / "assets" / "drums"
        self._sounds: dict[str, object] = {}
        self._missing_sample_files: set[str] = set()
        self._mixer_ready = False
        self._active_choke_channels: dict[str, list[object]] = {"hihat_open": []}

        self._current_pattern: DrumPattern | None = None
        self._events: list[ScheduledHit] = []
        self._loop_enabled = True
        self._is_playing = False
        self._event_index = 0
        self._loop_start_time = 0.0
        self._loop_duration_ms = 0
        self._waiting_for_loop_restart = False

    @property
    def is_playing(self) -> bool:
        return self._is_playing

    def set_loop_enabled(self, enabled: bool) -> None:
        self._loop_enabled = enabled

    def play_pattern(self, pattern: DrumPattern, loop_enabled: bool | None = None, bpm_override: int | None = None) -> bool:
        if loop_enabled is not None:
            self._loop_enabled = loop_enabled
        self._current_pattern = pattern

        if pygame is None:
            self._set_stopped()
            self.info_message.emit("Playback unavailable: install `pygame` from requirements.txt.")
            return False

        if not self._ensure_mixer_ready():
            self._set_stopped()
            return False

        self._load_samples()
        playback_bpm = pattern.settings.bpm if bpm_override is None else bpm_override
        events = self._build_schedule(pattern, playback_bpm)
        if not events:
            self._set_stopped()
            self.info_message.emit(
                "No playable hits found. Add samples in assets/drums/ and generate a pattern with active hits."
            )
            return False

        self.stop()
        self._events = events
        self._current_pattern = pattern
        self._loop_duration_ms = self._pattern_duration_ms(pattern, playback_bpm)
        self._event_index = 0
        self._loop_start_time = perf_counter()
        self._waiting_for_loop_restart = False
        self._is_playing = True
        self.state_changed.emit("Playing")
        self._schedule_next_event()
        self._emit_missing_sample_info(pattern)
        return True

    def restart(self, bpm_override: int | None = None) -> bool:
        if self._current_pattern is None:
            self.info_message.emit("Generate a pattern before restarting playback.")
            return False
        return self.play_pattern(self._current_pattern, bpm_override=bpm_override)

    def stop(self) -> None:
        self._timer.stop()
        self._stop_all_audio()
        self._set_stopped()

    def _ensure_mixer_ready(self) -> bool:
        if pygame is None:
            return False
        if self._mixer_ready:
            return True
        try:
            pygame.mixer.pre_init(frequency=44100, size=-16, channels=2, buffer=512)
            pygame.mixer.init()
            pygame.mixer.set_num_channels(24)
        except Exception as exc:  # pragma: no cover - depends on local audio device
            self.info_message.emit(f"Playback unavailable: could not initialize audio device ({exc}).")
            return False
        self._mixer_ready = True
        return True

    def _load_samples(self) -> None:
        if pygame is None or not self._mixer_ready:
            return
        for sample_key, filename in self._iter_sample_filename_items():
            if sample_key in self._sounds or filename in self._missing_sample_files:
                continue
            sample_path = self._sample_root / filename
            if not sample_path.exists():
                self._missing_sample_files.add(filename)
                continue
            try:
                self._sounds[sample_key] = pygame.mixer.Sound(str(sample_path))
            except Exception as exc:  # pragma: no cover - depends on local sample files
                self._missing_sample_files.add(filename)
                self.info_message.emit(f"Sample not loaded: {filename} ({exc}).")

    def _build_schedule(self, pattern: DrumPattern, bpm: int | None = None) -> list[ScheduledHit]:
        playback_bpm = pattern.settings.bpm if bpm is None else bpm
        scheduled_hits: list[ScheduledHit] = []
        for hit in sorted(pattern.iter_hits(), key=self._hit_sort_key):
            sample_key = self._resolve_sample_key(hit.instrument, hit.hit_type, hit.velocity)
            if sample_key is None:
                continue
            absolute_slot = hit.bar_index * pattern.total_slots_per_bar + hit.slot_index
            start_tick = slot_to_ticks(absolute_slot, pattern.settings.swing) + hit.micro_timing_offset
            scheduled_hits.append(
                ScheduledHit(
                    time_ms=max(0, ticks_to_milliseconds(start_tick, playback_bpm)),
                    instrument=hit.instrument,
                    hit_type=hit.hit_type,
                    sample_key=sample_key,
                    velocity=hit.velocity,
                )
            )
        scheduled_hits.sort(key=lambda event: event.time_ms)
        return scheduled_hits

    def _pattern_duration_ms(self, pattern: DrumPattern, bpm: int | None = None) -> int:
        playback_bpm = pattern.settings.bpm if bpm is None else bpm
        end_tick = slot_to_ticks(pattern.total_slots, pattern.settings.swing)
        return max(1, ticks_to_milliseconds(end_tick, playback_bpm))

    def _schedule_next_event(self) -> None:
        if not self._is_playing:
            return
        if self._event_index >= len(self._events):
            self._handle_loop_boundary()
            return
        now_ms = int((perf_counter() - self._loop_start_time) * 1000)
        next_event = self._events[self._event_index]
        wait_ms = max(0, next_event.time_ms - now_ms)
        self._timer.start(wait_ms)

    def _process_next_event(self) -> None:
        if not self._is_playing:
            return
        if self._waiting_for_loop_restart:
            self._restart_loop()
            return

        now_ms = int((perf_counter() - self._loop_start_time) * 1000)
        tolerance_ms = 3
        while self._event_index < len(self._events):
            event = self._events[self._event_index]
            if event.time_ms > now_ms + tolerance_ms:
                break
            self._play_hit(event)
            self._event_index += 1
        self._schedule_next_event()

    def _handle_loop_boundary(self) -> None:
        if not self._is_playing:
            return
        if not self._loop_enabled:
            self.stop()
            return
        elapsed_ms = int((perf_counter() - self._loop_start_time) * 1000)
        wait_ms = max(0, self._loop_duration_ms - elapsed_ms)
        self._waiting_for_loop_restart = True
        self._timer.start(wait_ms)

    def _restart_loop(self) -> None:
        if not self._is_playing:
            return
        self._waiting_for_loop_restart = False
        self._event_index = 0
        self._loop_start_time = perf_counter()
        self._schedule_next_event()

    def _play_hit(self, event: ScheduledHit) -> None:
        if pygame is None or not self._mixer_ready:
            return
        sound = self._sounds.get(event.sample_key)
        if sound is None:
            return
        self._apply_choke_groups(event.instrument)
        channel = pygame.mixer.find_channel(force=True)
        if channel is None:
            return
        volume = _playback_volume(event.velocity, event.hit_type)
        channel.set_volume(volume)
        channel.play(sound)
        self._register_active_channel(event.instrument, channel)

    def _emit_missing_sample_info(self, pattern: DrumPattern) -> None:
        active_missing: list[str] = []
        missing_reported: set[str] = set()
        for hit in pattern.iter_hits():
            if self._resolve_sample_key(hit.instrument, hit.hit_type, hit.velocity) is not None:
                continue
            missing_filename = self._expected_sample_filename(hit.instrument, hit.hit_type, hit.velocity)
            if missing_filename and missing_filename not in missing_reported:
                missing_reported.add(missing_filename)
                active_missing.append(missing_filename)
        if active_missing:
            self.info_message.emit(
                "Playback partial: missing sample files in assets/drums/ -> "
                + ", ".join(active_missing)
            )

    def _stop_all_audio(self) -> None:
        if pygame is None or not self._mixer_ready:
            return
        try:
            pygame.mixer.stop()
        except Exception:
            return
        finally:
            self._clear_active_choke_channels()

    def _set_stopped(self) -> None:
        self._is_playing = False
        self._event_index = 0
        self._events = []
        self._waiting_for_loop_restart = False
        self._clear_active_choke_channels()
        self.state_changed.emit("Stopped")

    def _iter_sample_filename_items(self) -> list[tuple[str, str]]:
        items: list[tuple[str, str]] = []
        for instrument, layer_map in MULTI_SAMPLE_LAYER_FILENAMES.items():
            for layer, filename in sorted(layer_map.items()):
                items.append((self._layer_sample_key(instrument, layer), filename))
        items.extend((instrument, filename) for instrument, filename in SAMPLE_FILENAMES.items())
        for instrument, hit_type_map in HIT_TYPE_SAMPLE_FILENAMES.items():
            for hit_type, filename in hit_type_map.items():
                items.append((self._variant_sample_key(instrument, hit_type), filename))
        return items

    def _resolve_sample_key(self, instrument: str, hit_type: str, velocity: int) -> str | None:
        variant_filename = HIT_TYPE_SAMPLE_FILENAMES.get(instrument, {}).get(hit_type)
        if variant_filename is not None:
            variant_key = self._variant_sample_key(instrument, hit_type)
            if variant_key in self._sounds:
                return variant_key

        layer = _velocity_layer_for_instrument(instrument, velocity)
        if layer is not None:
            layer_key = self._resolve_layer_sample_key(instrument, layer)
            if layer_key is not None:
                return layer_key

        if instrument in self._sounds:
            return instrument
        return None

    def _expected_sample_filename(self, instrument: str, hit_type: str, velocity: int) -> str | None:
        variant_filename = HIT_TYPE_SAMPLE_FILENAMES.get(instrument, {}).get(hit_type)
        if variant_filename is not None:
            return variant_filename
        layer = _velocity_layer_for_instrument(instrument, velocity)
        if layer is not None:
            return MULTI_SAMPLE_LAYER_FILENAMES.get(instrument, {}).get(layer)
        return SAMPLE_FILENAMES.get(instrument)

    def _resolve_layer_sample_key(self, instrument: str, layer: int) -> str | None:
        layer_map = MULTI_SAMPLE_LAYER_FILENAMES.get(instrument, {})
        if not layer_map:
            return None
        preferred_layers = [layer, *sorted((candidate for candidate in layer_map if candidate != layer), key=lambda candidate: abs(candidate - layer))]
        for candidate_layer in preferred_layers:
            layer_key = self._layer_sample_key(instrument, candidate_layer)
            if layer_key in self._sounds:
                return layer_key
        return None

    @staticmethod
    def _variant_sample_key(instrument: str, hit_type: str) -> str:
        return f"{instrument}:{hit_type}"

    @staticmethod
    def _layer_sample_key(instrument: str, layer: int) -> str:
        return f"{instrument}:layer:{layer}"

    @staticmethod
    def _hit_sort_key(hit: DrumHit) -> tuple[int, int, int]:
        return (hit.bar_index, hit.slot_index, hit.micro_timing_offset)

    def _apply_choke_groups(self, instrument: str) -> None:
        for choke_group in _choke_targets_for_instrument(instrument):
            self._stop_choke_group(choke_group)

    def _stop_choke_group(self, choke_group: str) -> None:
        channels = self._active_choke_channels.get(choke_group, [])
        if not channels:
            return
        remaining: list[object] = []
        for channel in channels:
            if _channel_is_busy(channel):
                try:
                    channel.stop()
                except Exception:
                    remaining.append(channel)
        self._active_choke_channels[choke_group] = remaining

    def _register_active_channel(self, instrument: str, channel: object) -> None:
        choke_group = _choke_group_for_instrument(instrument)
        if choke_group is None:
            return
        channels = self._active_choke_channels.setdefault(choke_group, [])
        channels[:] = [existing for existing in channels if _channel_is_busy(existing)]
        channels.append(channel)

    def _clear_active_choke_channels(self) -> None:
        for choke_group in list(self._active_choke_channels):
            self._active_choke_channels[choke_group] = []


def _velocity_layer_for_instrument(instrument: str, velocity: int) -> int | None:
    if instrument in {"snare", "hihat_closed"}:
        return _velocity_layer_5(velocity)
    if instrument == "kick":
        return _velocity_layer_4(velocity)
    if instrument in {"ride", "hihat_open", "tom_high", "tom_mid", "tom_low"}:
        return _velocity_layer_3(velocity)
    return None


def _velocity_layer_4(velocity: int) -> int:
    clamped = max(1, min(127, velocity))
    if clamped <= 31:
        return 1
    if clamped <= 63:
        return 2
    if clamped <= 95:
        return 3
    return 4


def _velocity_layer_3(velocity: int) -> int:
    clamped = max(1, min(127, velocity))
    if clamped <= 42:
        return 1
    if clamped <= 84:
        return 2
    return 3


def _velocity_layer_5(velocity: int) -> int:
    clamped = max(1, min(127, velocity))
    if clamped <= 31:
        return 1
    if clamped <= 55:
        return 2
    if clamped <= 75:
        return 3
    if clamped <= 100:
        return 4
    return 5


def _playback_volume(velocity: int, hit_type: str) -> float:
    volume = max(0.15, min(1.0, velocity / 127))
    if hit_type == "ghost":
        volume = min(1.0, volume * 1.12)
    return volume


def _choke_group_for_instrument(instrument: str) -> str | None:
    if instrument == "hihat_open":
        return "hihat_open"
    return None


def _choke_targets_for_instrument(instrument: str) -> tuple[str, ...]:
    if instrument == "hihat_closed":
        return ("hihat_open",)
    return ()


def _channel_is_busy(channel: object) -> bool:
    get_busy = getattr(channel, "get_busy", None)
    if callable(get_busy):
        try:
            return bool(get_busy())
        except Exception:
            return True
    return True
