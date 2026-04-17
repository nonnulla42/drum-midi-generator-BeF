import unittest
from unittest.mock import patch

from fastapi import HTTPException
from mido import MidiFile, bpm2tempo

from api import GenerateRequest, _delete_file, generate, presets


class ApiTests(unittest.TestCase):
    def test_presets_returns_existing_catalog_names(self) -> None:
        items = presets()

        self.assertTrue(items)
        self.assertEqual(items[0]["id"], "Indie / Alt - Verse - Indie Tight")
        self.assertEqual(items[0]["label"], "Indie / Alt - Verse - Indie Tight")
        self.assertEqual(items[0]["settings"]["fill_intensity"], "off")
        self.assertEqual(items[0]["kick"]["syncopation"], 1)
        self.assertEqual(items[0]["snare"]["syncopation"], 1)
        self.assertEqual(items[0]["hihat_closed"]["division"], "sixteenth")
        self.assertEqual(items[0]["ride"]["division"], "eighth")
        self.assertIn("hihat_open", items[0])
        self.assertIn("density", items[0]["hihat_open"])
        self.assertIn("crash", items[0])
        self.assertIn("density", items[0]["crash"])
        self.assertIn("toms", items[0])
        self.assertIn("high_hits", items[0]["toms"])
        self.assertTrue(any(item["id"] == "Math Drive - 7/4 - Chorus" for item in items))

    def test_generate_uses_requested_bpm_in_exported_midi(self) -> None:
        response = generate(GenerateRequest(bpm=90))
        self.addCleanup(_delete_file, response.path)

        midi = MidiFile(response.path)
        tempo_messages = [message for track in midi.tracks for message in track if message.type == "set_tempo"]

        self.assertTrue(tempo_messages)
        self.assertEqual(tempo_messages[0].tempo, bpm2tempo(90))

    def test_generate_uses_existing_preset_settings_when_requested(self) -> None:
        response = generate(GenerateRequest(bpm=123, preset="Alt Groove - 5/4 - Verse"))
        self.addCleanup(_delete_file, response.path)

        midi = MidiFile(response.path)
        time_signatures = [message for track in midi.tracks for message in track if message.type == "time_signature"]
        tempo_messages = [message for track in midi.tracks for message in track if message.type == "set_tempo"]

        self.assertTrue(time_signatures)
        self.assertEqual(time_signatures[0].numerator, 5)
        self.assertEqual(time_signatures[0].denominator, 4)
        self.assertTrue(tempo_messages)
        self.assertEqual(tempo_messages[0].tempo, bpm2tempo(123))

    def test_generate_accepts_bars_and_grouping_overrides(self) -> None:
        response = generate(GenerateRequest(bpm=110, bars=2, grouping="3+2+2"))
        self.addCleanup(_delete_file, response.path)

        midi = MidiFile(response.path)
        time_signatures = [message for track in midi.tracks for message in track if message.type == "time_signature"]

        self.assertTrue(time_signatures)
        self.assertEqual(time_signatures[0].numerator, 7)
        self.assertEqual(time_signatures[0].denominator, 4)

    def test_generate_passes_humanization_overrides_to_settings(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["settings"] = settings
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=118,
                    swing=0.12,
                    humanize_timing=9,
                    humanize_velocity=7,
                    bar_similarity=0.55,
                )
            )

        self.addCleanup(_delete_file, response.path)
        settings = captured["settings"]
        self.assertEqual(settings.bpm, 118)
        self.assertEqual(settings.swing, 0.12)
        self.assertEqual(settings.humanize_timing, 9)
        self.assertEqual(settings.humanize_velocity, 7)
        self.assertEqual(settings.bar_similarity, 0.55)

    def test_generate_passes_fill_overrides_to_settings(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["settings"] = settings
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    fill_intensity="medium",
                    fill_length="long",
                    fill_every=4,
                )
            )

        self.addCleanup(_delete_file, response.path)
        settings = captured["settings"]
        self.assertEqual(settings.fill_intensity, "medium")
        self.assertEqual(settings.fill_length, "long")
        self.assertEqual(settings.fill_every, 4)

    def test_generate_passes_kick_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["kick"] = instruments["kick"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    kick_enabled=False,
                    kick_density=0.61,
                    kick_syncopation=4,
                    kick_timing_feel="drag",
                    kick_velocity_min=72,
                    kick_velocity_max=111,
                )
            )

        self.addCleanup(_delete_file, response.path)
        kick = captured["kick"]
        self.assertFalse(kick.enabled)
        self.assertEqual(kick.density, 0.61)
        self.assertEqual(kick.syncopation_amount, 0.8)
        self.assertEqual(kick.timing_feel, "drag")
        self.assertEqual(kick.velocity_min, 72)
        self.assertEqual(kick.velocity_max, 111)

    def test_generate_passes_snare_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["snare"] = instruments["snare"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    snare_enabled=False,
                    snare_density=0.52,
                    snare_syncopation=3,
                    snare_timing_feel="push",
                    snare_velocity_min=74,
                    snare_velocity_max=109,
                )
            )

        self.addCleanup(_delete_file, response.path)
        snare = captured["snare"]
        self.assertFalse(snare.enabled)
        self.assertEqual(snare.density, 0.52)
        self.assertEqual(snare.syncopation_amount, 0.6)
        self.assertEqual(snare.timing_feel, "push")
        self.assertEqual(snare.velocity_min, 74)
        self.assertEqual(snare.velocity_max, 109)

    def test_generate_passes_hihat_closed_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["hihat_closed"] = instruments["hihat_closed"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    hihat_closed_enabled=False,
                    hihat_closed_division="quarter",
                    hihat_closed_space=0.32,
                    hihat_closed_timing_feel="drag",
                    hihat_closed_velocity_min=55,
                    hihat_closed_velocity_max=88,
                )
            )

        self.addCleanup(_delete_file, response.path)
        hihat_closed = captured["hihat_closed"]
        self.assertFalse(hihat_closed.enabled)
        self.assertEqual(hihat_closed.pulse_division, "quarter")
        self.assertEqual(hihat_closed.pulse_space, 0.32)
        self.assertEqual(hihat_closed.timing_feel, "drag")
        self.assertEqual(hihat_closed.velocity_min, 55)
        self.assertEqual(hihat_closed.velocity_max, 88)

    def test_generate_passes_ride_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["ride"] = instruments["ride"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    ride_enabled=False,
                    ride_division="quarter",
                    ride_space=0.41,
                    ride_timing_feel="push",
                    ride_velocity_min=58,
                    ride_velocity_max=90,
                )
            )

        self.addCleanup(_delete_file, response.path)
        ride = captured["ride"]
        self.assertFalse(ride.enabled)
        self.assertEqual(ride.pulse_division, "quarter")
        self.assertEqual(ride.pulse_space, 0.41)
        self.assertEqual(ride.timing_feel, "push")
        self.assertEqual(ride.velocity_min, 58)
        self.assertEqual(ride.velocity_max, 90)

    def test_generate_passes_hihat_open_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["hihat_open"] = instruments["hihat_open"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    hihat_open_enabled=False,
                    hihat_open_density=0.27,
                    hihat_open_velocity_min=64,
                    hihat_open_velocity_max=98,
                )
            )

        self.addCleanup(_delete_file, response.path)
        hihat_open = captured["hihat_open"]
        self.assertFalse(hihat_open.enabled)
        self.assertEqual(hihat_open.density, 0.27)
        self.assertEqual(hihat_open.velocity_min, 64)
        self.assertEqual(hihat_open.velocity_max, 98)

    def test_generate_passes_crash_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["crash"] = instruments["crash"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    crash_enabled=False,
                    crash_density=0.23,
                    crash_velocity_min=92,
                    crash_velocity_max=116,
                )
            )

        self.addCleanup(_delete_file, response.path)
        crash = captured["crash"]
        self.assertFalse(crash.enabled)
        self.assertEqual(crash.density, 0.23)
        self.assertEqual(crash.velocity_min, 92)
        self.assertEqual(crash.velocity_max, 116)

    def test_generate_passes_toms_overrides_to_instruments(self) -> None:
        captured = {}
        real_generate = generate.__globals__["generator"].generate

        def fake_generate(settings, instruments):
            captured["tom_high"] = instruments["tom_high"]
            captured["tom_mid"] = instruments["tom_mid"]
            captured["tom_low"] = instruments["tom_low"]
            return real_generate(settings, instruments)

        with patch("api.generator.generate", side_effect=fake_generate):
            response = generate(
                GenerateRequest(
                    bpm=120,
                    toms_high_hits=2,
                    toms_mid_hits=1,
                    toms_low_hits=0,
                    toms_velocity_min=76,
                    toms_velocity_max=108,
                )
            )

        self.addCleanup(_delete_file, response.path)
        tom_high = captured["tom_high"]
        tom_mid = captured["tom_mid"]
        tom_low = captured["tom_low"]
        self.assertTrue(tom_high.enabled)
        self.assertEqual(tom_high.tom_hit_count, 2)
        self.assertTrue(tom_mid.enabled)
        self.assertEqual(tom_mid.tom_hit_count, 1)
        self.assertFalse(tom_low.enabled)
        self.assertEqual(tom_low.tom_hit_count, 0)
        self.assertEqual(tom_high.velocity_min, 76)
        self.assertEqual(tom_mid.velocity_min, 76)
        self.assertEqual(tom_low.velocity_min, 76)
        self.assertEqual(tom_high.velocity_max, 108)
        self.assertEqual(tom_mid.velocity_max, 108)
        self.assertEqual(tom_low.velocity_max, 108)

    def test_generate_rejects_invalid_grouping(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, grouping="5+2"))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Grouping values must be between 1 and 4")

    def test_generate_request_rejects_non_positive_fill_every(self) -> None:
        with self.assertRaises(Exception) as captured:
            GenerateRequest(bpm=110, fill_every=0)

        self.assertIn("greater than 0", str(captured.exception))

    def test_generate_rejects_invalid_kick_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, kick_velocity_min=100, kick_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Kick velocity max must be greater than or equal to min")

    def test_generate_rejects_invalid_snare_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, snare_velocity_min=100, snare_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Snare velocity max must be greater than or equal to min")

    def test_generate_rejects_invalid_hihat_closed_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, hihat_closed_velocity_min=100, hihat_closed_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Hi-Hat Closed velocity max must be greater than or equal to min")

    def test_generate_rejects_invalid_ride_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, ride_velocity_min=100, ride_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Ride velocity max must be greater than or equal to min")

    def test_generate_rejects_invalid_hihat_open_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, hihat_open_velocity_min=100, hihat_open_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Hi-Hat Open velocity max must be greater than or equal to min")

    def test_generate_rejects_invalid_crash_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, crash_velocity_min=100, crash_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Crash velocity max must be greater than or equal to min")

    def test_generate_rejects_invalid_toms_velocity_range(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, toms_velocity_min=100, toms_velocity_max=90))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Toms velocity max must be greater than or equal to min")

    def test_generate_rejects_unknown_preset(self) -> None:
        with self.assertRaises(HTTPException) as captured:
            generate(GenerateRequest(bpm=110, preset="does not exist"))

        self.assertEqual(captured.exception.status_code, 400)
        self.assertEqual(captured.exception.detail, "Unknown preset: does not exist")


if __name__ == "__main__":
    unittest.main()
