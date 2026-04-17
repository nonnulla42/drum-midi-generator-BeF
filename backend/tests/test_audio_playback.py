import unittest

from core.audio_playback import (
    PatternPlaybackEngine,
    _playback_volume,
    _choke_group_for_instrument,
    _choke_targets_for_instrument,
    _velocity_layer_3,
    _velocity_layer_4,
    _velocity_layer_5,
    _velocity_layer_for_instrument,
)
from core.instruments import build_default_instruments
from core.pattern import DrumBar, DrumHit, DrumPattern, GlobalSettings


class _FakeChannel:
    def __init__(self, busy: bool = True) -> None:
        self.busy = busy
        self.stop_calls = 0

    def get_busy(self) -> bool:
        return self.busy

    def stop(self) -> None:
        self.stop_calls += 1
        self.busy = False


class AudioPlaybackTests(unittest.TestCase):
    def _single_hit_pattern(self, bpm: int = 120) -> DrumPattern:
        settings = GlobalSettings(bpm=bpm, bars=1, grouping="4")
        instruments = build_default_instruments()
        bar = DrumBar(
            index=0,
            total_slots=32,
            base_hits=[
                DrumHit(
                    instrument="kick",
                    midi_note=36,
                    slot_index=8,
                    bar_index=0,
                    velocity=100,
                )
            ],
        )
        return DrumPattern(settings=settings, bars=[bar], instruments=instruments)

    def test_velocity_layer_4_uses_expected_boundaries(self) -> None:
        self.assertEqual(_velocity_layer_4(1), 1)
        self.assertEqual(_velocity_layer_4(31), 1)
        self.assertEqual(_velocity_layer_4(32), 2)
        self.assertEqual(_velocity_layer_4(63), 2)
        self.assertEqual(_velocity_layer_4(64), 3)
        self.assertEqual(_velocity_layer_4(95), 3)
        self.assertEqual(_velocity_layer_4(96), 4)
        self.assertEqual(_velocity_layer_4(127), 4)

    def test_velocity_layer_3_uses_expected_boundaries(self) -> None:
        self.assertEqual(_velocity_layer_3(1), 1)
        self.assertEqual(_velocity_layer_3(42), 1)
        self.assertEqual(_velocity_layer_3(43), 2)
        self.assertEqual(_velocity_layer_3(84), 2)
        self.assertEqual(_velocity_layer_3(85), 3)
        self.assertEqual(_velocity_layer_3(127), 3)

    def test_velocity_layer_5_uses_expected_boundaries(self) -> None:
        self.assertEqual(_velocity_layer_5(1), 1)
        self.assertEqual(_velocity_layer_5(31), 1)
        self.assertEqual(_velocity_layer_5(32), 2)
        self.assertEqual(_velocity_layer_5(55), 2)
        self.assertEqual(_velocity_layer_5(56), 3)
        self.assertEqual(_velocity_layer_5(75), 3)
        self.assertEqual(_velocity_layer_5(76), 4)
        self.assertEqual(_velocity_layer_5(100), 4)
        self.assertEqual(_velocity_layer_5(101), 5)
        self.assertEqual(_velocity_layer_5(127), 5)

    def test_velocity_layer_for_instrument_matches_expected_families(self) -> None:
        self.assertEqual(_velocity_layer_for_instrument("kick", 70), 3)
        self.assertEqual(_velocity_layer_for_instrument("ride", 70), 2)
        self.assertEqual(_velocity_layer_for_instrument("snare", 110), 5)
        self.assertEqual(_velocity_layer_for_instrument("hihat_closed", 80), 4)
        self.assertIsNone(_velocity_layer_for_instrument("crash", 70))

    def test_choke_groups_match_open_closed_hat_rules(self) -> None:
        self.assertEqual(_choke_group_for_instrument("hihat_open"), "hihat_open")
        self.assertIsNone(_choke_group_for_instrument("hihat_closed"))
        self.assertEqual(_choke_targets_for_instrument("hihat_closed"), ("hihat_open",))
        self.assertEqual(_choke_targets_for_instrument("ride"), ())

    def test_resolve_sample_key_prefers_ghost_variant(self) -> None:
        engine = PatternPlaybackEngine()
        engine._sounds = {
            "snare:ghost": object(),
            "snare:layer:2": object(),
        }

        self.assertEqual(engine._resolve_sample_key("snare", "ghost", 50), "snare:ghost")

    def test_resolve_sample_key_uses_velocity_layer_when_available(self) -> None:
        engine = PatternPlaybackEngine()
        engine._sounds = {
            "kick:layer:1": object(),
            "kick:layer:4": object(),
        }

        self.assertEqual(engine._resolve_sample_key("kick", "main", 20), "kick:layer:1")
        self.assertEqual(engine._resolve_sample_key("kick", "main", 120), "kick:layer:4")

    def test_resolve_sample_key_uses_five_layer_mapping_for_snare_and_hat(self) -> None:
        engine = PatternPlaybackEngine()
        engine._sounds = {
            "snare:layer:5": object(),
            "hihat_closed:layer:4": object(),
        }

        self.assertEqual(engine._resolve_sample_key("snare", "main", 120), "snare:layer:5")
        self.assertEqual(engine._resolve_sample_key("hihat_closed", "main", 90), "hihat_closed:layer:4")

    def test_resolve_sample_key_falls_back_to_nearest_available_layer(self) -> None:
        engine = PatternPlaybackEngine()
        engine._sounds = {
            "snare:layer:4": object(),
        }

        self.assertEqual(engine._resolve_sample_key("snare", "main", 120), "snare:layer:4")

    def test_resolve_sample_key_falls_back_to_legacy_single_sample(self) -> None:
        engine = PatternPlaybackEngine()
        engine._sounds = {
            "crash": object(),
            "ride": object(),
        }

        self.assertEqual(engine._resolve_sample_key("crash", "main", 100), "crash")
        self.assertEqual(engine._resolve_sample_key("ride", "main", 100), "ride")

    def test_register_active_channel_tracks_open_hat_channels(self) -> None:
        engine = PatternPlaybackEngine()
        channel = _FakeChannel()

        engine._register_active_channel("hihat_open", channel)

        self.assertEqual(engine._active_choke_channels["hihat_open"], [channel])

    def test_closed_hat_chokes_active_open_hat_channels(self) -> None:
        engine = PatternPlaybackEngine()
        open_a = _FakeChannel()
        open_b = _FakeChannel()
        engine._active_choke_channels["hihat_open"] = [open_a, open_b]

        engine._apply_choke_groups("hihat_closed")

        self.assertEqual(open_a.stop_calls, 1)
        self.assertEqual(open_b.stop_calls, 1)
        self.assertEqual(engine._active_choke_channels["hihat_open"], [])

    def test_register_active_channel_prunes_finished_channels(self) -> None:
        engine = PatternPlaybackEngine()
        finished = _FakeChannel(busy=False)
        current = _FakeChannel(busy=True)
        engine._active_choke_channels["hihat_open"] = [finished]

        engine._register_active_channel("hihat_open", current)

        self.assertEqual(engine._active_choke_channels["hihat_open"], [current])

    def test_playback_volume_boosts_ghosts_slightly(self) -> None:
        main_volume = _playback_volume(40, "main")
        ghost_volume = _playback_volume(40, "ghost")

        self.assertGreater(ghost_volume, main_volume)
        self.assertAlmostEqual(ghost_volume, min(1.0, main_volume * 1.12), places=6)

    def test_build_schedule_uses_runtime_bpm_override(self) -> None:
        engine = PatternPlaybackEngine()
        engine._sounds = {"kick:layer:4": object()}
        pattern = self._single_hit_pattern(bpm=120)

        default_schedule = engine._build_schedule(pattern)
        slow_schedule = engine._build_schedule(pattern, bpm=60)

        self.assertEqual(default_schedule[0].time_ms * 2, slow_schedule[0].time_ms)

    def test_pattern_duration_uses_runtime_bpm_override(self) -> None:
        engine = PatternPlaybackEngine()
        pattern = self._single_hit_pattern(bpm=120)

        default_duration = engine._pattern_duration_ms(pattern)
        slow_duration = engine._pattern_duration_ms(pattern, bpm=60)

        self.assertEqual(default_duration * 2, slow_duration)


if __name__ == "__main__":
    unittest.main()
