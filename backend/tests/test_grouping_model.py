import unittest

from core.generator import (
    _crash_group_priority_map,
    DrumPatternGenerator,
    _division_slots,
    _kick_structural_keep_weight,
    _kick_sync_priority_weight,
    _open_hat_group_priority_map,
    _pulse_accent_strength,
    _pulse_overlap_strength,
    _snare_group_extra_capacity,
    _snare_structural_keep_weight,
    _snare_sync_priority_weight,
)
from core.instruments import build_default_instruments
from core.pattern import GlobalSettings, HIT_MAIN
from core.timing import (
    build_fill_regions,
    parse_grouping,
    scaled_humanize_amount,
    velocity_from_priority,
)


class GroupingModelTests(unittest.TestCase):
    def test_valid_groupings_derive_numerator(self) -> None:
        cases = {
            "4": 4,
            "2+2": 4,
            "3+2": 5,
            "3+2+2": 7,
        }
        for grouping_text, expected_numerator in cases.items():
            with self.subTest(grouping=grouping_text):
                settings = GlobalSettings(grouping=grouping_text)
                self.assertEqual(settings.numerator, expected_numerator)
                self.assertEqual(sum(parse_grouping(grouping_text)), expected_numerator)

    def test_invalid_groupings_raise_clear_error(self) -> None:
        for grouping_text in ("", "5", "2+0+2", "3+-1"):
            with self.subTest(grouping=grouping_text):
                with self.assertRaises(ValueError):
                    parse_grouping(grouping_text)

    def test_velocity_from_priority_maps_cleanly_to_range(self) -> None:
        self.assertEqual(velocity_from_priority(0.0, 84, 118), 84)
        self.assertEqual(velocity_from_priority(1.0, 84, 118), 118)
        self.assertEqual(velocity_from_priority(0.5, 84, 118), 101)

    def test_humanize_scaling_is_progressive_and_bounded(self) -> None:
        self.assertEqual(scaled_humanize_amount(0), 0)
        self.assertEqual(scaled_humanize_amount(4), 2)
        self.assertEqual(scaled_humanize_amount(8), 5)
        self.assertEqual(scaled_humanize_amount(12), 8)
        self.assertEqual(scaled_humanize_amount(16), 13)
        self.assertEqual(scaled_humanize_amount(24), 24)

    def test_humanize_scaling_never_exceeds_ui_range(self) -> None:
        self.assertEqual(scaled_humanize_amount(-4), 0)
        self.assertEqual(scaled_humanize_amount(99), 24)

    def test_regular_pulse_divisions_generate_expected_slots(self) -> None:
        self.assertEqual(_division_slots("quarter", 32), [0, 8, 16, 24])
        self.assertEqual(_division_slots("eighth", 32), [0, 4, 8, 12, 16, 20, 24, 28])
        self.assertEqual(_division_slots("sixteenth", 32), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30])

    def test_regular_pulse_strength_matches_division_hierarchy(self) -> None:
        self.assertEqual(_pulse_accent_strength("quarter", 0), 0.9)
        self.assertEqual(_pulse_accent_strength("eighth", 0), 1.0)
        self.assertEqual(_pulse_accent_strength("eighth", 4), 0.72)
        self.assertEqual(_pulse_accent_strength("sixteenth", 0), 1.0)
        self.assertEqual(_pulse_accent_strength("sixteenth", 4), 0.72)
        self.assertEqual(_pulse_accent_strength("sixteenth", 2), 0.45)

    def test_regular_pulse_overlap_bonus_clamps_to_one(self) -> None:
        self.assertEqual(_pulse_overlap_strength(0.72, 8, {8}, set()), 0.82)
        self.assertEqual(_pulse_overlap_strength(0.72, 8, set(), {8}), 0.87)
        self.assertEqual(_pulse_overlap_strength(0.9, 8, {8}, {8}), 1.0)

    def test_kick_generation_still_works_with_grouping_driven_meter(self) -> None:
        settings = GlobalSettings(grouping="3+2", bars=1, seed=42)
        instruments = build_default_instruments()
        instruments["kick"].density = 0.5
        instruments["kick"].syncopation_amount = 0.0
        instruments["snare"].density = 0.0
        instruments["snare"].syncopation_amount = 0.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        kick_slots = {hit.slot_index for hit in pattern.all_hits() if hit.instrument == "kick"}
        snare_slots = {
            hit.slot_index
            for hit in pattern.all_hits()
            if hit.instrument == "snare" and hit.hit_type != "ghost"
        }

        self.assertIn(0, kick_slots)
        self.assertIn(24, kick_slots)
        self.assertIn(16, snare_slots)
        self.assertIn(32, snare_slots)
        self.assertTrue(kick_slots.isdisjoint(snare_slots))

    def test_kick_structural_hits_stay_present_when_sync_is_zero(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=7, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["kick"].density = 1.0
        instruments["kick"].syncopation_amount = 0.0
        instruments["snare"].density = 0.0
        instruments["snare"].syncopation_amount = 0.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        kick_hits = [hit for hit in pattern.all_hits() if hit.instrument == "kick"]
        kick_slots = {hit.slot_index for hit in kick_hits}

        self.assertIn(0, kick_slots)
        self.assertIn(16, kick_slots)
        structural_velocities = {hit.slot_index: hit.velocity for hit in kick_hits if hit.slot_index in (0, 16)}
        self.assertEqual(structural_velocities[0], instruments["kick"].velocity_max)
        self.assertEqual(structural_velocities[16], instruments["kick"].velocity_max)

    def test_kick_sync_priority_weight_compresses_toward_one(self) -> None:
        medium_weight = 0.18
        boosted = [_kick_sync_priority_weight(medium_weight, level) for level in range(6)]
        self.assertEqual(boosted[0], medium_weight)
        self.assertTrue(all(boosted[index] < boosted[index + 1] for index in range(5)))

        self.assertEqual(_kick_sync_priority_weight(0.0, 5), 0.0)
        self.assertEqual(_kick_sync_priority_weight(1.0, 5), 1.0)

    def test_kick_structural_keep_weight_weakens_only_at_high_sync(self) -> None:
        expected = {
            0: 1.0,
            1: 1.0,
            2: 1.0,
            3: 1.0,
            4: 0.9,
            5: 0.8,
        }
        for level, keep_weight in expected.items():
            with self.subTest(sync_level=level):
                self.assertEqual(_kick_structural_keep_weight(level), keep_weight)

    def test_snare_group_extra_capacity_matches_requested_caps(self) -> None:
        expected = {
            1: 2,
            2: 2,
            3: 3,
            4: 4,
        }
        for group_size, extra_capacity in expected.items():
            with self.subTest(group_size=group_size):
                self.assertEqual(_snare_group_extra_capacity(group_size), extra_capacity)

    def test_snare_sync_priority_weight_compresses_toward_one(self) -> None:
        medium_weight = 0.18
        boosted = [_snare_sync_priority_weight(medium_weight, level) for level in range(6)]
        self.assertEqual(boosted[0], medium_weight)
        self.assertTrue(all(boosted[index] < boosted[index + 1] for index in range(5)))

        self.assertEqual(_snare_sync_priority_weight(0.0, 5), 0.0)
        self.assertEqual(_snare_sync_priority_weight(1.0, 5), 1.0)

    def test_snare_structural_keep_weight_weakens_only_at_high_sync(self) -> None:
        expected = {
            0: 1.0,
            1: 1.0,
            2: 1.0,
            3: 1.0,
            4: 0.9,
            5: 0.8,
        }
        for level, keep_weight in expected.items():
            with self.subTest(sync_level=level):
                self.assertEqual(_snare_structural_keep_weight(level), keep_weight)

    def test_snare_generation_respects_grouping_driven_structure_and_no_kick_collision(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=11)
        instruments = build_default_instruments()
        instruments["snare"].density = 1.0
        instruments["snare"].syncopation_amount = 0.0
        instruments["kick"].density = 0.0
        instruments["kick"].syncopation_amount = 0.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        kick_slots = {hit.slot_index for hit in pattern.all_hits() if hit.instrument == "kick"}
        snare_slots = {
            hit.slot_index
            for hit in pattern.all_hits()
            if hit.instrument == "snare" and hit.hit_type != "ghost"
        }

        self.assertIn(8, snare_slots)
        self.assertIn(24, snare_slots)
        self.assertLessEqual(len(snare_slots), 6)
        self.assertTrue(kick_slots.isdisjoint(snare_slots))

    def test_toms_stay_off_when_hit_budget_is_zero(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=21)
        instruments = build_default_instruments()
        instruments["kick"].density = 0.4
        instruments["snare"].density = 0.3
        for tom_key in ("tom_high", "tom_mid", "tom_low"):
            instruments[tom_key].enabled = False
            instruments[tom_key].tom_hit_count = 0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        tom_hits = [hit for hit in pattern.all_hits() if hit.instrument in ("tom_high", "tom_mid", "tom_low")]
        self.assertEqual(tom_hits, [])

    def test_toms_follow_requested_total_budget(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        instruments["tom_high"].tom_hit_count = 1
        instruments["tom_high"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_low"].tom_hit_count = 0
        instruments["tom_low"].enabled = False

        pattern = DrumPatternGenerator().generate(settings, instruments)
        tom_hits = [hit for hit in pattern.all_hits() if hit.instrument in ("tom_high", "tom_mid", "tom_low")]

        self.assertEqual(len(tom_hits), 3)
        self.assertEqual(sum(1 for hit in tom_hits if hit.instrument == "tom_high"), 1)
        self.assertEqual(sum(1 for hit in tom_hits if hit.instrument == "tom_mid"), 2)
        self.assertEqual(sum(1 for hit in tom_hits if hit.instrument == "tom_low"), 0)

    def test_toms_can_span_multiple_phrases_with_large_budget(self) -> None:
        settings = GlobalSettings(grouping="4", bars=2, seed=17, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["tom_high"].tom_hit_count = 3
        instruments["tom_high"].enabled = True
        instruments["tom_mid"].tom_hit_count = 3
        instruments["tom_mid"].enabled = True
        instruments["tom_low"].tom_hit_count = 3
        instruments["tom_low"].enabled = True

        pattern = DrumPatternGenerator().generate(settings, instruments)
        tom_hits = [hit for hit in pattern.all_hits() if hit.instrument in ("tom_high", "tom_mid", "tom_low")]

        self.assertEqual(len(tom_hits), 9)
        self.assertGreaterEqual(len({hit.bar_index for hit in tom_hits}), 1)

    def test_hihat_closed_quarter_velocity_follows_strength(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=1, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["kick"].enabled = False
        instruments["snare"].enabled = False
        instruments["ride"].enabled = False
        instruments["hihat_closed"].enabled = True
        instruments["hihat_closed"].pulse_division = "quarter"
        pattern = DrumPatternGenerator().generate(settings, instruments)
        hat_hits = [hit for hit in pattern.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"]
        self.assertEqual([hit.slot_index for hit in hat_hits], [0, 8, 16, 24])
        self.assertTrue(all(hit.velocity == velocity_from_priority(0.9, instruments["hihat_closed"].velocity_min, instruments["hihat_closed"].velocity_max) for hit in hat_hits))

    def test_pulse_primary_secondary_do_not_duplicate_full_pattern(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=2, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["kick"].enabled = False
        instruments["snare"].enabled = False
        instruments["hihat_open"].enabled = False
        instruments["hihat_closed"].enabled = True
        instruments["ride"].enabled = True
        instruments["hihat_closed"].pulse_division = "sixteenth"
        instruments["ride"].pulse_division = "eighth"

        pattern = DrumPatternGenerator().generate(settings, instruments)
        ride_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "ride" and hit.hit_type != "ghost"]
        hat_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"]

        self.assertEqual(hat_slots, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30])
        self.assertEqual(ride_slots, [0, 8, 16, 24])

    def test_tom_hits_stay_on_odd_slots(self) -> None:
        settings = GlobalSettings(grouping="4", bars=2, seed=5)
        instruments = build_default_instruments()
        for tom_key in ("tom_high", "tom_mid", "tom_low"):
            instruments[tom_key].enabled = True
            instruments[tom_key].tom_hit_count = 2

        pattern = DrumPatternGenerator().generate(settings, instruments)
        tom_hits = [hit for hit in pattern.all_hits() if hit.instrument in ("tom_high", "tom_mid", "tom_low")]

        self.assertTrue(tom_hits)
        self.assertTrue(all(hit.slot_index % 2 == 0 for hit in tom_hits))

    def test_single_active_tom_repeats_intentionally(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        instruments["tom_high"].tom_hit_count = 0
        instruments["tom_high"].enabled = False
        instruments["tom_mid"].tom_hit_count = 3
        instruments["tom_mid"].enabled = True
        instruments["tom_low"].tom_hit_count = 0
        instruments["tom_low"].enabled = False

        pattern = DrumPatternGenerator().generate(settings, instruments)
        tom_hits = [hit for hit in pattern.all_hits() if hit.instrument in ("tom_high", "tom_mid", "tom_low")]

        self.assertEqual(len(tom_hits), 3)
        self.assertTrue(all(hit.instrument == "tom_mid" for hit in tom_hits))

    def test_open_hat_uses_only_group_priority_slots(self) -> None:
        settings = GlobalSettings(grouping="3+2", bars=1, seed=9, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["ride"].enabled = False
        instruments["hihat_closed"].enabled = False
        instruments["hihat_open"].enabled = True
        instruments["hihat_open"].density = 1.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        open_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_open"]

        allowed = {16, 20, 22, 36, 38}
        self.assertTrue(open_slots)
        self.assertTrue(set(open_slots).issubset(allowed))

    def test_closed_hat_is_masked_by_open_hat_slots(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=9, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["ride"].enabled = False
        instruments["hihat_closed"].enabled = True
        instruments["hihat_closed"].pulse_division = "sixteenth"
        instruments["hihat_open"].enabled = True
        instruments["hihat_open"].density = 1.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        open_slots = {hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_open"}
        closed_slots = {hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"}

        self.assertTrue(open_slots)
        self.assertTrue(open_slots.isdisjoint(closed_slots))

    def test_open_hat_low_density_prefers_top_priority_slots(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=4, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["ride"].enabled = False
        instruments["hihat_closed"].enabled = False
        instruments["hihat_open"].enabled = True
        instruments["hihat_open"].density = 0.15

        pattern = DrumPatternGenerator().generate(settings, instruments)
        open_slots = {hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_open"}

        self.assertTrue(open_slots.issubset({30}))

    def test_open_hat_high_density_uses_secondary_slots_without_rigid_saturation(self) -> None:
        settings = GlobalSettings(grouping="4", bars=3, seed=12, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["ride"].enabled = False
        instruments["hihat_closed"].enabled = False
        instruments["hihat_open"].enabled = True
        instruments["hihat_open"].density = 1.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        open_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_open"]
        secondary_slots = [slot for slot in open_slots if slot % 32 in {26, 28, 30}]

        self.assertTrue(secondary_slots)
        self.assertLess(len(open_slots), 12)

    def test_open_hat_velocity_tracks_priority(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=3, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["ride"].enabled = False
        instruments["hihat_closed"].enabled = False
        instruments["hihat_open"].enabled = True
        instruments["hihat_open"].density = 1.0
        instruments["hihat_open"].velocity_min = 60
        instruments["hihat_open"].velocity_max = 100

        pattern = DrumPatternGenerator().generate(settings, instruments)
        open_hits = [hit for hit in pattern.all_hits() if hit.instrument == "hihat_open"]
        self.assertTrue(open_hits)
        priority_map = _open_hat_group_priority_map(4)
        actual = {hit.slot_index: hit.velocity for hit in open_hits}
        if 30 in actual and 26 in actual:
            self.assertGreater(actual[30], actual[26])
            self.assertEqual(actual[30], velocity_from_priority(priority_map[31], 60, 100))
            self.assertEqual(actual[26], velocity_from_priority(priority_map[27], 60, 100))

    def test_crash_uses_only_group_priority_slots(self) -> None:
        settings = GlobalSettings(grouping="3+2", bars=1, seed=11, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = True
        instruments["crash"].density = 1.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        crash_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "crash"]

        allowed = {0, 8, 16, 24, 32}
        self.assertTrue(crash_slots)
        self.assertTrue(set(crash_slots).issubset(allowed))

    def test_crash_low_density_prefers_group_starts(self) -> None:
        settings = GlobalSettings(grouping="4", bars=2, seed=2, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = True
        instruments["crash"].density = 0.08

        pattern = DrumPatternGenerator().generate(settings, instruments)
        crash_slots = {hit.slot_index for hit in pattern.all_hits() if hit.instrument == "crash"}

        self.assertTrue(crash_slots.issubset({0}))

    def test_crash_high_density_uses_secondary_slots_without_chaos(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, seed=14, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = True
        instruments["crash"].density = 1.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        crash_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "crash"]
        secondary_slots = [slot for slot in crash_slots if slot % 32 in {8, 16, 24}]

        self.assertTrue(secondary_slots)
        self.assertLessEqual(len(crash_slots), settings.bars * 2)

    def test_crash_initial_velocity_exceeds_secondary_velocity(self) -> None:
        settings = GlobalSettings(grouping="4", bars=6, seed=0, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = True
        instruments["crash"].density = 1.0
        instruments["crash"].velocity_min = 90
        instruments["crash"].velocity_max = 110

        pattern = DrumPatternGenerator().generate(settings, instruments)
        crashes = [hit for hit in pattern.all_hits() if hit.instrument == "crash"]
        initial_velocities = [hit.velocity for hit in crashes if hit.slot_index % 32 == 0]
        secondary_velocities = [hit.velocity for hit in crashes if hit.slot_index % 32 in {8, 16, 24}]

        self.assertTrue(initial_velocities)
        self.assertTrue(secondary_velocities)
        self.assertGreater(sum(initial_velocities) / len(initial_velocities), sum(secondary_velocities) / len(secondary_velocities))

    def test_crash_defaults_use_tighter_velocity_range(self) -> None:
        instruments = build_default_instruments()
        crash = instruments["crash"]
        kick = instruments["kick"]

        self.assertLess(crash.velocity_max - crash.velocity_min, kick.velocity_max - kick.velocity_min)
        self.assertEqual(_crash_group_priority_map(4)[17], 0.25)

    def test_fill_regions_single_fill_on_last_bar(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="high")
        fill_regions = build_fill_regions(settings)

        self.assertEqual([region.bar_index for region in fill_regions], [3])
        self.assertEqual(fill_regions[0].intensity, "high")

    def test_fill_regions_repeat_every_four_bars(self) -> None:
        settings = GlobalSettings(grouping="4", bars=8, fill_every=4, fill_length="medium", fill_intensity="medium")
        fill_regions = build_fill_regions(settings)

        self.assertEqual([region.bar_index for region in fill_regions], [3, 7])

    def test_fill_length_maps_to_last_slots_of_final_group(self) -> None:
        short_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="short")
        medium_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium")
        long_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="long")

        self.assertEqual(len(build_fill_regions(short_settings)[0].slots), 4)
        self.assertEqual(len(build_fill_regions(medium_settings)[0].slots), 6)
        self.assertEqual(len(build_fill_regions(long_settings)[0].slots), 8)

    def test_fill_slots_stay_inside_last_group_for_multiple_groupings(self) -> None:
        cases = {
            "4": list(range(24, 32)),
            "3+2": list(range(24, 40)),
            "3+2+2": list(range(40, 56)),
        }
        for grouping, last_group_slots in cases.items():
            with self.subTest(grouping=grouping):
                settings = GlobalSettings(grouping=grouping, bars=4, fill_every=4, fill_length="long")
                fill_region = build_fill_regions(settings)[0]
                self.assertTrue(set(fill_region.slots).issubset(set(last_group_slots)))

    def test_fill_every_clamps_to_total_bars(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=8, fill_length="short")
        fill_regions = build_fill_regions(settings)

        self.assertEqual([region.bar_index for region in fill_regions], [3])

    def test_fill_off_creates_no_fill_regions(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=2, fill_length="medium", fill_intensity="off")

        self.assertEqual(build_fill_regions(settings), [])

    def test_bars_expose_fill_region_and_active_slots(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="high", seed=5)
        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())

        self.assertEqual(pattern.bars[0].fill_region_slots, [])
        self.assertEqual(pattern.bars[0].fill_active_slots, [])
        self.assertEqual(pattern.bars[3].fill_region_slots, [26, 27, 28, 29, 30, 31])
        self.assertEqual(pattern.bars[3].fill_active_slots, [26, 28, 30])

    def test_fill_active_slots_are_confined_to_region(self) -> None:
        settings = GlobalSettings(grouping="3+2", bars=4, fill_every=4, fill_length="long", seed=9)
        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())
        last_bar = pattern.bars[3]

        self.assertTrue(set(last_bar.fill_active_slots).issubset(set(last_bar.fill_region_slots)))
        self.assertTrue(all(slot % 2 == 0 for slot in last_bar.fill_active_slots))

    def test_fill_off_leaves_bars_without_fill_slots(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="off", seed=23)
        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())

        self.assertEqual(pattern.fill_regions, [])
        self.assertTrue(all(bar.fill_region_slots == [] for bar in pattern.bars))
        self.assertTrue(all(bar.fill_active_slots == [] for bar in pattern.bars))

    def test_fill_off_does_not_apply_fill_transformations(self) -> None:
        base_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", seed=23, humanize_velocity=0)
        off_settings = GlobalSettings(
            grouping=base_settings.grouping,
            bars=base_settings.bars,
            fill_every=base_settings.fill_every,
            fill_length=base_settings.fill_length,
            fill_intensity="off",
            seed=base_settings.seed,
            humanize_velocity=base_settings.humanize_velocity,
        )
        low_settings = GlobalSettings(
            grouping=base_settings.grouping,
            bars=base_settings.bars,
            fill_every=base_settings.fill_every,
            fill_length=base_settings.fill_length,
            fill_intensity="low",
            seed=base_settings.seed,
            humanize_velocity=base_settings.humanize_velocity,
        )
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2

        off_pattern = DrumPatternGenerator().generate(off_settings, instruments)
        low_pattern = DrumPatternGenerator().generate(low_settings, instruments)

        def signature(pattern):
            return {
                (hit.bar_index, hit.instrument, hit.slot_index, hit.hit_type)
                for hit in pattern.all_hits()
            }

        self.assertEqual(signature(off_pattern), signature(low_pattern))
        self.assertTrue(all(bar.fill_active_slots == [] for bar in off_pattern.bars))

    def test_fill_region_changes_stay_local_to_last_bar_region(self) -> None:
        settings_low = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="low", seed=23, humanize_velocity=0, bar_similarity=0.0)
        settings_high = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="high", seed=23, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2

        low_pattern = DrumPatternGenerator().generate(settings_low, instruments)
        high_pattern = DrumPatternGenerator().generate(settings_high, instruments)

        def signature(pattern):
            return {
                (hit.bar_index, hit.instrument, hit.slot_index, hit.hit_type)
                for hit in pattern.all_hits()
            }

        changed = signature(high_pattern) ^ signature(low_pattern)
        self.assertTrue(changed)
        allowed_slots = set(high_pattern.bars[3].fill_region_slots) | {0, 24}
        self.assertTrue(all(bar_index == 3 and slot in allowed_slots for bar_index, _, slot, _ in changed))

    def test_fill_low_intensity_stays_discreet(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="low", seed=23, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2

        pattern = DrumPatternGenerator().generate(settings, instruments)
        last_bar = pattern.bars[3]
        active = set(last_bar.fill_active_slots)
        fill_hits = [hit for hit in last_bar.hits if hit.slot_index in active]
        snare_or_tom_hits = [hit for hit in fill_hits if hit.instrument in {"snare", "tom_high", "tom_mid", "tom_low"}]

        self.assertLessEqual(len(snare_or_tom_hits), len(active))

    def test_fill_low_remains_distinct_from_off_in_fill_metadata(self) -> None:
        off_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="off", seed=23)
        low_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="low", seed=23)

        off_pattern = DrumPatternGenerator().generate(off_settings, build_default_instruments())
        low_pattern = DrumPatternGenerator().generate(low_settings, build_default_instruments())

        self.assertEqual(off_pattern.fill_regions, [])
        self.assertEqual(low_pattern.bars[3].fill_region_slots, [26, 27, 28, 29, 30, 31])
        self.assertEqual(low_pattern.bars[3].fill_active_slots, [26, 28, 30])

    def test_fill_medium_and_high_are_observable_inside_region(self) -> None:
        settings_medium = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="medium", seed=23, humanize_velocity=0, bar_similarity=0.0)
        settings_high = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="high", seed=23, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2

        medium_pattern = DrumPatternGenerator().generate(settings_medium, instruments)
        high_pattern = DrumPatternGenerator().generate(settings_high, instruments)

        def count_fill_voice_hits(pattern):
            active = set(pattern.bars[3].fill_active_slots)
            return sum(
                1
                for hit in pattern.bars[3].hits
                if hit.slot_index in active and hit.instrument in {"snare", "tom_high", "tom_mid", "tom_low"}
            )

        def count_fill_pulse_hits(pattern):
            active = set(pattern.bars[3].fill_active_slots)
            return sum(
                1
                for hit in pattern.bars[3].hits
                if hit.slot_index in active and hit.instrument in {"hihat_closed", "ride", "kick"}
            )

        self.assertGreaterEqual(count_fill_voice_hits(medium_pattern), 2)
        self.assertGreaterEqual(count_fill_voice_hits(high_pattern), 2)
        self.assertLessEqual(count_fill_pulse_hits(high_pattern), count_fill_pulse_hits(medium_pattern))

    def test_fill_medium_guarantees_at_least_one_hit_per_active_fill_slot(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="medium",
            fill_intensity="medium",
            seed=23,
            humanize_velocity=0,
            bar_similarity=0.0,
        )

        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())
        last_bar = pattern.bars[3]
        active_slots = set(last_bar.fill_active_slots)
        occupied_slots = {
            hit.slot_index
            for hit in last_bar.hits
            if hit.slot_index in active_slots and hit.hit_type != "ghost"
        }

        self.assertTrue(active_slots)
        self.assertTrue(active_slots.issubset(occupied_slots))

    def test_fill_medium_guarantee_survives_bar_similarity(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="medium",
            fill_intensity="medium",
            seed=23,
            humanize_velocity=0,
            bar_similarity=0.85,
        )

        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())
        last_bar = pattern.bars[3]
        active_slots = set(last_bar.fill_active_slots)
        occupied_slots = {
            hit.slot_index
            for hit in last_bar.hits
            if hit.slot_index in active_slots and hit.hit_type != "ghost"
        }

        self.assertTrue(active_slots)
        self.assertTrue(active_slots.issubset(occupied_slots))

    def test_fill_low_region_survives_bar_similarity_without_rewrite(self) -> None:
        base_settings = dict(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="medium",
            fill_intensity="low",
            seed=23,
            humanize_velocity=0,
        )

        pattern_without_similarity = DrumPatternGenerator().generate(
            GlobalSettings(**base_settings, bar_similarity=0.0),
            build_default_instruments(),
        )
        pattern_with_similarity = DrumPatternGenerator().generate(
            GlobalSettings(**base_settings, bar_similarity=0.85),
            build_default_instruments(),
        )

        def fill_signature(pattern):
            fill_slots = set(pattern.bars[3].fill_region_slots)
            return {
                (hit.instrument, hit.slot_index, hit.hit_type)
                for hit in pattern.bars[3].hits
                if hit.slot_index in fill_slots and hit.hit_type != "ghost"
            }

        self.assertEqual(fill_signature(pattern_without_similarity), fill_signature(pattern_with_similarity))

    def test_fill_high_survives_bar_similarity_with_hits_in_active_slots(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="medium",
            fill_intensity="high",
            seed=23,
            humanize_velocity=0,
            bar_similarity=0.85,
        )
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2

        pattern = DrumPatternGenerator().generate(settings, instruments)
        last_bar = pattern.bars[3]
        active_slots = set(last_bar.fill_active_slots)
        occupied_slots = {
            hit.slot_index
            for hit in last_bar.hits
            if hit.slot_index in active_slots and hit.hit_type != "ghost"
        }

        self.assertTrue(active_slots)
        self.assertGreaterEqual(len(occupied_slots), max(1, len(active_slots) - 1))

    def test_fill_high_short_uses_two_snare_hits(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="short",
            fill_intensity="high",
            seed=23,
            humanize_velocity=0,
            bar_similarity=0.0,
        )
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = True
        instruments["crash"].enabled = True
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2

        pattern = DrumPatternGenerator().generate(settings, instruments)
        last_bar = pattern.bars[3]
        active_slots = set(last_bar.fill_active_slots)
        fill_hits = [
            hit for hit in last_bar.hits
            if hit.slot_index in active_slots and hit.hit_type != "ghost"
        ]

        self.assertEqual(len(active_slots), 2)
        self.assertEqual({hit.instrument for hit in fill_hits}, {"snare"})
        self.assertEqual({hit.slot_index for hit in fill_hits}, active_slots)

    def test_fill_high_medium_uses_two_snare_and_one_accent_when_available(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="medium",
            fill_intensity="high",
            seed=23,
            humanize_velocity=0,
            bar_similarity=0.0,
        )
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2

        pattern = DrumPatternGenerator().generate(settings, instruments)
        last_bar = pattern.bars[3]
        active_slots = set(last_bar.fill_active_slots)
        fill_hits = [
            hit for hit in last_bar.hits
            if hit.slot_index in active_slots and hit.hit_type != "ghost"
        ]

        self.assertEqual(len(active_slots), 3)
        self.assertEqual(len([hit for hit in fill_hits if hit.instrument == "snare"]), 2)
        self.assertEqual(len([hit for hit in fill_hits if hit.instrument.startswith("tom_")]), 1)

    def test_fill_high_long_uses_two_snare_and_two_accents_when_available(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=4,
            fill_length="long",
            fill_intensity="high",
            seed=23,
            humanize_velocity=0,
            bar_similarity=0.0,
        )
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = True
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2

        pattern = DrumPatternGenerator().generate(settings, instruments)
        last_bar = pattern.bars[3]
        active_slots = set(last_bar.fill_active_slots)
        fill_hits = [
            hit for hit in last_bar.hits
            if hit.slot_index in active_slots and hit.hit_type != "ghost"
        ]

        accent_count = sum(
            1
            for hit in fill_hits
            if hit.instrument in {"hihat_open", "crash", "tom_high", "tom_mid", "tom_low"}
        )
        snare_count = sum(1 for hit in fill_hits if hit.instrument == "snare")

        self.assertEqual(len(active_slots), 4)
        self.assertEqual(snare_count, 2)
        self.assertEqual(accent_count, 2)

    def test_fill_medium_and_high_make_toms_observably_present_when_enabled(self) -> None:
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2
        instruments["tom_low"].enabled = True
        instruments["tom_low"].tom_hit_count = 1

        medium_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="medium", seed=23, humanize_velocity=0, bar_similarity=0.0)
        high_settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="long", fill_intensity="high", seed=23, humanize_velocity=0, bar_similarity=0.0)

        medium_pattern = DrumPatternGenerator().generate(medium_settings, instruments)
        high_pattern = DrumPatternGenerator().generate(high_settings, instruments)

        def tom_hits_in_fill(pattern):
            active = set(pattern.bars[3].fill_active_slots)
            return [hit for hit in pattern.bars[3].hits if hit.slot_index in active and hit.instrument in {"tom_high", "tom_mid", "tom_low"}]

        self.assertGreaterEqual(len(tom_hits_in_fill(medium_pattern)), 2)
        self.assertGreaterEqual(len(tom_hits_in_fill(high_pattern)), 2)

    def test_fill_without_toms_stays_snare_led_but_coherent(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="high", seed=23, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        for tom_key in ("tom_high", "tom_mid", "tom_low"):
            instruments[tom_key].enabled = False
            instruments[tom_key].tom_hit_count = 0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        active = set(pattern.bars[3].fill_active_slots)
        tom_hits = [hit for hit in pattern.bars[3].hits if hit.slot_index in active and hit.instrument in {"tom_high", "tom_mid", "tom_low"}]
        snare_hits = [hit for hit in pattern.bars[3].hits if hit.slot_index in active and hit.instrument == "snare"]

        self.assertEqual(tom_hits, [])
        self.assertTrue(snare_hits)

    def test_fill_toms_do_not_indiscriminately_take_over_region(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="long", fill_intensity="high", seed=23, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 3
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 3
        instruments["tom_low"].enabled = True
        instruments["tom_low"].tom_hit_count = 3

        pattern = DrumPatternGenerator().generate(settings, instruments)
        active = set(pattern.bars[3].fill_active_slots)
        tom_hits = [hit for hit in pattern.bars[3].hits if hit.slot_index in active and hit.instrument in {"tom_high", "tom_mid", "tom_low"}]
        snare_hits = [hit for hit in pattern.bars[3].hits if hit.slot_index in active and hit.instrument == "snare"]

        self.assertLess(len(tom_hits), len(active))
        self.assertTrue(snare_hits)

    def test_fill_guarantees_final_kick_anchor_on_last_quarter_of_group(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="high", seed=23, humanize_velocity=0, bar_similarity=0.0)
        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())

        kick_slots = {hit.slot_index for hit in pattern.bars[3].hits if hit.instrument == "kick"}
        self.assertIn(24, kick_slots)

    def test_fill_final_kick_anchor_follows_odd_meter_grouping(self) -> None:
        cases = {
            "3+2": 32,
            "3+2+2": 48,
        }
        for grouping, expected_slot in cases.items():
            with self.subTest(grouping=grouping):
                settings = GlobalSettings(grouping=grouping, bars=4, fill_every=4, fill_length="medium", fill_intensity="high", seed=23, humanize_velocity=0, bar_similarity=0.0)
                pattern = DrumPatternGenerator().generate(settings, build_default_instruments())
                kick_slots = {hit.slot_index for hit in pattern.bars[3].hits if hit.instrument == "kick"}
                self.assertIn(expected_slot, kick_slots)

    def test_fill_final_kick_anchor_is_not_duplicated_when_already_present(self) -> None:
        settings = GlobalSettings(grouping="4", bars=4, fill_every=4, fill_length="medium", fill_intensity="medium", seed=23, humanize_velocity=0, bar_similarity=0.0)
        pattern = DrumPatternGenerator().generate(settings, build_default_instruments())

        anchor_hits = [hit for hit in pattern.bars[3].hits if hit.instrument == "kick" and hit.slot_index == 24]
        self.assertEqual(len(anchor_hits), 1)

    def test_bar_similarity_one_keeps_final_pattern_identical_between_bars(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_every=1,
            fill_length="medium",
            fill_intensity="high",
            bar_similarity=1.0,
            seed=31,
            humanize_velocity=0,
        )
        instruments = build_default_instruments()
        instruments["hihat_open"].enabled = True
        instruments["crash"].enabled = True
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 1
        pattern = DrumPatternGenerator().generate(settings, instruments)

        reference_signature = {
            (hit.instrument, hit.slot_index, hit.hit_type)
            for hit in pattern.bars[0].hits
            if hit.hit_type != "ghost"
        }
        for bar in pattern.bars[1:]:
            signature = {
                (hit.instrument, hit.slot_index, hit.hit_type)
                for hit in bar.hits
                if hit.hit_type != "ghost"
            }
            self.assertEqual(signature, reference_signature)

    def test_bar_similarity_zero_keeps_bars_significantly_freer(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=4,
            fill_intensity="off",
            bar_similarity=0.0,
            seed=31,
            humanize_velocity=0,
        )
        instruments = build_default_instruments()
        instruments["kick"].density = 0.9
        instruments["kick"].syncopation_amount = 0.8
        instruments["snare"].density = 0.85
        instruments["snare"].syncopation_amount = 0.6

        pattern = DrumPatternGenerator().generate(settings, instruments)
        reference = {
            "kick": {hit.slot_index for hit in pattern.bars[0].hits if hit.instrument == "kick" and hit.hit_type != "ghost"},
            "snare": {hit.slot_index for hit in pattern.bars[0].hits if hit.instrument == "snare" and hit.hit_type != "ghost"},
        }
        differences = []
        for bar in pattern.bars[1:]:
            differences.append(
                len(reference["kick"] ^ {hit.slot_index for hit in bar.hits if hit.instrument == "kick" and hit.hit_type != "ghost"})
                + len(reference["snare"] ^ {hit.slot_index for hit in bar.hits if hit.instrument == "snare" and hit.hit_type != "ghost"})
            )
        self.assertTrue(any(diff > 0 for diff in differences))

    def test_bar_similarity_progressively_reduces_backbone_differences(self) -> None:
        instruments = build_default_instruments()
        instruments["kick"].density = 0.9
        instruments["kick"].syncopation_amount = 0.8
        instruments["snare"].density = 0.85
        instruments["snare"].syncopation_amount = 0.6

        low_settings = GlobalSettings(grouping="4", bars=4, fill_intensity="off", bar_similarity=0.25, seed=31, humanize_velocity=0)
        high_settings = GlobalSettings(grouping="4", bars=4, fill_intensity="off", bar_similarity=0.85, seed=31, humanize_velocity=0)

        low_pattern = DrumPatternGenerator().generate(low_settings, instruments)
        high_pattern = DrumPatternGenerator().generate(high_settings, instruments)

        def total_backbone_difference(pattern):
            reference_kick = {hit.slot_index for hit in pattern.bars[0].hits if hit.instrument == "kick" and hit.hit_type != "ghost"}
            reference_snare = {hit.slot_index for hit in pattern.bars[0].hits if hit.instrument == "snare" and hit.hit_type != "ghost"}
            total = 0
            for bar in pattern.bars[1:]:
                total += len(reference_kick ^ {hit.slot_index for hit in bar.hits if hit.instrument == "kick" and hit.hit_type != "ghost"})
                total += len(reference_snare ^ {hit.slot_index for hit in bar.hits if hit.instrument == "snare" and hit.hit_type != "ghost"})
            return total

        self.assertGreater(total_backbone_difference(low_pattern), total_backbone_difference(high_pattern))

    def test_fill_bars_can_still_vary_before_similarity_reaches_maximum(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=8,
            fill_every=4,
            fill_length="long",
            fill_intensity="high",
            bar_similarity=0.9,
            seed=23,
            humanize_velocity=0,
        )
        instruments = build_default_instruments()
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2
        instruments["hihat_open"].enabled = True
        instruments["crash"].enabled = True

        pattern = DrumPatternGenerator().generate(settings, instruments)

        def fill_signature(bar_index):
            active = set(pattern.bars[bar_index].fill_region_slots) | {0}
            return {
                (hit.instrument, hit.slot_index, hit.hit_type)
                for hit in pattern.bars[bar_index].hits
                if hit.slot_index in active
            }

        self.assertNotEqual(fill_signature(3), fill_signature(7))

    def test_fill_bars_match_when_bar_similarity_is_maximum(self) -> None:
        settings = GlobalSettings(
            grouping="4",
            bars=8,
            fill_every=4,
            fill_length="long",
            fill_intensity="high",
            bar_similarity=1.0,
            seed=23,
            humanize_velocity=0,
        )
        instruments = build_default_instruments()
        instruments["tom_high"].enabled = True
        instruments["tom_high"].tom_hit_count = 2
        instruments["tom_mid"].enabled = True
        instruments["tom_mid"].tom_hit_count = 2
        instruments["hihat_open"].enabled = True
        instruments["crash"].enabled = True

        pattern = DrumPatternGenerator().generate(settings, instruments)

        def signature(bar_index):
            return {
                (hit.instrument, hit.slot_index, hit.hit_type)
                for hit in pattern.bars[bar_index].hits
                if hit.hit_type != "ghost"
            }

        self.assertEqual(signature(3), signature(7))

    def test_pulse_layers_ignore_density_and_syncopation(self) -> None:
        base_settings = GlobalSettings(grouping="4", bars=1, seed=3, humanize_velocity=0)

        instruments_a = build_default_instruments()
        instruments_a["kick"].enabled = False
        instruments_a["snare"].enabled = False
        instruments_a["ride"].enabled = False
        instruments_a["hihat_closed"].pulse_division = "sixteenth"
        instruments_a["hihat_closed"].density = 0.1
        instruments_a["hihat_closed"].syncopation_amount = 0.0

        instruments_b = build_default_instruments()
        instruments_b["kick"].enabled = False
        instruments_b["snare"].enabled = False
        instruments_b["ride"].enabled = False
        instruments_b["hihat_closed"].pulse_division = "sixteenth"
        instruments_b["hihat_closed"].density = 0.95
        instruments_b["hihat_closed"].syncopation_amount = 1.0

        pattern_a = DrumPatternGenerator().generate(base_settings, instruments_a)
        pattern_b = DrumPatternGenerator().generate(base_settings, instruments_b)

        hat_slots_a = [hit.slot_index for hit in pattern_a.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"]
        hat_slots_b = [hit.slot_index for hit in pattern_b.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"]
        self.assertEqual(hat_slots_a, hat_slots_b)

    def test_pulse_space_zero_keeps_full_division_grid(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=3, humanize_velocity=0)
        instruments = build_default_instruments()
        instruments["kick"].enabled = False
        instruments["snare"].enabled = False
        instruments["ride"].enabled = False
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["hihat_closed"].pulse_division = "sixteenth"
        instruments["hihat_closed"].pulse_space = 0.0

        pattern = DrumPatternGenerator().generate(settings, instruments)
        hat_slots = [hit.slot_index for hit in pattern.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"]

        self.assertEqual(hat_slots, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30])

    def test_pulse_space_high_preserves_stronger_slots_more_often(self) -> None:
        settings = GlobalSettings(grouping="4", bars=12, seed=17, humanize_velocity=0, bar_similarity=0.0)
        instruments = build_default_instruments()
        instruments["kick"].enabled = False
        instruments["snare"].enabled = False
        instruments["ride"].enabled = False
        instruments["hihat_open"].enabled = False
        instruments["crash"].enabled = False
        instruments["hihat_closed"].pulse_division = "sixteenth"
        instruments["hihat_closed"].pulse_space = 0.8

        pattern = DrumPatternGenerator().generate(settings, instruments)
        hat_hits = [hit for hit in pattern.all_hits() if hit.instrument == "hihat_closed" and hit.hit_type != "ghost"]
        quarter_hits = sum(1 for hit in hat_hits if hit.slot_index % 8 == 0)
        eighth_hits = sum(1 for hit in hat_hits if hit.slot_index % 8 == 4)
        weak_hits = sum(1 for hit in hat_hits if hit.slot_index % 8 in {2, 6})

        quarter_rate = quarter_hits / (settings.bars * 4)
        eighth_rate = eighth_hits / (settings.bars * 4)
        weak_rate = weak_hits / (settings.bars * 8)

        self.assertGreater(quarter_rate, eighth_rate)
        self.assertGreater(eighth_rate, weak_rate)

    def test_humanize_timing_uses_scaled_amount_for_base_hits(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=7, humanize_timing=8, humanize_velocity=0)
        instruments = build_default_instruments()

        pattern = DrumPatternGenerator().generate(settings, instruments)
        base_offsets = [
            abs(hit.micro_timing_offset)
            for hit in pattern.all_hits()
            if hit.hit_type != "ghost"
        ]

        self.assertTrue(base_offsets)
        self.assertTrue(all(offset <= scaled_humanize_amount(8) for offset in base_offsets))

    def test_timing_feel_push_and_drag_bias_offsets_with_safe_clamp(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=19, humanize_timing=0, humanize_velocity=0)

        push_instruments = build_default_instruments()
        drag_instruments = build_default_instruments()
        for instrument_set in (push_instruments, drag_instruments):
            instrument_set["snare"].enabled = False
            instrument_set["hihat_closed"].enabled = False
            instrument_set["hihat_open"].enabled = False
            instrument_set["ride"].enabled = False
            instrument_set["crash"].enabled = False
            for tom_key in ("tom_high", "tom_mid", "tom_low"):
                instrument_set[tom_key].enabled = False
                instrument_set[tom_key].tom_hit_count = 0
        push_instruments["kick"].timing_feel = "push"
        drag_instruments["kick"].timing_feel = "drag"

        push_pattern = DrumPatternGenerator().generate(settings, push_instruments)
        drag_pattern = DrumPatternGenerator().generate(settings, drag_instruments)
        push_offsets = [hit.micro_timing_offset for hit in push_pattern.all_hits() if hit.instrument == "kick" and hit.hit_type != "ghost"]
        drag_offsets = [hit.micro_timing_offset for hit in drag_pattern.all_hits() if hit.instrument == "kick" and hit.hit_type != "ghost"]

        self.assertTrue(push_offsets)
        self.assertTrue(all(offset < 0 for offset in push_offsets))
        self.assertTrue(all(offset > 0 for offset in drag_offsets))
        self.assertTrue(all(abs(offset) <= 8 for offset in push_offsets + drag_offsets))

    def test_default_space_and_neutral_feel_keep_pattern_backward_compatible(self) -> None:
        settings = GlobalSettings(grouping="4", bars=2, seed=29, humanize_timing=6, humanize_velocity=6)

        baseline_instruments = build_default_instruments()
        explicit_instruments = build_default_instruments()
        for key in ("kick", "snare", "hihat_closed", "ride"):
            explicit_instruments[key].timing_feel = "neutral"
        for key in ("hihat_closed", "ride"):
            explicit_instruments[key].pulse_space = 0.0

        baseline_pattern = DrumPatternGenerator().generate(settings, baseline_instruments)
        explicit_pattern = DrumPatternGenerator().generate(settings, explicit_instruments)

        baseline_signature = [
            (hit.instrument, hit.bar_index, hit.slot_index, hit.hit_type, hit.velocity, hit.micro_timing_offset)
            for hit in baseline_pattern.all_hits()
        ]
        explicit_signature = [
            (hit.instrument, hit.bar_index, hit.slot_index, hit.hit_type, hit.velocity, hit.micro_timing_offset)
            for hit in explicit_pattern.all_hits()
        ]

        self.assertEqual(baseline_signature, explicit_signature)

    def test_humanize_velocity_uses_scaled_amount_for_base_hits(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=13, humanize_timing=0, humanize_velocity=8)
        instruments = build_default_instruments()
        instruments["kick"].density = 0.0
        instruments["kick"].syncopation_amount = 0.0
        instruments["snare"].density = 0.0
        instruments["snare"].syncopation_amount = 0.0
        instruments["hihat_open"].enabled = False
        instruments["ride"].enabled = False
        instruments["crash"].enabled = False
        for tom_key in ("tom_high", "tom_mid", "tom_low"):
            instruments[tom_key].enabled = False
            instruments[tom_key].tom_hit_count = 0

        settings_static = GlobalSettings(grouping="4", bars=1, seed=13, humanize_timing=0, humanize_velocity=0)
        static_pattern = DrumPatternGenerator().generate(settings_static, instruments)
        varied_pattern = DrumPatternGenerator().generate(settings, instruments)

        static_velocities = {
            (hit.instrument, hit.slot_index, hit.bar_index, hit.hit_type): hit.velocity
            for hit in static_pattern.all_hits()
            if hit.hit_type != "ghost"
        }
        deltas = [
            abs(hit.velocity - static_velocities[(hit.instrument, hit.slot_index, hit.bar_index, hit.hit_type)])
            for hit in varied_pattern.all_hits()
            if hit.hit_type != "ghost"
        ]

        self.assertTrue(deltas)
        self.assertTrue(all(delta <= scaled_humanize_amount(8) for delta in deltas))

    def test_manual_base_hit_is_added_with_manual_source(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)

        added = pattern.add_manual_base_hit(
            instrument_key="kick",
            global_slot_index=1,
            config=instruments["kick"],
            humanize_timing=0,
            humanize_velocity_amount=0,
        )

        self.assertIsNotNone(added)
        assert added is not None
        self.assertEqual(added.hit_type, HIT_MAIN)
        self.assertEqual(added.source, "manual")
        self.assertEqual(added.bar_index, 0)
        self.assertEqual(added.slot_index, 1)
        self.assertEqual(pattern.hit_for_cell("kick", 1, hit_type=HIT_MAIN), added)

    def test_manual_base_hit_remove_deletes_only_base_layer_hit(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)

        pattern.add_manual_base_hit(
            instrument_key="kick",
            global_slot_index=1,
            config=instruments["kick"],
            humanize_timing=0,
            humanize_velocity_amount=0,
        )
        self.assertTrue(pattern.remove_base_hit_at_cell("kick", 1))
        self.assertIsNone(pattern.hit_for_cell("kick", 1, hit_type=HIT_MAIN))

    def test_manual_base_hit_move_preserves_feel_and_marks_manual(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)

        added = pattern.add_manual_base_hit(
            instrument_key="kick",
            global_slot_index=1,
            config=instruments["kick"],
            humanize_timing=8,
            humanize_velocity_amount=8,
        )
        assert added is not None
        original_velocity = added.velocity
        original_offset = added.micro_timing_offset
        original_length = added.length_ticks
        original_priority = added.priority

        self.assertTrue(pattern.move_base_hit("kick", 1, 3))
        moved = pattern.hit_for_cell("kick", 3, hit_type=HIT_MAIN)

        self.assertIsNotNone(moved)
        assert moved is not None
        self.assertEqual(moved.velocity, original_velocity)
        self.assertEqual(moved.micro_timing_offset, original_offset)
        self.assertEqual(moved.length_ticks, original_length)
        self.assertEqual(moved.priority, original_priority)
        self.assertEqual(moved.source, "manual")

    def test_manual_base_hit_move_blocks_when_target_has_same_instrument_hit(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)

        pattern.add_manual_base_hit(
            instrument_key="kick",
            global_slot_index=1,
            config=instruments["kick"],
            humanize_timing=0,
            humanize_velocity_amount=0,
        )

        self.assertFalse(pattern.move_base_hit("kick", 1, 0))
        self.assertIsNotNone(pattern.hit_for_cell("kick", 1, hit_type=HIT_MAIN))

    def test_visible_base_hit_for_cell_returns_accent_hits(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=7, humanize_velocity=0)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)

        visible = pattern.visible_base_hit_for_cell("kick", 0)
        self.assertIsNotNone(visible)
        assert visible is not None
        self.assertEqual(visible.hit_type, "accent")

    def test_structural_accent_base_hit_can_be_removed(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=7, humanize_velocity=0)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)

        self.assertTrue(pattern.remove_base_hit_at_cell("kick", 0))
        self.assertIsNone(pattern.visible_base_hit_for_cell("kick", 0))

    def test_ghost_hit_can_be_removed_when_no_base_hit_is_present(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)
        DrumPatternGenerator().regenerate_ghost_hits(pattern, seed=11)

        ghost_hit = next((hit for hit in pattern.all_hits() if hit.hit_type == "ghost"), None)
        self.assertIsNotNone(ghost_hit)
        assert ghost_hit is not None
        global_slot = ghost_hit.bar_index * pattern.total_slots_per_bar + ghost_hit.slot_index

        self.assertTrue(pattern.remove_ghost_hit_at_cell(ghost_hit.instrument, global_slot))
        self.assertIsNone(pattern.hit_for_cell(ghost_hit.instrument, global_slot, hit_type="ghost"))

    def test_ghost_hit_move_preserves_feel(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)
        DrumPatternGenerator().regenerate_ghost_hits(pattern, seed=11)

        ghost_hit = next((hit for hit in pattern.all_hits() if hit.hit_type == "ghost" and hit.slot_index < pattern.total_slots_per_bar - 1), None)
        self.assertIsNotNone(ghost_hit)
        assert ghost_hit is not None
        from_global_slot = ghost_hit.bar_index * pattern.total_slots_per_bar + ghost_hit.slot_index
        occupied = {
            hit.slot_index
            for hit in pattern.all_hits()
            if hit.instrument == ghost_hit.instrument and hit.bar_index == ghost_hit.bar_index
        }
        destination_slot = next(slot for slot in range(ghost_hit.slot_index + 1, pattern.total_slots_per_bar) if slot not in occupied)
        to_global_slot = ghost_hit.bar_index * pattern.total_slots_per_bar + destination_slot

        original_velocity = ghost_hit.velocity
        original_offset = ghost_hit.micro_timing_offset
        original_length = ghost_hit.length_ticks
        original_priority = ghost_hit.priority
        original_source = ghost_hit.source

        self.assertTrue(pattern.move_ghost_hit(ghost_hit.instrument, from_global_slot, to_global_slot))
        moved = pattern.hit_for_cell(ghost_hit.instrument, to_global_slot, hit_type="ghost")

        self.assertIsNotNone(moved)
        assert moved is not None
        self.assertEqual(moved.velocity, original_velocity)
        self.assertEqual(moved.micro_timing_offset, original_offset)
        self.assertEqual(moved.length_ticks, original_length)
        self.assertEqual(moved.priority, original_priority)
        self.assertEqual(moved.source, original_source)

    def test_ghost_hit_move_blocks_when_target_has_base_hit(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)
        DrumPatternGenerator().regenerate_ghost_hits(pattern, seed=11)

        ghost_hit = next((hit for hit in pattern.all_hits() if hit.hit_type == "ghost"), None)
        self.assertIsNotNone(ghost_hit)
        assert ghost_hit is not None
        from_global_slot = ghost_hit.bar_index * pattern.total_slots_per_bar + ghost_hit.slot_index
        base_hit = next(
            hit
            for hit in pattern.all_hits()
            if hit.instrument == ghost_hit.instrument and hit.hit_type == HIT_MAIN and hit.bar_index == ghost_hit.bar_index
        )
        to_global_slot = base_hit.bar_index * pattern.total_slots_per_bar + base_hit.slot_index

        self.assertFalse(pattern.move_ghost_hit(ghost_hit.instrument, from_global_slot, to_global_slot))

    def test_ghost_hit_remove_is_blocked_when_base_hit_exists_in_same_cell(self) -> None:
        settings = GlobalSettings(grouping="4", bars=1, seed=5)
        instruments = build_default_instruments()
        pattern = DrumPatternGenerator().generate(settings, instruments)
        DrumPatternGenerator().regenerate_ghost_hits(pattern, seed=11)

        ghost_hit = next((hit for hit in pattern.all_hits() if hit.hit_type == "ghost"), None)
        self.assertIsNotNone(ghost_hit)
        assert ghost_hit is not None
        global_slot = ghost_hit.bar_index * pattern.total_slots_per_bar + ghost_hit.slot_index

        base_clone = type(ghost_hit)(
            instrument=ghost_hit.instrument,
            midi_note=ghost_hit.midi_note,
            slot_index=ghost_hit.slot_index,
            bar_index=ghost_hit.bar_index,
            velocity=100,
            priority=0.72,
            hit_type=HIT_MAIN,
            micro_timing_offset=0,
            length_ticks=90,
            source="manual",
        )
        pattern.bars[ghost_hit.bar_index].add_hit(base_clone)

        self.assertFalse(pattern.remove_ghost_hit_at_cell(ghost_hit.instrument, global_slot))


if __name__ == "__main__":
    unittest.main()
