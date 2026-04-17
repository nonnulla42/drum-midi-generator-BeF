import unittest

from core.presets import load_preset, preset_names


class PresetTests(unittest.TestCase):
    def test_initial_pack_contains_expected_presets(self) -> None:
        self.assertEqual(
            preset_names(),
            [
                "Indie / Alt - Verse - Indie Tight",
                "Indie / Alt - Chorus - Indie Wide",
                "Funk / Groove - Verse - Funk Pocket",
                "Funk / Groove - Chorus - Funk Lift",
                "Lo-Fi / Chill - Verse - Dusty Loop",
                "Lo-Fi / Chill - Chorus - Lo-Fi Bloom",
                "Alt Rock - Verse - Driving Verse",
                "Alt Rock - Chorus - Big Chorus",
                "Alt Groove - 5/4 - Verse",
                "Alt Groove - 5/4 - Chorus",
                "Math Drive - 7/4 - Verse",
                "Math Drive - 7/4 - Chorus",
            ],
        )

    def test_indie_pair_changes_energy_without_changing_base_bpm(self) -> None:
        verse_settings, verse_instruments = load_preset("Indie / Alt - Verse - Indie Tight")
        chorus_settings, chorus_instruments = load_preset("Indie / Alt - Chorus - Indie Wide")

        self.assertEqual(verse_settings.bpm, chorus_settings.bpm)
        self.assertEqual(verse_settings.fill_intensity, "off")
        self.assertEqual(chorus_settings.fill_intensity, "low")
        self.assertGreater(chorus_instruments["kick"].density, verse_instruments["kick"].density)
        self.assertEqual(verse_instruments["hihat_closed"].pulse_division, "sixteenth")
        self.assertEqual(chorus_instruments["hihat_closed"].pulse_division, "eighth")
        self.assertFalse(verse_instruments["ride"].enabled)
        self.assertTrue(chorus_instruments["ride"].enabled)
        self.assertFalse(verse_instruments["crash"].enabled)
        self.assertTrue(chorus_instruments["crash"].enabled)
        self.assertEqual(chorus_instruments["tom_high"].tom_hit_count, 1)
        self.assertEqual(chorus_instruments["tom_mid"].tom_hit_count, 1)
        self.assertEqual(chorus_instruments["tom_low"].tom_hit_count, 1)

    def test_lofi_verse_keeps_fill_off_and_chorus_opens_slightly(self) -> None:
        verse_settings, verse_instruments = load_preset("Lo-Fi / Chill - Verse - Dusty Loop")
        chorus_settings, chorus_instruments = load_preset("Lo-Fi / Chill - Chorus - Lo-Fi Bloom")

        self.assertEqual(verse_settings.fill_intensity, "off")
        self.assertEqual(chorus_settings.fill_intensity, "low")
        self.assertFalse(verse_instruments["ride"].enabled)
        self.assertTrue(chorus_instruments["ride"].enabled)
        self.assertLess(chorus_instruments["snare"].ghost_settings.density, verse_instruments["snare"].ghost_settings.density)
        self.assertGreater(chorus_instruments["hihat_open"].density, verse_instruments["hihat_open"].density)

    def test_alt_rock_chorus_shifts_weight_to_ride_and_crash(self) -> None:
        verse_settings, verse_instruments = load_preset("Alt Rock - Verse - Driving Verse")
        chorus_settings, chorus_instruments = load_preset("Alt Rock - Chorus - Big Chorus")

        self.assertEqual(verse_settings.swing, 0.0)
        self.assertEqual(chorus_settings.swing, 0.0)
        self.assertEqual(verse_settings.fill_intensity, "off")
        self.assertEqual(chorus_settings.fill_intensity, "low")
        self.assertFalse(verse_instruments["ride"].enabled)
        self.assertTrue(chorus_instruments["ride"].enabled)
        self.assertFalse(verse_instruments["crash"].enabled)
        self.assertTrue(chorus_instruments["crash"].enabled)
        self.assertGreater(chorus_instruments["kick"].density, verse_instruments["kick"].density)

    def test_alt_groove_5_4_presets_use_grouping_driven_meter(self) -> None:
        verse_settings, verse_instruments = load_preset("Alt Groove - 5/4 - Verse")
        chorus_settings, chorus_instruments = load_preset("Alt Groove - 5/4 - Chorus")

        self.assertEqual(verse_settings.grouping, "3+2")
        self.assertEqual(chorus_settings.grouping, "3+2")
        self.assertEqual(verse_settings.numerator, 5)
        self.assertEqual(chorus_settings.numerator, 5)
        self.assertEqual(verse_settings.fill_intensity, "off")
        self.assertEqual(chorus_settings.fill_intensity, "low")
        self.assertEqual(verse_instruments["hihat_closed"].pulse_division, "sixteenth")
        self.assertEqual(chorus_instruments["hihat_closed"].pulse_division, "eighth")
        self.assertFalse(verse_instruments["ride"].enabled)
        self.assertTrue(chorus_instruments["ride"].enabled)
        self.assertFalse(verse_instruments["crash"].enabled)
        self.assertTrue(chorus_instruments["crash"].enabled)
        self.assertGreater(chorus_instruments["kick"].density, verse_instruments["kick"].density)
        self.assertTrue(chorus_instruments["tom_high"].enabled)

    def test_math_drive_7_4_presets_open_up_in_chorus(self) -> None:
        verse_settings, verse_instruments = load_preset("Math Drive - 7/4 - Verse")
        chorus_settings, chorus_instruments = load_preset("Math Drive - 7/4 - Chorus")

        self.assertEqual(verse_settings.grouping, "3+2+2")
        self.assertEqual(chorus_settings.grouping, "3+2+2")
        self.assertEqual(verse_settings.numerator, 7)
        self.assertEqual(chorus_settings.numerator, 7)
        self.assertEqual(verse_settings.fill_intensity, "off")
        self.assertEqual(chorus_settings.fill_intensity, "low")
        self.assertGreater(chorus_instruments["kick"].density, verse_instruments["kick"].density)
        self.assertFalse(verse_instruments["ride"].enabled)
        self.assertTrue(chorus_instruments["ride"].enabled)
        self.assertFalse(verse_instruments["crash"].enabled)
        self.assertTrue(chorus_instruments["crash"].enabled)
        self.assertEqual(chorus_instruments["tom_low"].tom_hit_count, 1)

    def test_crash_and_fill_rules_are_consistent_across_pack(self) -> None:
        for preset_name in preset_names():
            settings, instruments = load_preset(preset_name)
            if "Verse" in preset_name:
                self.assertEqual(settings.fill_intensity, "off")
                self.assertFalse(instruments["crash"].enabled, preset_name)
            else:
                self.assertEqual(settings.fill_intensity, "low")
                self.assertTrue(instruments["crash"].enabled, preset_name)


if __name__ == "__main__":
    unittest.main()
