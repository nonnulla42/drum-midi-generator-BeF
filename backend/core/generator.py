from __future__ import annotations

import random
from collections import defaultdict

from core.instruments import INSTRUMENT_ORDER
from core.pattern import (
    FillRegion,
    HIT_ACCENT,
    HIT_GHOST,
    HIT_MAIN,
    DrumBar,
    DrumHit,
    DrumPattern,
    GlobalSettings,
    GhostSettings,
    InstrumentConfig,
)
from core.timing import (
    build_fill_regions,
    evenly_spaced_slots,
    grouping_boundaries,
    grouping_segments,
    grouping_structural_slots,
    humanize_velocity,
    metric_accent_slots,
    note_length_ticks,
    parse_grouping,
    scaled_humanize_amount,
    slot_shape_curve,
    total_slots_per_bar,
    velocity_from_priority,
)


class DrumPatternGenerator:
    def generate(
        self,
        settings: GlobalSettings,
        instruments: dict[str, InstrumentConfig],
    ) -> DrumPattern:
        rng = random.Random(settings.seed)
        slots_per_bar = total_slots_per_bar(settings.numerator)
        grouping = parse_grouping(settings.grouping)
        group_segments = grouping_segments(grouping)
        structural_slots = grouping_structural_slots(grouping)
        accent_slots = metric_accent_slots(settings)
        fill_regions = build_fill_regions(settings)
        fill_regions_by_bar = {region.bar_index: region for region in fill_regions}
        fill_region_snapshots: dict[int, list[DrumHit]] = {}
        bars: list[DrumBar] = []
        previous_slots: dict[str, set[int]] = defaultdict(set)

        for bar_index in range(settings.bars):
            fill_region = fill_regions_by_bar.get(bar_index)
            fill_region_slots = [] if fill_region is None else list(fill_region.slots)
            bar = DrumBar(
                index=bar_index,
                total_slots=slots_per_bar,
                fill_region_slots=fill_region_slots,
                fill_active_slots=self._fill_active_slots(fill_region_slots),
            )
            bar_hits: dict[str, set[int]] = defaultdict(set)

            self._generate_snare(
                bar,
                settings,
                instruments["snare"],
                group_segments,
                structural_slots["snare"],
                structural_slots["kick"],
                accent_slots,
                rng,
                previous_slots["snare"],
                bar_hits,
            )
            self._generate_kick(
                bar,
                settings,
                instruments["kick"],
                group_segments,
                structural_slots["kick"],
                structural_slots["snare"],
                accent_slots,
                rng,
                previous_slots["kick"],
                bar_hits,
            )
            self._generate_open_hat(
                bar,
                instruments["hihat_open"],
                group_segments,
                rng,
                bar_hits,
            )
            self._generate_regular_pulse_layers(
                bar,
                instruments["hihat_closed"],
                instruments["ride"],
                rng,
                bar_hits,
            )
            self._generate_crash(
                bar,
                instruments["crash"],
                group_segments,
                rng,
                bar_hits,
            )

            self._validate_kick_snare_bar(
                bar,
                bar_hits,
                structural_slots["kick"],
                structural_slots["snare"],
            )
            bars.append(bar)
            for key in INSTRUMENT_ORDER:
                previous_slots[key] = set(bar_hits.get(key, set()))

        self._generate_tom_budget_layer(
            bars,
            settings,
            {
                key: instruments[key]
                for key in ("tom_high", "tom_mid", "tom_low")
            },
            accent_slots,
            rng,
        )
        for bar in bars:
            fill_region = fill_regions_by_bar.get(bar.index)
            if fill_region is None:
                continue
            bar_hits = self._collect_bar_hits(bar)
            self._apply_fill_region(
                bar,
                fill_region,
                bar.fill_active_slots,
                group_segments,
                instruments,
                rng,
                bar_hits,
            )
            fill_region_snapshots[bar.index] = self._snapshot_fill_region_hits(bar)
        if bars:
            reference_bar = bars[0]
            for bar in bars[1:]:
                self._apply_bar_similarity(
                    reference_bar=reference_bar,
                    bar=bar,
                    settings=settings,
                    instruments=instruments,
                    rng=rng,
                    bar_hits=self._collect_bar_hits(bar),
                    structural_slots=structural_slots,
                )
        for bar in bars:
            fill_region = fill_regions_by_bar.get(bar.index)
            if fill_region is None:
                continue
            bar_hits = self._collect_bar_hits(bar)
            if fill_region.intensity == "low":
                self._restore_fill_region_snapshot(
                    bar,
                    fill_region_snapshots.get(bar.index, []),
                    bar_hits,
                )
            elif bar.fill_active_slots:
                self._apply_fill_region(
                    bar,
                    fill_region,
                    bar.fill_active_slots,
                    group_segments,
                    instruments,
                    rng,
                    bar_hits,
                )
            self._validate_kick_snare_bar(
                bar,
                bar_hits,
                structural_slots["kick"],
                structural_slots["snare"],
            )
            if bar.fill_active_slots:
                self._ensure_fill_slot_coverage(
                    bar,
                    instruments,
                    bar.fill_active_slots,
                    fill_region.intensity,
                    rng,
                    bar_hits,
                )
        self._enforce_odd_tom_output(bars)
        for bar in bars:
            self._humanize_bar(bar, settings, instruments, rng)
        return DrumPattern(settings=settings, bars=bars, instruments=instruments, fill_regions=fill_regions)

    def regenerate_ghost_hits(self, pattern: DrumPattern, seed: int | None = None) -> None:
        pattern.clear_ghost_hits()

        rng = random.Random(seed)
        accent_slots = set(metric_accent_slots(pattern.settings))
        generated_hits: list[DrumHit] = []
        group_boundaries = tuple(grouping_boundaries(list(pattern.settings.grouping_values)))
        for bar in pattern.bars:
            bar_hits = self._collect_bar_hits(bar)
            snare_config = pattern.instruments.get("snare")
            snare_ghost = None if snare_config is None else snare_config.ghost_settings
            if snare_config is not None and snare_ghost is not None and snare_config.enabled and snare_ghost.enabled:
                snare_hits = self._generate_snare_ghost_layer(
                    bar=bar,
                    config=snare_config,
                    rng=rng,
                    bar_hits=bar_hits,
                    accent_slots=accent_slots,
                    humanize_timing=pattern.settings.humanize_timing,
                    humanize_velocity_amount=pattern.settings.humanize_velocity,
                )
                generated_hits.extend(snare_hits)
                for hit in snare_hits:
                    bar_hits[hit.instrument].add(hit.slot_index)

            for instrument_key in ("hihat_closed", "ride"):
                config = pattern.instruments.get(instrument_key)
                ghost = None if config is None else config.ghost_settings
                if config is None or ghost is None or not config.enabled or not ghost.enabled:
                    continue
                pulse_hits = self._generate_pulse_ghost_layer(
                    bar=bar,
                    config=config,
                    rng=rng,
                    bar_hits=bar_hits,
                    accent_slots=accent_slots,
                    group_boundaries=group_boundaries,
                    humanize_timing=pattern.settings.humanize_timing,
                    humanize_velocity_amount=pattern.settings.humanize_velocity,
                )
                generated_hits.extend(pulse_hits)
                for hit in pulse_hits:
                    bar_hits[hit.instrument].add(hit.slot_index)

        pattern.set_ghost_hits(generated_hits)

    def _apply_bar_similarity(
        self,
        reference_bar: DrumBar,
        bar: DrumBar,
        settings: GlobalSettings,
        instruments: dict[str, InstrumentConfig],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
        structural_slots: dict[str, list[int]],
    ) -> None:
        similarity = max(0.0, min(1.0, settings.bar_similarity))
        if similarity <= 0.0:
            return
        fill_region_slots = set(bar.fill_region_slots)
        self._shape_similarity_layer(
            reference_bar,
            bar,
            instruments["kick"],
            similarity,
            layer_weight=1.0,
            variation_looseness=0.24,
            threshold=0.0,
            flexible_slots=fill_region_slots,
            rng=rng,
            bar_hits=bar_hits,
        )
        self._shape_similarity_layer(
            reference_bar,
            bar,
            instruments["snare"],
            similarity,
            layer_weight=1.0,
            variation_looseness=0.28,
            threshold=0.0,
            flexible_slots=fill_region_slots,
            rng=rng,
            bar_hits=bar_hits,
        )
        self._shape_similarity_layer(
            reference_bar,
            bar,
            instruments["hihat_closed"],
            similarity,
            layer_weight=0.86,
            variation_looseness=0.52,
            threshold=0.18,
            flexible_slots=fill_region_slots,
            rng=rng,
            bar_hits=bar_hits,
        )
        self._shape_similarity_layer(
            reference_bar,
            bar,
            instruments["ride"],
            similarity,
            layer_weight=0.82,
            variation_looseness=0.56,
            threshold=0.22,
            flexible_slots=fill_region_slots,
            rng=rng,
            bar_hits=bar_hits,
        )
        self._shape_similarity_layer(
            reference_bar,
            bar,
            instruments["hihat_open"],
            similarity,
            layer_weight=0.9,
            variation_looseness=0.58,
            threshold=0.52,
            flexible_slots=fill_region_slots,
            rng=rng,
            bar_hits=bar_hits,
        )
        self._shape_similarity_layer(
            reference_bar,
            bar,
            instruments["crash"],
            similarity,
            layer_weight=0.88,
            variation_looseness=0.6,
            threshold=0.6,
            flexible_slots=fill_region_slots,
            rng=rng,
            bar_hits=bar_hits,
        )
        for tom_key in ("tom_high", "tom_mid", "tom_low"):
            self._shape_similarity_layer(
                reference_bar,
                bar,
                instruments[tom_key],
                similarity,
                layer_weight=0.92,
                variation_looseness=0.62,
                threshold=0.4,
                flexible_slots=fill_region_slots,
                rng=rng,
                bar_hits=bar_hits,
            )
        self._validate_kick_snare_bar(
            bar,
            bar_hits,
            structural_slots["kick"],
            structural_slots["snare"],
        )

    def _shape_similarity_layer(
        self,
        reference_bar: DrumBar,
        bar: DrumBar,
        config: InstrumentConfig,
        similarity: float,
        layer_weight: float,
        variation_looseness: float,
        threshold: float,
        flexible_slots: set[int],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        effective_similarity = self._bar_similarity_strength(similarity, layer_weight, threshold)
        if effective_similarity <= 0.0:
            return
        reference_hits = {
            hit.slot_index: hit
            for hit in reference_bar.hits
            if hit.instrument == config.key and hit.hit_type != HIT_GHOST
        }
        current_hits = {
            hit.slot_index: hit
            for hit in bar.hits
            if hit.instrument == config.key and hit.hit_type != HIT_GHOST
        }
        if not reference_hits and not current_hits:
            return

        if similarity >= 0.999:
            target_slots = set(reference_hits)
        else:
            adopt_gate = min(0.98, 0.15 + effective_similarity * 0.85)
            variation_keep_gate = max(0.0, (1.0 - effective_similarity) * variation_looseness)
            target_slots = set(reference_hits.keys() & current_hits.keys())
            for slot in reference_hits.keys() - current_hits.keys():
                slot_adopt_gate = adopt_gate
                if slot in flexible_slots:
                    slot_adopt_gate *= 0.72
                if self._similarity_slot_allowed(config.key, slot, bar_hits) and rng.random() < slot_adopt_gate:
                    target_slots.add(slot)
            for slot in current_hits.keys() - reference_hits.keys():
                slot_keep_gate = variation_keep_gate
                if slot in flexible_slots:
                    slot_keep_gate = min(0.95, slot_keep_gate + 0.22)
                if rng.random() < slot_keep_gate:
                    target_slots.add(slot)

        for slot, hit in list(current_hits.items()):
            if slot in target_slots:
                continue
            self._remove_hit(bar, hit, bar_hits)

        for slot in sorted(target_slots):
            if slot in current_hits:
                reference_hit = reference_hits.get(slot)
                if reference_hit is None:
                    continue
                current_hit = current_hits[slot]
                current_hit.hit_type = reference_hit.hit_type
                current_hit.priority = reference_hit.priority
                current_hit.velocity = velocity_from_priority(
                    reference_hit.priority,
                    config.velocity_min,
                    config.velocity_max,
                )
                continue
            if not self._similarity_slot_allowed(config.key, slot, bar_hits):
                continue
            reference_hit = reference_hits.get(slot)
            if reference_hit is None:
                continue
            self._add_hit(
                bar,
                config,
                slot,
                reference_hit.hit_type,
                rng,
                bar_hits,
                hit_priority=reference_hit.priority,
            )

    def _bar_similarity_strength(
        self,
        similarity: float,
        layer_weight: float,
        threshold: float,
    ) -> float:
        if similarity >= 1.0:
            return 1.0
        if similarity <= threshold:
            return 0.0
        scaled = (similarity - threshold) / max(1e-6, 1.0 - threshold)
        return max(0.0, min(1.0, scaled * layer_weight))

    def _similarity_slot_allowed(
        self,
        instrument_key: str,
        slot: int,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        if instrument_key == "hihat_closed" and slot in bar_hits.get("hihat_open", set()):
            return False
        return True

    def _generate_regular_pulse_layers(
        self,
        bar: DrumBar,
        hihat_closed: InstrumentConfig,
        ride: InstrumentConfig,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        pulse_layers = [config for config in (hihat_closed, ride) if config.enabled]
        if not pulse_layers:
            return
        primary_key = "hihat_closed" if hihat_closed.enabled else "ride"
        primary_slots: set[int] = set()
        primary_config = hihat_closed if primary_key == "hihat_closed" else ride
        if primary_config.enabled:
            primary_slots = self._generate_regular_pulse_layer(
                bar,
                primary_config,
                role="primary",
                occupied_slots=set(),
                rng=rng,
                bar_hits=bar_hits,
            )
        secondary_config = ride if primary_key == "hihat_closed" else hihat_closed
        if secondary_config.enabled:
            self._generate_regular_pulse_layer(
                bar,
                secondary_config,
                role="secondary",
                occupied_slots=primary_slots,
                rng=rng,
                bar_hits=bar_hits,
            )

    def _generate_regular_pulse_layer(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        role: str,
        occupied_slots: set[int],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> set[int]:
        allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
        base_slots = _division_slots(config.pulse_division, bar.total_slots)
        if role == "secondary":
            candidate_slots = _division_slots("quarter", bar.total_slots)
        else:
            candidate_slots = list(base_slots)
        candidate_slots = self._thin_pulse_slots(candidate_slots, config, rng)
        generated_slots: set[int] = set()
        kick_slots = set(bar_hits.get("kick", set()))
        snare_slots = set(bar_hits.get("snare", set()))
        for slot in candidate_slots:
            if not _slot_allowed(slot, allowed, forbidden):
                continue
            if config.key == "hihat_closed" and slot in bar_hits.get("hihat_open", set()):
                continue
            accent_strength = _pulse_accent_strength(config.pulse_division, slot)
            accent_strength = _pulse_overlap_strength(accent_strength, slot, kick_slots, snare_slots)
            hit_type = HIT_ACCENT if accent_strength >= 0.9 else HIT_MAIN
            self._add_hit(
                bar,
                config,
                slot,
                hit_type,
                rng,
                bar_hits,
                hit_priority=accent_strength,
            )
            generated_slots.add(slot)
        return generated_slots

    def _thin_pulse_slots(
        self,
        candidate_slots: list[int],
        config: InstrumentConfig,
        rng: random.Random,
    ) -> list[int]:
        space = _pulse_space_value(config)
        if space <= 0.0 or len(candidate_slots) <= 1:
            return list(candidate_slots)

        kept_slots: list[int] = []
        for slot in candidate_slots:
            drop_probability = min(0.95, space * _pulse_drop_weight(config, slot))
            if drop_probability > 0.0 and rng.random() < drop_probability:
                continue
            kept_slots.append(slot)

        if kept_slots:
            return kept_slots
        strongest_slot = min(candidate_slots, key=lambda slot: (_pulse_drop_weight(config, slot), slot))
        return [strongest_slot]

    def _generate_snare(
        self,
        bar: DrumBar,
        settings: GlobalSettings,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
        structural_slots: list[int],
        structural_kick_slots: list[int],
        accent_slots: list[int],
        rng: random.Random,
        previous_slots: set[int],
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
        sync_level = _syncopation_level(config.syncopation_amount)
        kick_slots = set(bar_hits.get("kick", set()))
        self._place_snare_structural_hits(
            bar,
            config,
            structural_slots,
            accent_slots,
            rng,
            bar_hits,
            allowed,
            forbidden,
            sync_level,
            other_slots=kick_slots,
        )
        self._add_snare_extra_hits(
            bar,
            config,
            group_segments,
            structural_slots,
            structural_kick_slots,
            accent_slots,
            rng,
            previous_slots,
            bar_hits,
            allowed,
            forbidden,
            sync_level,
            conflict_slots=kick_slots,
        )

        if not bar_hits[config.key]:
            fallback_slot = self._best_structural_fallback(
                structural_slots,
                allowed,
                forbidden,
                bar.total_slots,
                set(structural_kick_slots) | kick_slots,
            )
            if fallback_slot is not None:
                self._add_hit(
                    bar,
                    config,
                    fallback_slot,
                    HIT_ACCENT,
                    rng,
                    bar_hits,
                    hit_priority=self._snare_structural_hit_priority(
                        fallback_slot,
                        structural_slots,
                        sync_level,
                    ),
                )

    def _generate_kick(
        self,
        bar: DrumBar,
        settings: GlobalSettings,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
        structural_slots: list[int],
        structural_snare_slots: list[int],
        accent_slots: list[int],
        rng: random.Random,
        previous_slots: set[int],
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
        sync_level = _syncopation_level(config.syncopation_amount)
        snare_slots = set(bar_hits.get("snare", set()))
        self._place_kick_structural_hits(
            bar,
            config,
            structural_slots,
            accent_slots,
            rng,
            bar_hits,
            allowed,
            forbidden,
            sync_level,
            other_slots=snare_slots,
        )
        self._add_kick_extra_hits(
            bar,
            config,
            group_segments,
            structural_slots,
            structural_snare_slots,
            accent_slots,
            rng,
            previous_slots,
            bar_hits,
            allowed,
            forbidden,
            sync_level,
            conflict_slots=snare_slots,
        )

    def _generate_open_hat(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
        for group_start, group_size in group_segments:
            candidates: list[tuple[int, float]] = []
            priority_map = _open_hat_group_priority_map(group_size)
            for local_slot, base_weight in priority_map.items():
                if base_weight <= 0:
                    continue
                global_slot = group_start + local_slot - 1
                if global_slot >= bar.total_slots:
                    continue
                if not _slot_allowed(global_slot, allowed, forbidden):
                    continue
                weight = self._open_hat_group_weight(
                    global_slot,
                    group_start,
                    group_size,
                    base_weight,
                    bar_hits,
                    bar.total_slots,
                )
                if weight <= 0:
                    continue
                if not self._open_hat_candidate_allowed(base_weight, config.density):
                    continue
                candidates.append((global_slot, weight))

            if not candidates:
                continue

            ranked = sorted(
                ((slot, weight * rng.uniform(0.82, 1.18), weight) for slot, weight in candidates),
                key=lambda item: item[1],
                reverse=True,
            )
            selected = 0
            max_hits = self._open_hat_group_hit_cap(group_size, config.density)
            for slot, _, weight in ranked:
                if selected >= max_hits:
                    break
                gate = self._open_hat_group_gate(weight, config.density)
                if rng.random() > gate:
                    continue
                hit_type = HIT_ACCENT if weight >= 0.9 else HIT_MAIN
                self._add_hit(
                    bar,
                    config,
                    slot,
                    hit_type,
                    rng,
                    bar_hits,
                    hit_priority=min(1.0, max(0.0, weight)),
                )
                selected += 1
                if config.density < 0.88:
                    break

    def _generate_crash(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
        crash_slots = set(bar_hits.get("crash", set()))
        for group_start, group_size in group_segments:
            candidates: list[tuple[int, float]] = []
            priority_map = _crash_group_priority_map(group_size)
            for local_slot, base_weight in priority_map.items():
                if base_weight <= 0:
                    continue
                global_slot = group_start + local_slot - 1
                if global_slot >= bar.total_slots:
                    continue
                if not _slot_allowed(global_slot, allowed, forbidden):
                    continue
                weight = self._crash_group_weight(
                    global_slot,
                    group_start,
                    group_size,
                    base_weight,
                    bar_hits,
                    bar.total_slots,
                    crash_slots,
                )
                if base_weight < 1.0 and config.density >= 0.72:
                    weight = min(1.0, weight + config.density * 0.12)
                if weight <= 0:
                    continue
                if not self._crash_candidate_allowed(base_weight, config.density):
                    continue
                candidates.append((global_slot, weight))

            if not candidates:
                continue

            ranked = sorted(
                ((slot, weight * rng.uniform(0.86, 1.14), weight) for slot, weight in candidates),
                key=lambda item: item[1],
                reverse=True,
            )
            active_candidates: list[tuple[int, float]] = []
            for slot, _, weight in ranked:
                if rng.random() > self._crash_group_gate(weight, config.density):
                    continue
                active_candidates.append((slot, weight))
            if not active_candidates:
                continue
            slot, weight = self._choose_weighted_slot(active_candidates, rng)
            self._add_hit(
                bar,
                config,
                slot,
                HIT_ACCENT if weight >= 0.9 else HIT_MAIN,
                rng,
                bar_hits,
                hit_priority=min(1.0, max(0.0, weight)),
            )
            crash_slots.add(slot)

    def _generate_tom_budget_layer(
        self,
        bars: list[DrumBar],
        settings: GlobalSettings,
        tom_instruments: dict[str, InstrumentConfig],
        accent_slots: list[int],
        rng: random.Random,
    ) -> None:
        budgets = {
            key: max(0, min(3, config.tom_hit_count))
            for key, config in tom_instruments.items()
            if config.tom_hit_count > 0
        }
        total_hits = sum(budgets.values())
        if total_hits <= 0:
            return

        total_slots = settings.bars * total_slots_per_bar(settings.numerator)
        phrase_lengths = self._plan_tom_phrase_lengths(total_hits, rng)
        phrase_sequence = self._build_tom_budget_sequence(budgets, rng)
        bar_hits = {bar.index: self._collect_bar_hits(bar) for bar in bars}
        anchors = self._collect_tom_budget_anchors(bars)
        if not anchors:
            return

        sequence_index = 0
        for phrase_length in phrase_lengths:
            instrument_slice = phrase_sequence[sequence_index:sequence_index + phrase_length]
            if len(instrument_slice) < phrase_length:
                break
            phrase_slots = self._place_tom_phrase_slots(
                anchors,
                phrase_length,
                len(set(instrument_slice)) == 1,
                bars,
                bar_hits,
                total_slots,
                rng,
            )
            if not phrase_slots:
                continue
            for note_index, (absolute_slot, tom_key) in enumerate(zip(phrase_slots, instrument_slice)):
                bar_index = absolute_slot // bars[0].total_slots
                slot = absolute_slot % bars[0].total_slots
                if not self._is_visible_odd_tom_slot(slot):
                    continue
                config = tom_instruments[tom_key]
                if not self._can_place_tom_slot(slot, tom_key, bar_hits[bar_index]):
                    continue
                hit_type = HIT_ACCENT if note_index == len(phrase_slots) - 1 and slot in accent_slots else HIT_MAIN
                priority = 0.66 + min(0.24, note_index * 0.08)
                if hit_type == HIT_ACCENT:
                    priority += 0.04
                self._add_hit(
                    bars[bar_index],
                    config,
                    slot,
                    hit_type,
                    rng,
                    bar_hits[bar_index],
                    hit_priority=min(1.0, priority),
                )
            sequence_index += phrase_length

        remaining_sequence = phrase_sequence[sequence_index:]
        for tom_key in remaining_sequence:
            placement = self._place_single_tom_budget_hit(anchors, bars, bar_hits, total_slots)
            if placement is None:
                break
            bar_index, slot = placement
            config = tom_instruments[tom_key]
            self._add_hit(
                bars[bar_index],
                config,
                slot,
                HIT_MAIN,
                rng,
                bar_hits[bar_index],
                hit_priority=0.7,
            )

    def _plan_tom_phrase_lengths(self, total_hits: int, rng: random.Random) -> list[int]:
        if total_hits <= 1:
            return [total_hits]
        if total_hits == 2:
            return [2]
        if total_hits == 3:
            return [3] if rng.random() < 0.7 else [1, 2]
        if total_hits == 4:
            return [2, 2] if rng.random() < 0.45 else [4]
        lengths: list[int] = []
        remaining = total_hits
        while remaining > 0:
            if remaining <= 3:
                lengths.append(remaining)
                break
            phrase_length = 3 if remaining in {4, 6, 7} or rng.random() < 0.75 else 2
            lengths.append(phrase_length)
            remaining -= phrase_length
        return lengths

    def _build_tom_budget_sequence(
        self,
        budgets: dict[str, int],
        rng: random.Random,
    ) -> list[str]:
        remaining = dict(budgets)
        total_hits = sum(remaining.values())
        active = [key for key, count in remaining.items() if count > 0]
        if len(active) == 1:
            return [active[0]] * total_hits

        patterns = {
            2: [
                active,
                list(reversed(active)),
            ],
            3: [
                ["tom_high", "tom_mid", "tom_low"],
                ["tom_low", "tom_mid", "tom_high"],
                ["tom_high", "tom_mid", "tom_low", "tom_mid"],
                ["tom_low", "tom_mid", "tom_high", "tom_mid"],
            ],
        }
        base_patterns = patterns[len(active)]
        pattern = rng.choice(base_patterns)
        sequence: list[str] = []
        pattern_index = 0
        while len(sequence) < total_hits:
            candidates = pattern[pattern_index:] + pattern[:pattern_index]
            chosen = None
            for candidate in candidates:
                if remaining.get(candidate, 0) <= 0:
                    continue
                if sequence and candidate == sequence[-1]:
                    continue
                chosen = candidate
                break
            if chosen is None:
                available = [key for key, count in remaining.items() if count > 0]
                available.sort(key=lambda key: (-remaining[key], key))
                chosen = available[0]
            sequence.append(chosen)
            remaining[chosen] -= 1
            pattern_index = (pattern.index(chosen) + 1) % len(pattern)
        return sequence

    def _collect_tom_budget_anchors(self, bars: list[DrumBar]) -> list[tuple[float, int]]:
        anchors: list[tuple[float, int]] = []
        for bar in bars:
            bar_offset = bar.index * bar.total_slots
            for hit in bar.hits:
                if hit.instrument not in {"kick", "snare"} or hit.hit_type == HIT_GHOST:
                    continue
                weight = 1.0 + bar.index * 0.35 + (hit.slot_index / max(1, bar.total_slots)) * 0.45
                if hit.slot_index >= bar.total_slots - 8:
                    weight += 0.55
                if hit.instrument == "snare":
                    weight += 0.12
                anchors.append((weight, bar_offset + hit.slot_index))
        anchors.sort(reverse=True)
        return anchors

    def _place_tom_phrase_slots(
        self,
        anchors: list[tuple[float, int]],
        phrase_length: int,
        single_tom_phrase: bool,
        bars: list[DrumBar],
        bar_hits: dict[int, dict[str, set[int]]],
        total_slots: int,
        rng: random.Random,
    ) -> list[int]:
        weighted_anchors = [anchor for _, anchor in anchors[: max(6, len(anchors))]]
        if not weighted_anchors:
            return []
        attempts = min(12, max(4, len(weighted_anchors)))
        for _ in range(attempts):
            anchor = rng.choice(weighted_anchors)
            candidates = self._tom_phrase_slot_candidates(
                anchor,
                phrase_length,
                single_tom_phrase,
                bars[0].total_slots,
                total_slots,
            )
            for slots in candidates:
                if self._phrase_slots_available(slots, bars, bar_hits):
                    return slots
        return []

    def _tom_phrase_slot_candidates(
        self,
        anchor: int,
        phrase_length: int,
        single_tom_phrase: bool,
        slots_per_bar: int,
        total_slots: int,
    ) -> list[list[int]]:
        bar_start = (anchor // slots_per_bar) * slots_per_bar
        bar_end = bar_start + slots_per_bar
        templates = [
            [0, 2, 4, 6],
            [-6, -4, -2, 0],
            [-4, -2, 0, 2],
            [0, 2, -2, 4],
            [-2, 0, 2, 4],
        ]
        if single_tom_phrase:
            templates = [
                [0, 4, 8, 12],
                [-12, -8, -4, 0],
                [-8, -4, 0, 4],
                [0, 4, -4, 8],
                [-4, 0, 4, 8],
            ] + templates
        candidates: list[list[int]] = []
        for template in templates:
            slots = [anchor + offset for offset in template[:phrase_length]]
            if not slots:
                continue
            if any(slot < bar_start or slot >= bar_end for slot in slots):
                continue
            if any(slot < 0 or slot >= total_slots for slot in slots):
                continue
            if any(not self._is_visible_odd_tom_slot(slot) for slot in slots):
                continue
            if single_tom_phrase and phrase_length >= 3 and not self._single_tom_spacing_ok(slots):
                continue
            candidates.append(slots)
        if phrase_length == 1:
            for offset in (0, 2, -2, 4, -4):
                slot = anchor + offset
                if bar_start <= slot < bar_end and 0 <= slot < total_slots and self._is_visible_odd_tom_slot(slot):
                    candidates.append([slot])
        if single_tom_phrase and phrase_length == 2:
            candidates.sort(key=lambda slots: 0 if self._single_tom_spacing_ok(slots) else 1)
        return candidates

    def _phrase_slots_available(
        self,
        absolute_slots: list[int],
        bars: list[DrumBar],
        bar_hits: dict[int, dict[str, set[int]]],
    ) -> bool:
        slots_per_bar = bars[0].total_slots
        for absolute_slot in absolute_slots:
            bar_index = absolute_slot // slots_per_bar
            slot = absolute_slot % slots_per_bar
            if not self._can_place_tom_slot(slot, None, bar_hits[bar_index]):
                return False
        return True

    def _place_single_tom_budget_hit(
        self,
        anchors: list[tuple[float, int]],
        bars: list[DrumBar],
        bar_hits: dict[int, dict[str, set[int]]],
        total_slots: int,
    ) -> tuple[int, int] | None:
        slots_per_bar = bars[0].total_slots
        for _, anchor in anchors:
            for offset in (0, 2, -2, 4, -4, 6, -6):
                absolute_slot = anchor + offset
                if absolute_slot < 0 or absolute_slot >= total_slots:
                    continue
                bar_index = absolute_slot // slots_per_bar
                slot = absolute_slot % slots_per_bar
                if self._can_place_tom_slot(slot, None, bar_hits[bar_index]):
                    return bar_index, slot
        return None

    def _collect_bar_hits(self, bar: DrumBar) -> dict[str, set[int]]:
        hits: dict[str, set[int]] = defaultdict(set)
        for hit in bar.hits:
            hits[hit.instrument].add(hit.slot_index)
        return hits

    def _snapshot_fill_region_hits(self, bar: DrumBar) -> list[DrumHit]:
        fill_slots = set(bar.fill_region_slots)
        return [
            DrumHit(
                instrument=hit.instrument,
                midi_note=hit.midi_note,
                slot_index=hit.slot_index,
                bar_index=hit.bar_index,
                velocity=hit.velocity,
                priority=hit.priority,
                hit_type=hit.hit_type,
                micro_timing_offset=hit.micro_timing_offset,
                length_ticks=hit.length_ticks,
                source=hit.source,
            )
            for hit in bar.hits
            if hit.slot_index in fill_slots and hit.hit_type != HIT_GHOST
        ]

    def _restore_fill_region_snapshot(
        self,
        bar: DrumBar,
        snapshot: list[DrumHit],
        bar_hits: dict[str, set[int]],
    ) -> None:
        fill_slots = set(bar.fill_region_slots)
        for hit in list(bar.hits):
            if hit.slot_index in fill_slots and hit.hit_type != HIT_GHOST:
                self._remove_hit(bar, hit, bar_hits)
        for snap in snapshot:
            restored = DrumHit(
                instrument=snap.instrument,
                midi_note=snap.midi_note,
                slot_index=snap.slot_index,
                bar_index=snap.bar_index,
                velocity=snap.velocity,
                priority=snap.priority,
                hit_type=snap.hit_type,
                micro_timing_offset=snap.micro_timing_offset,
                length_ticks=snap.length_ticks,
                source=snap.source,
            )
            bar.add_hit(restored)
            bar_hits[restored.instrument].add(restored.slot_index)

    def _fill_active_slots(self, fill_region_slots: list[int]) -> list[int]:
        return [slot for slot in fill_region_slots if self._is_visible_odd_grid_slot(slot)]

    def _apply_fill_region(
        self,
        bar: DrumBar,
        fill_region: FillRegion,
        fill_active_slots: list[int],
        group_segments: list[tuple[int, int]],
        instruments: dict[str, InstrumentConfig],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not fill_active_slots:
            return
        intensity = fill_region.intensity
        if intensity == "low":
            return
        self._shape_fill_kick(bar, fill_active_slots, intensity, bar_hits)
        self._ensure_fill_final_kick_anchor(
            bar,
            instruments["kick"],
            fill_region,
            group_segments,
            rng,
            bar_hits,
        )
        self._shape_fill_pulse(bar, fill_active_slots, intensity, bar_hits)
        self._shape_fill_snare(bar, instruments["snare"], fill_active_slots, intensity, rng, bar_hits)
        self._shape_fill_toms(
            bar,
            {
                key: instruments[key]
                for key in ("tom_high", "tom_mid", "tom_low")
            },
            fill_active_slots,
            intensity,
            rng,
            bar_hits,
        )
        self._shape_fill_open_hat(bar, instruments["hihat_open"], fill_active_slots, intensity, rng, bar_hits)
        self._shape_fill_crash_edge(bar, instruments["crash"], intensity, rng, bar_hits)
        self._shape_fill_high_signature(bar, instruments, fill_active_slots, intensity, rng, bar_hits)
        self._ensure_fill_slot_coverage(bar, instruments, fill_active_slots, intensity, rng, bar_hits)

    def _ensure_fill_slot_coverage(
        self,
        bar: DrumBar,
        instruments: dict[str, InstrumentConfig],
        fill_active_slots: list[int],
        intensity: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if intensity != "medium":
            return
        for slot in sorted(fill_active_slots):
            if self._slot_has_any_hit(slot, bar_hits):
                continue
            if self._try_fill_slot_with_pulse(bar, slot, instruments, rng, bar_hits):
                continue
            if self._try_fill_slot_with_snare(bar, slot, instruments["snare"], rng, bar_hits):
                continue
            if self._try_fill_slot_with_tom(bar, slot, instruments, rng, bar_hits):
                continue
            if self._try_fill_slot_with_open_hat(bar, slot, instruments["hihat_open"], rng, bar_hits):
                continue
            self._try_fill_slot_with_kick(bar, slot, instruments["kick"], rng, bar_hits)

    def _slot_has_any_hit(self, slot: int, bar_hits: dict[str, set[int]]) -> bool:
        return any(slot in slots for slots in bar_hits.values())

    def _shape_fill_high_signature(
        self,
        bar: DrumBar,
        instruments: dict[str, InstrumentConfig],
        fill_active_slots: list[int],
        intensity: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if intensity != "high":
            return
        snare_config = instruments["snare"]
        if not snare_config.enabled:
            return

        ordered_slots = sorted(fill_active_slots)
        if not ordered_slots:
            return

        for hit in list(bar.hits):
            if hit.slot_index not in ordered_slots:
                continue
            if hit.hit_type == HIT_GHOST:
                continue
            self._remove_hit(bar, hit, bar_hits)

        accent_configs = self._fill_high_accent_configs(instruments)
        accent_slot_count = 0
        if len(ordered_slots) >= 3 and accent_configs:
            accent_slot_count = 1 if len(ordered_slots) == 3 else 2

        accent_slots = ordered_slots[:accent_slot_count]
        snare_slots = ordered_slots[accent_slot_count:]

        for index, slot in enumerate(snare_slots):
            priority = 0.84 + 0.12 * (index / max(1, len(snare_slots) - 1))
            hit_type = HIT_ACCENT if slot == snare_slots[-1] else HIT_MAIN
            self._add_hit(
                bar,
                snare_config,
                slot,
                hit_type,
                rng,
                bar_hits,
                hit_priority=min(0.98, priority),
            )

        for slot, config in zip(accent_slots, self._fill_high_accent_sequence(accent_configs, len(accent_slots))):
            if config.key.startswith("tom_") and not self._can_place_tom_slot(slot, config.key, bar_hits):
                self._add_hit(bar, snare_config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.84)
                continue
            self._add_hit(
                bar,
                config,
                slot,
                HIT_MAIN,
                rng,
                bar_hits,
                hit_priority=0.82,
            )

    def _fill_high_accent_configs(
        self,
        instruments: dict[str, InstrumentConfig],
    ) -> list[InstrumentConfig]:
        toms = [
            instruments[key]
            for key in ("tom_high", "tom_mid", "tom_low")
            if instruments[key].enabled and instruments[key].tom_hit_count > 0
        ]
        toms.sort(key=lambda config: (-config.tom_hit_count, config.key))
        accents: list[InstrumentConfig] = toms
        if instruments["hihat_open"].enabled:
            accents.append(instruments["hihat_open"])
        if instruments["crash"].enabled:
            accents.append(instruments["crash"])
        return accents

    def _fill_high_accent_sequence(
        self,
        accent_configs: list[InstrumentConfig],
        count: int,
    ) -> list[InstrumentConfig]:
        if not accent_configs or count <= 0:
            return []
        return [accent_configs[index % len(accent_configs)] for index in range(count)]

    def _try_fill_slot_with_pulse(
        self,
        bar: DrumBar,
        slot: int,
        instruments: dict[str, InstrumentConfig],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        for key in ("hihat_closed", "ride"):
            config = instruments[key]
            if not config.enabled:
                continue
            allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
            if not _slot_allowed(slot, allowed, forbidden):
                continue
            self._add_hit(bar, config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.74)
            return True
        return False

    def _try_fill_slot_with_snare(
        self,
        bar: DrumBar,
        slot: int,
        config: InstrumentConfig,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        if not config.enabled:
            return False
        if slot in bar_hits.get("kick", set()):
            return False
        self._add_hit(bar, config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.8)
        return True

    def _try_fill_slot_with_tom(
        self,
        bar: DrumBar,
        slot: int,
        instruments: dict[str, InstrumentConfig],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        tom_configs = [
            instruments[key]
            for key in ("tom_high", "tom_mid", "tom_low")
            if instruments[key].enabled and instruments[key].tom_hit_count > 0
        ]
        if not tom_configs:
            return False
        tom_configs.sort(key=lambda config: (-config.tom_hit_count, config.key))
        for config in tom_configs:
            if not self._can_place_tom_slot(slot, config.key, bar_hits):
                continue
            self._add_hit(bar, config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.76)
            return True
        return False

    def _try_fill_slot_with_open_hat(
        self,
        bar: DrumBar,
        slot: int,
        config: InstrumentConfig,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        if not config.enabled:
            return False
        if slot in bar_hits.get("kick", set()) or slot in bar_hits.get("snare", set()):
            return False
        if slot in bar_hits.get("hihat_closed", set()):
            existing = self._find_hit(bar, "hihat_closed", slot)
            if existing is not None:
                self._remove_hit(bar, existing, bar_hits)
        self._add_hit(bar, config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.78)
        return True

    def _try_fill_slot_with_kick(
        self,
        bar: DrumBar,
        slot: int,
        config: InstrumentConfig,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        if not config.enabled:
            return False
        if slot in bar_hits.get("snare", set()):
            return False
        self._add_hit(bar, config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.8)
        return True

    def _shape_fill_kick(
        self,
        bar: DrumBar,
        fill_active_slots: list[int],
        intensity: str,
        bar_hits: dict[str, set[int]],
    ) -> None:
        kick_hits = sorted(
            (hit for hit in bar.hits if hit.instrument == "kick" and hit.slot_index in fill_active_slots),
            key=lambda hit: (hit.priority, hit.slot_index),
            reverse=True,
        )
        keep_limits = {
            "low": 1,
            "medium": 1,
            "high": 0,
        }
        keep_count = keep_limits.get(intensity, 1)
        for hit in kick_hits[keep_count:]:
            self._remove_hit(bar, hit, bar_hits)

    def _ensure_fill_final_kick_anchor(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        fill_region: FillRegion,
        group_segments: list[tuple[int, int]],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled or not fill_region.slots:
            return
        anchor_slot = self._fill_final_kick_anchor_slot(fill_region, group_segments)
        if anchor_slot is None:
            return
        existing_kick = self._find_hit(bar, "kick", anchor_slot)
        if existing_kick is not None:
            existing_kick.hit_type = HIT_ACCENT
            existing_kick.priority = max(existing_kick.priority, 0.96)
            existing_kick.velocity = velocity_from_priority(
                existing_kick.priority,
                config.velocity_min,
                config.velocity_max,
            )
            return
        conflicting_snare = self._find_hit(bar, "snare", anchor_slot)
        if conflicting_snare is not None:
            self._remove_hit(bar, conflicting_snare, bar_hits)
        self._add_hit(
            bar,
            config,
            anchor_slot,
            HIT_ACCENT,
            rng,
            bar_hits,
            hit_priority=0.96,
        )

    def _fill_final_kick_anchor_slot(
        self,
        fill_region: FillRegion,
        group_segments: list[tuple[int, int]],
    ) -> int | None:
        if not fill_region.slots:
            return None
        region_terminal_slot = fill_region.slots[-1]
        for group_start, group_size in group_segments:
            group_end = group_start + group_size * 8
            if group_start <= region_terminal_slot < group_end:
                return group_start + (group_size - 1) * 8
        return None

    def _shape_fill_pulse(
        self,
        bar: DrumBar,
        fill_active_slots: list[int],
        intensity: str,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if intensity == "low":
            keep_rule = lambda slot: slot % 8 == 0
        elif intensity == "medium":
            keep_rule = lambda slot: slot % 8 == 0 and slot == min(fill_active_slots, default=slot)
        else:
            keep_rule = lambda slot: False

        for instrument in ("hihat_closed", "ride"):
            for hit in list(bar.hits):
                if hit.instrument != instrument or hit.slot_index not in fill_active_slots:
                    continue
                if keep_rule(hit.slot_index):
                    continue
                self._remove_hit(bar, hit, bar_hits)

    def _shape_fill_snare(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        fill_active_slots: list[int],
        intensity: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        for hit in list(bar.hits):
            if hit.instrument == "snare" and hit.slot_index in fill_active_slots:
                self._remove_hit(bar, hit, bar_hits)

        ordered_slots = sorted(fill_active_slots)
        if intensity == "low":
            selected_slots = ordered_slots[-1:]
        elif intensity == "medium":
            selected_slots = ordered_slots[-min(2, len(ordered_slots)) :]
        else:
            selected_slots = ordered_slots[-min(len(ordered_slots), max(2, len(ordered_slots) - 1)) :]

        for slot in selected_slots:
            if slot in bar_hits.get("kick", set()):
                continue
            priority = 0.78 + 0.16 * (selected_slots.index(slot) / max(1, len(selected_slots) - 1))
            hit_type = HIT_ACCENT if slot == selected_slots[-1] else HIT_MAIN
            self._add_hit(
                bar,
                config,
                slot,
                hit_type,
                rng,
                bar_hits,
                hit_priority=min(0.98, priority),
            )

    def _shape_fill_toms(
        self,
        bar: DrumBar,
        tom_instruments: dict[str, InstrumentConfig],
        fill_active_slots: list[int],
        intensity: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        active_toms = [config for config in tom_instruments.values() if config.enabled and config.tom_hit_count > 0]
        if not active_toms:
            return

        for hit in list(bar.hits):
            if hit.instrument in tom_instruments and hit.slot_index in fill_active_slots:
                self._remove_hit(bar, hit, bar_hits)

        phrase_slots = self._select_fill_tom_phrase_slots(
            fill_active_slots,
            intensity,
            rng,
            bar,
            bar_hits,
            single_tom_fill=len(active_toms) == 1,
        )
        if not phrase_slots:
            return

        for slot in phrase_slots:
            existing_snare = self._find_hit(bar, "snare", slot)
            if existing_snare is not None:
                self._remove_hit(bar, existing_snare, bar_hits)
            existing_kick = self._find_hit(bar, "kick", slot)
            if existing_kick is not None:
                self._remove_hit(bar, existing_kick, bar_hits)

        budgets = {config.key: max(1, config.tom_hit_count) for config in active_toms}
        sequence = self._build_tom_budget_sequence(budgets, rng)[: len(phrase_slots)]
        for note_index, (slot, tom_key) in enumerate(zip(phrase_slots, sequence)):
            config = tom_instruments[tom_key]
            priority = 0.72 + note_index * 0.1
            hit_type = HIT_ACCENT if note_index == len(phrase_slots) - 1 and slot == phrase_slots[-1] else HIT_MAIN
            self._add_hit(
                bar,
                config,
                slot,
                hit_type,
                rng,
                bar_hits,
                hit_priority=min(0.94, priority),
            )

    def _select_fill_tom_phrase_slots(
        self,
        fill_active_slots: list[int],
        intensity: str,
        rng: random.Random,
        bar: DrumBar,
        bar_hits: dict[str, set[int]],
        single_tom_fill: bool,
    ) -> list[int]:
        ordered_slots = sorted(fill_active_slots)
        snare_slots = sorted(slot for slot in ordered_slots if slot in bar_hits.get("snare", set()))
        protected_snare_slots = {snare_slots[-1]} if snare_slots else set()
        candidate_slots = [
            slot for slot in ordered_slots
            if slot not in protected_snare_slots
        ]
        if not candidate_slots:
            return []

        target_hits = self._fill_tom_target_hits(intensity, len(candidate_slots), rng)
        if target_hits <= 0:
            return []
        selected = candidate_slots[-target_hits:]
        if single_tom_fill and target_hits >= 3:
            spaced = self._select_spaced_tom_slots(candidate_slots, target_hits)
            if len(spaced) == target_hits:
                return spaced
        if single_tom_fill and target_hits == 2:
            spaced = self._select_spaced_tom_slots(candidate_slots, target_hits)
            if len(spaced) == target_hits:
                return spaced
        return selected

    def _fill_tom_target_hits(
        self,
        intensity: str,
        candidate_count: int,
        rng: random.Random,
    ) -> int:
        if candidate_count <= 0:
            return 0
        if intensity == "low":
            if rng.random() > 0.6:
                return 0
            return min(1, candidate_count)
        if intensity == "medium":
            preferred = 2 if candidate_count >= 2 else 1
            if candidate_count >= 3 and rng.random() < 0.25:
                preferred += 1
            return min(candidate_count, preferred)
        preferred = 3 if candidate_count >= 3 else candidate_count
        if candidate_count >= 4 and rng.random() < 0.35:
            preferred += 1
        return min(candidate_count, preferred)

    def _single_tom_spacing_ok(self, slots: list[int]) -> bool:
        ordered = sorted(slots)
        return all((right - left) >= 4 for left, right in zip(ordered, ordered[1:]))

    def _select_spaced_tom_slots(self, candidate_slots: list[int], target_hits: int) -> list[int]:
        if target_hits <= 0:
            return []
        selected: list[int] = []
        for slot in reversed(candidate_slots):
            if all(abs(slot - existing) >= 4 for existing in selected):
                selected.append(slot)
            if len(selected) >= target_hits:
                break
        selected.sort()
        return selected

    def _shape_fill_open_hat(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        fill_active_slots: list[int],
        intensity: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled:
            return
        for hit in list(bar.hits):
            if hit.instrument == "hihat_open" and hit.slot_index in fill_active_slots:
                self._remove_hit(bar, hit, bar_hits)

        if intensity == "low":
            return
        final_slot = fill_active_slots[-1]
        if final_slot in bar_hits.get("snare", set()) or final_slot in bar_hits.get("kick", set()):
            return
        if final_slot in bar_hits.get("hihat_closed", set()):
            existing = self._find_hit(bar, "hihat_closed", final_slot)
            if existing is not None:
                self._remove_hit(bar, existing, bar_hits)
        gate = 0.38 if intensity == "medium" else 0.68
        if rng.random() > gate:
            return
        self._add_hit(
            bar,
            config,
            final_slot,
            HIT_ACCENT,
            rng,
            bar_hits,
            hit_priority=0.84 if intensity == "medium" else 0.92,
        )

    def _shape_fill_crash_edge(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        intensity: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        if not config.enabled or intensity == "low":
            return
        if 0 in bar_hits.get("crash", set()):
            return
        gate = 0.28 if intensity == "medium" else 0.62
        if rng.random() > gate:
            return
        self._add_hit(
            bar,
            config,
            0,
            HIT_ACCENT,
            rng,
            bar_hits,
            hit_priority=0.86 if intensity == "medium" else 0.94,
        )

    def _can_place_tom_slot(
        self,
        slot: int,
        instrument_key: str | None,
        bar_hits: dict[str, set[int]],
    ) -> bool:
        if not self._is_visible_odd_tom_slot(slot):
            return False
        if slot in bar_hits.get("snare", set()):
            return False
        if slot in bar_hits.get("hihat_open", set()) or slot in bar_hits.get("crash", set()):
            return False
        if self._slot_layer_count(slot, bar_hits) >= 2:
            return False
        if instrument_key is not None and slot in bar_hits.get(instrument_key, set()):
            return False
        return True

    def _enforce_odd_tom_output(self, bars: list[DrumBar]) -> None:
        for bar in bars:
            bar.hits = [
                hit for hit in bar.hits
                if hit.instrument not in {"tom_high", "tom_mid", "tom_low"} or self._is_visible_odd_tom_slot(hit.slot_index)
            ]

    def _is_visible_odd_grid_slot(self, slot: int) -> bool:
        return slot % 2 == 0

    def _is_visible_odd_tom_slot(self, slot: int) -> bool:
        return self._is_visible_odd_grid_slot(slot)

    def _generate_tom_inserts(
        self,
        bar: DrumBar,
        settings: GlobalSettings,
        tom_instruments: dict[str, InstrumentConfig],
        accent_slots: list[int],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
    ) -> None:
        active_tom_keys = [key for key, config in tom_instruments.items() if config.enabled]
        if not active_tom_keys:
            return

        active_toms = [tom_instruments[key] for key in active_tom_keys]
        sync_level = max(_syncopation_level(config.syncopation_amount) for config in active_toms)
        if sync_level <= 0:
            return

        anchors = sorted(set(bar_hits.get("kick", set())) | set(bar_hits.get("snare", set())))
        if not anchors:
            return

        avg_density = sum(config.density for config in active_toms) / len(active_toms)
        profile = _tom_phrase_profile(sync_level)
        activity = min(1.0, max(0.0, avg_density))
        phrase_attempts = rng.randint(profile["phrase_count_min"], profile["phrase_count_max"])
        phrase_trigger_gate = self._tom_phrase_trigger_gate(profile, activity)

        for _ in range(phrase_attempts):
            if rng.random() > phrase_trigger_gate:
                continue
            anchor = self._choose_tom_anchor(anchors, accent_slots, rng)
            phrase_slots = self._build_tom_phrase_slots(anchor, bar.total_slots, profile, rng)
            phrase_slots = [slot for slot in phrase_slots if slot % 2 == 1]
            if len(phrase_slots) < self._tom_phrase_min_hits(activity):
                continue
            sequence = self._tom_phrase_sequence(active_tom_keys, len(phrase_slots), sync_level, rng)
            keep_cap = self._tom_phrase_keep_cap(len(phrase_slots), activity)
            kept_hits = 0

            for note_index, slot in enumerate(phrase_slots):
                if kept_hits >= keep_cap:
                    break
                tom_key = sequence[note_index]
                config = tom_instruments[tom_key]
                allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
                if not _slot_allowed(slot, allowed, forbidden):
                    continue
                if slot in bar_hits.get(tom_key, set()):
                    continue
                if self._slot_layer_count(slot, bar_hits) >= 2:
                    continue
                if slot in bar_hits.get("kick", set()) and rng.random() > profile["kick_overlap_gate"]:
                    continue
                if self._same_instrument_density_penalty(slot, bar_hits.get(tom_key, set())) > 0.4:
                    continue
                keep_gate = self._tom_phrase_hit_gate(
                    config.density,
                    activity,
                    note_index,
                    len(phrase_slots),
                    slot,
                    accent_slots,
                    profile,
                )
                if rng.random() > keep_gate:
                    continue
                weight = self._tom_phrase_hit_priority(
                    config.density,
                    activity,
                    note_index,
                    len(phrase_slots),
                    slot,
                    accent_slots,
                    profile,
                )
                weight += 0.08
                hit_type = HIT_ACCENT if note_index == len(phrase_slots) - 1 and slot in accent_slots else HIT_MAIN
                self._add_hit(
                    bar,
                    config,
                    slot,
                    hit_type,
                    rng,
                    bar_hits,
                    hit_priority=min(1.0, max(0.0, weight)),
                )
                kept_hits += 1

        if profile["allow_fallback"] and not any(bar_hits.get(key) for key in tom_instruments):
            fallback_anchor = self._choose_tom_anchor(anchors, accent_slots, rng)
            fallback_slots = self._build_tom_phrase_slots(fallback_anchor, bar.total_slots, profile, rng)
            fallback_slots = [slot for slot in fallback_slots if slot % 2 == 1]
            if len(fallback_slots) < self._tom_phrase_min_hits(activity):
                return
            fallback_sequence = self._tom_phrase_sequence(active_tom_keys, len(fallback_slots), sync_level, rng)
            for slot, tom_key in zip(fallback_slots, fallback_sequence):
                config = tom_instruments[tom_key]
                allowed, forbidden = _slot_filters_for_config(config, bar.total_slots)
                if not _slot_allowed(slot, allowed, forbidden):
                    continue
                if slot in bar_hits.get("kick", set()):
                    continue
                if self._slot_layer_count(slot, bar_hits) >= 2:
                    continue
                self._add_hit(bar, config, slot, HIT_MAIN, rng, bar_hits, hit_priority=0.68)
                break

    def _generate_snare_ghost_layer(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
        accent_slots: set[int],
        humanize_timing: int,
        humanize_velocity_amount: int,
    ) -> list[DrumHit]:
        ghost = config.ghost_settings
        if not config.enabled or ghost is None or not ghost.enabled:
            return []

        anchor_hits = [
            hit for hit in bar.base_hits
            if hit.instrument == config.key and hit.hit_type != HIT_GHOST and hit.slot_index not in bar.fill_region_slots
        ]
        if not anchor_hits:
            return []

        ghost_allowed = _parse_slot_spec(ghost.allowed_slots, bar.total_slots)
        forbidden = _parse_slot_spec(config.forbidden_slots, bar.total_slots)
        fill_region_slots = set(bar.fill_region_slots)
        generated_hits: list[DrumHit] = []
        active_anchors = self._select_snare_ghost_anchors(anchor_hits, ghost.density, rng)

        for anchor in active_anchors:
            candidate_slots = self._collect_snare_ghost_candidate_slots(
                anchor_slot=anchor.slot_index,
                total_slots=bar.total_slots,
                placement=ghost.placement,
                max_distance=max(1, min(2, ghost.max_distance_from_anchor)),
                accent_slots=accent_slots,
                occupied_slots=bar_hits,
                fill_region_slots=fill_region_slots,
                allowed_slots=ghost_allowed,
                forbidden_slots=forbidden,
            )
            if not candidate_slots:
                continue

            slots_to_use = self._select_snare_ghost_slots(candidate_slots, ghost.density, rng)
            for slot in slots_to_use:
                hit = self._build_ghost_hit(
                    bar=bar,
                    config=config,
                    slot=slot,
                    ghost_settings=ghost,
                    rng=rng,
                    humanize_timing=humanize_timing,
                    humanize_velocity_amount=humanize_velocity_amount,
                )
                generated_hits.append(hit)
                bar_hits[config.key].add(slot)

        return generated_hits

    def _generate_pulse_ghost_layer(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
        accent_slots: set[int],
        group_boundaries: tuple[int, ...],
        humanize_timing: int,
        humanize_velocity_amount: int,
    ) -> list[DrumHit]:
        ghost = config.ghost_settings
        if not config.enabled or ghost is None or not ghost.enabled:
            return []

        anchor_hits = [
            hit for hit in bar.base_hits
            if hit.instrument == config.key and hit.hit_type != HIT_GHOST and hit.slot_index not in bar.fill_region_slots
        ]
        if not anchor_hits:
            return []

        strong_slots = self._pulse_ghost_strong_slots(bar, accent_slots)
        coverage = self._pulse_ghost_anchor_coverage(config.key, ghost.density)
        anchor_count = self._weighted_target_count(len(anchor_hits), coverage, rng)
        if anchor_count <= 0:
            return []

        selected_anchors = self._weighted_select_hits(
            hits=anchor_hits,
            count=anchor_count,
            score_fn=lambda hit: self._pulse_ghost_anchor_score(
                hit=hit,
                instrument_key=config.key,
                strong_slots=strong_slots,
                accent_slots=accent_slots,
                group_boundaries=group_boundaries,
                bar_hits=bar_hits,
            ),
            rng=rng,
        )
        if not selected_anchors:
            return []

        radius = self._pulse_ghost_radius(config.pulse_division)
        velocity_shift = -4 if config.key == "ride" else 0
        generated_hits: list[DrumHit] = []
        for anchor in selected_anchors:
            candidate_slots = self._collect_pulse_ghost_candidate_slots(
                anchor_slot=anchor.slot_index,
                placement=ghost.placement,
                radius=radius,
                total_slots=bar.total_slots,
                accent_slots=accent_slots,
                strong_slots=strong_slots,
                bar_hits=bar_hits,
                fill_region_slots=set(bar.fill_region_slots),
            )
            if not candidate_slots:
                continue

            slot = self._select_weighted_slot(
                candidate_slots,
                lambda candidate: self._pulse_ghost_slot_score(
                    config.key,
                    anchor.slot_index,
                    candidate,
                    strong_slots,
                ),
                rng,
            )
            if slot is None:
                continue

            hit = self._build_ghost_hit(
                bar=bar,
                config=config,
                slot=slot,
                ghost_settings=ghost,
                rng=rng,
                humanize_timing=humanize_timing,
                humanize_velocity_amount=humanize_velocity_amount,
                velocity_shift=velocity_shift,
            )
            generated_hits.append(hit)
            bar_hits[config.key].add(slot)

        return generated_hits

    def _collect_snare_ghost_candidate_slots(
        self,
        anchor_slot: int,
        total_slots: int,
        placement: str,
        max_distance: int,
        accent_slots: set[int],
        occupied_slots: dict[str, set[int]],
        fill_region_slots: set[int],
        allowed_slots: set[int],
        forbidden_slots: set[int],
    ) -> list[int]:
        candidate_slots: list[int] = []
        for offset in self._snare_ghost_offsets(placement, max_distance):
            slot = anchor_slot + offset
            if slot < 0 or slot >= total_slots:
                continue
            if slot in fill_region_slots:
                continue
            if not self._is_weak_ghost_slot(slot, accent_slots):
                continue
            if allowed_slots and slot not in allowed_slots:
                continue
            if slot in forbidden_slots:
                continue
            if any(slot in slots for slots in occupied_slots.values()):
                continue
            candidate_slots.append(slot)
        return candidate_slots

    def _collect_pulse_ghost_candidate_slots(
        self,
        anchor_slot: int,
        placement: str,
        radius: int,
        total_slots: int,
        accent_slots: set[int],
        strong_slots: set[int],
        bar_hits: dict[str, set[int]],
        fill_region_slots: set[int],
    ) -> list[int]:
        candidate_slots: list[int] = []
        for offset in self._snare_ghost_offsets(placement, radius):
            slot = anchor_slot + offset
            if slot < 0 or slot >= total_slots:
                continue
            if slot in fill_region_slots:
                continue
            if slot in accent_slots or slot in strong_slots:
                continue
            if not self._is_weak_ghost_slot(slot, accent_slots):
                continue
            if any(slot in slots for slots in bar_hits.values()):
                continue
            candidate_slots.append(slot)
        return candidate_slots

    def _build_ghost_hit(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        slot: int,
        ghost_settings: GhostSettings,
        rng: random.Random,
        humanize_timing: int,
        humanize_velocity_amount: int,
        velocity_shift: int = 0,
    ) -> DrumHit:
        velocity_min, velocity_max = self._ghost_velocity_bounds(ghost_settings, velocity_shift)
        velocity = rng.randint(velocity_min, velocity_max)
        scaled_velocity_amount = scaled_humanize_amount(humanize_velocity_amount)
        velocity = humanize_velocity(velocity, max(1, scaled_velocity_amount // 2 + 2), rng)
        velocity = max(velocity_min, min(velocity_max, velocity))
        timing_amount = min(12, max(2, scaled_humanize_amount(humanize_timing)))
        return DrumHit(
            instrument=config.key,
            midi_note=config.midi_note,
            slot_index=slot,
            bar_index=bar.index,
            velocity=velocity,
            priority=0.0,
            hit_type=HIT_GHOST,
            micro_timing_offset=rng.randint(-timing_amount, timing_amount) if timing_amount else 0,
            length_ticks=note_length_ticks(HIT_GHOST),
        )

    def _ghost_velocity_bounds(self, ghost_settings: GhostSettings, velocity_shift: int = 0) -> tuple[int, int]:
        target = max(1, min(127, ghost_settings.velocity + velocity_shift))
        spread = max(4, min(12, round(target * 0.18)))
        minimum = max(1, target - spread)
        maximum = min(127, target + spread)
        return minimum, max(minimum, maximum)

    def _pulse_ghost_strong_slots(self, bar: DrumBar, accent_slots: set[int]) -> set[int]:
        strong_slots = set(accent_slots)
        for hit in bar.base_hits:
            if hit.instrument == "snare":
                strong_slots.add(hit.slot_index)
            elif hit.instrument == "kick" and hit.hit_type in {HIT_MAIN, HIT_ACCENT}:
                strong_slots.add(hit.slot_index)
        return strong_slots

    def _pulse_ghost_anchor_coverage(self, instrument_key: str, density: float) -> float:
        clamped_density = max(0.0, min(1.0, density))
        if clamped_density <= 0.0:
            return 0.0
        if instrument_key == "ride":
            return 0.55 * (clamped_density ** 0.8)
        return 0.75 * (clamped_density ** 0.7)

    def _weighted_target_count(self, item_count: int, coverage: float, rng: random.Random) -> int:
        if item_count <= 0 or coverage <= 0.0:
            return 0
        target = max(0.0, min(float(item_count), coverage * item_count))
        count = int(target)
        if rng.random() < target - count:
            count += 1
        return max(0, min(item_count, count))

    def _weighted_select_hits(
        self,
        hits: list[DrumHit],
        count: int,
        score_fn,
        rng: random.Random,
    ) -> list[DrumHit]:
        if count <= 0 or not hits:
            return []
        remaining = list(hits)
        selected: list[DrumHit] = []
        while remaining and len(selected) < count:
            scored = [(max(0.01, score_fn(hit)), hit) for hit in remaining]
            total = sum(weight for weight, _ in scored)
            pick = rng.uniform(0.0, total)
            cursor = 0.0
            chosen = scored[-1][1]
            for weight, hit in scored:
                cursor += weight
                if pick <= cursor:
                    chosen = hit
                    break
            selected.append(chosen)
            remaining.remove(chosen)
        return sorted(selected, key=lambda hit: hit.slot_index)

    def _select_weighted_slot(
        self,
        slots: list[int],
        score_fn,
        rng: random.Random,
    ) -> int | None:
        if not slots:
            return None
        scored = [(max(0.01, score_fn(slot)), slot) for slot in slots]
        total = sum(weight for weight, _ in scored)
        pick = rng.uniform(0.0, total)
        cursor = 0.0
        for weight, slot in scored:
            cursor += weight
            if pick <= cursor:
                return slot
        return scored[-1][1]

    def _pulse_ghost_anchor_score(
        self,
        hit: DrumHit,
        instrument_key: str,
        strong_slots: set[int],
        accent_slots: set[int],
        group_boundaries: tuple[int, ...],
        bar_hits: dict[str, set[int]],
    ) -> float:
        slot = hit.slot_index
        score = 1.0
        if slot + 1 in strong_slots:
            score += 0.55
        elif slot + 2 in strong_slots:
            score += 0.28
        if slot - 1 in strong_slots:
            score += 0.14

        for boundary in group_boundaries[1:]:
            distance = boundary - slot
            if distance == 1:
                score += 0.35
                break
            if distance == 2:
                score += 0.18
                break

        if slot in accent_slots or slot in strong_slots:
            score *= 0.6

        local_density = 0
        for other_slot in bar_hits.get("kick", set()) | bar_hits.get("snare", set()) | bar_hits.get("crash", set()) | bar_hits.get("hihat_open", set()):
            if abs(other_slot - slot) <= 1:
                local_density += 1
        score -= min(0.42, local_density * 0.14)

        if instrument_key == "ride":
            score *= 0.82
        return max(0.05, score)

    def _pulse_ghost_radius(self, pulse_division: str) -> int:
        if pulse_division == "quarter":
            return 3
        if pulse_division == "eighth":
            return 2
        return 1

    def _pulse_ghost_slot_score(
        self,
        instrument_key: str,
        anchor_slot: int,
        slot: int,
        strong_slots: set[int],
    ) -> float:
        distance = abs(slot - anchor_slot)
        distance_weights = {
            1: 1.0,
            2: 0.52,
            3: 0.24,
        }
        score = distance_weights.get(distance, 0.12)
        if slot + 1 in strong_slots:
            score += 0.18
        elif slot - 1 in strong_slots:
            score += 0.08
        if instrument_key == "ride":
            score *= 0.86
        return max(0.05, score)

    def _select_snare_ghost_anchors(
        self,
        anchor_hits: list[DrumHit],
        density: float,
        rng: random.Random,
    ) -> list[DrumHit]:
        clamped_density = max(0.0, min(1.0, density))
        if clamped_density <= 0.0 or not anchor_hits:
            return []

        target = clamped_density * len(anchor_hits)
        selected_count = int(target)
        remainder = target - selected_count
        if rng.random() < remainder:
            selected_count += 1
        selected_count = max(1, min(len(anchor_hits), selected_count))
        return sorted(rng.sample(anchor_hits, selected_count), key=lambda hit: hit.slot_index)

    def _select_snare_ghost_slots(
        self,
        candidate_slots: list[int],
        density: float,
        rng: random.Random,
    ) -> list[int]:
        if not candidate_slots:
            return []

        selected_slots = [candidate_slots[0]]
        for index, slot in enumerate(candidate_slots[1:], start=1):
            if rng.random() < self._extra_ghost_gate(index, density):
                selected_slots.append(slot)
        return selected_slots

    def _snare_ghost_offsets(self, placement: str, max_distance: int) -> list[int]:
        offsets: list[int] = []
        if placement == "before":
            for distance in range(1, max_distance + 1):
                offsets.append(-distance)
        elif placement == "after":
            for distance in range(1, max_distance + 1):
                offsets.append(distance)
        else:
            for distance in range(1, max_distance + 1):
                offsets.extend((-distance, distance))

        unique_offsets: list[int] = []
        seen: set[int] = set()
        for offset in offsets:
            if offset == 0 or offset in seen:
                continue
            seen.add(offset)
            unique_offsets.append(offset)
        return unique_offsets

    def _is_weak_ghost_slot(self, slot: int, accent_slots: set[int]) -> bool:
        if slot in accent_slots:
            return False
        return slot % 8 not in {0, 4}

    def _extra_ghost_gate(self, candidate_index: int, density: float) -> float:
        clamped_density = max(0.0, min(1.0, density))
        profiles = {
            1: (0.64, 1.1),
            2: (0.26, 1.45),
            3: (0.08, 1.8),
        }
        weight, exponent = profiles.get(candidate_index, (0.03, 2.0))
        return min(0.9, max(0.0, weight * (clamped_density ** exponent)))

    def _humanize_bar(
        self,
        bar: DrumBar,
        settings: GlobalSettings,
        instruments: dict[str, InstrumentConfig],
        rng: random.Random,
    ) -> None:
        base_timing_amount = scaled_humanize_amount(settings.humanize_timing)
        base_velocity_amount = scaled_humanize_amount(settings.humanize_velocity)
        for hit in bar.hits:
            timing_amount = base_timing_amount
            velocity_amount = base_velocity_amount
            if hit.hit_type == HIT_GHOST:
                timing_amount = max(timing_amount, 2) + 2
                velocity_amount = max(1, velocity_amount // 2 + 2)
            offset = rng.randint(-timing_amount, timing_amount) if timing_amount else 0
            offset += _timing_feel_bias(
                instruments[hit.instrument].timing_feel,
                base_timing_amount,
                rng,
            )
            max_offset = _timing_offset_limit(timing_amount, base_timing_amount)
            hit.micro_timing_offset = _clamp_int(offset, -max_offset, max_offset)
            hit.velocity = humanize_velocity(hit.velocity, velocity_amount, rng)
            if hit.hit_type == HIT_GHOST:
                ghost_settings = instruments[hit.instrument].ghost_settings
                if ghost_settings is not None:
                    velocity_min, velocity_max = ghost_settings.velocity_bounds()
                    hit.velocity = max(velocity_min, min(velocity_max, hit.velocity))
            else:
                config = instruments[hit.instrument]
                hit.velocity = max(config.velocity_min, min(config.velocity_max, hit.velocity))
            hit.length_ticks = note_length_ticks(hit.hit_type)

    def _place_snare_structural_hits(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        structural_slots: list[int],
        accent_slots: list[int],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
        allowed: set[int],
        forbidden: set[int],
        sync_level: int,
        other_slots: set[int],
    ) -> None:
        for slot in structural_slots:
            if slot >= bar.total_slots:
                continue
            if not _slot_allowed(slot, allowed, forbidden):
                continue
            if slot in other_slots:
                continue
            if not self._should_keep_snare_structural_hit(slot, structural_slots, sync_level, rng):
                continue
            hit_type = HIT_ACCENT if slot in accent_slots else HIT_MAIN
            self._add_hit(
                bar,
                config,
                slot,
                hit_type,
                rng,
                bar_hits,
                hit_priority=self._snare_structural_hit_priority(slot, structural_slots, sync_level),
            )

    def _place_kick_structural_hits(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        structural_slots: list[int],
        accent_slots: list[int],
        rng: random.Random,
        bar_hits: dict[str, set[int]],
        allowed: set[int],
        forbidden: set[int],
        sync_level: int,
        other_slots: set[int],
    ) -> None:
        for slot in structural_slots:
            if slot >= bar.total_slots:
                continue
            if not _slot_allowed(slot, allowed, forbidden):
                continue
            if slot in other_slots:
                continue
            if not self._should_keep_kick_structural_hit(slot, structural_slots, sync_level, rng):
                continue
            hit_type = HIT_ACCENT if slot in accent_slots else HIT_MAIN
            self._add_hit(
                bar,
                config,
                slot,
                hit_type,
                rng,
                bar_hits,
                hit_priority=self._kick_structural_hit_priority(slot, structural_slots, sync_level),
            )

    def _add_snare_extra_hits(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
        structural_snare_slots: list[int],
        structural_kick_slots: list[int],
        accent_slots: list[int],
        rng: random.Random,
        previous_slots: set[int],
        bar_hits: dict[str, set[int]],
        allowed: set[int],
        forbidden: set[int],
        sync_level: int,
        conflict_slots: set[int],
    ) -> None:
        extra_target = self._snare_extra_target(config, group_segments)
        if extra_target <= 0:
            return

        structural_snare_set = set(structural_snare_slots)
        structural_kick_set = set(structural_kick_slots)
        candidates: list[tuple[int, float, str]] = []
        for group_start, group_size in group_segments:
            priority_map = _snare_group_priority_map(group_size)
            for local_slot, base_weight in priority_map.items():
                if base_weight <= 0:
                    continue
                global_slot = group_start + local_slot - 1
                if global_slot >= bar.total_slots:
                    continue
                if global_slot in structural_snare_set or global_slot in structural_kick_set:
                    continue
                if global_slot in conflict_slots:
                    continue
                if not _slot_allowed(global_slot, allowed, forbidden):
                    continue
                weight = self._snare_extra_weight(
                    global_slot,
                    bar.total_slots,
                    base_weight,
                    accent_slots,
                    previous_slots,
                    bar_hits.get(config.key, set()),
                    sync_level,
                )
                if weight <= 0:
                    continue
                hit_type = HIT_ACCENT if global_slot in accent_slots and sync_level >= 3 else HIT_MAIN
                candidates.append((global_slot, weight, hit_type))

        for slot, weight, hit_type in self._select_weighted_slots(candidates, rng):
            current_extra_hits = len(bar_hits[config.key]) - len(structural_snare_set & bar_hits[config.key])
            if current_extra_hits >= extra_target:
                break
            placement_gate = self._snare_extra_gate(weight)
            placement_gate -= self._same_instrument_density_penalty(slot, bar_hits.get(config.key, set()))
            placement_gate -= self._cross_instrument_proximity_penalty(slot, conflict_slots)
            if rng.random() > max(0.04, placement_gate):
                continue
            self._add_hit(bar, config, slot, hit_type, rng, bar_hits, hit_priority=weight)

    def _add_kick_extra_hits(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
        structural_kick_slots: list[int],
        structural_snare_slots: list[int],
        accent_slots: list[int],
        rng: random.Random,
        previous_slots: set[int],
        bar_hits: dict[str, set[int]],
        allowed: set[int],
        forbidden: set[int],
        sync_level: int,
        conflict_slots: set[int],
    ) -> None:
        extra_target = self._kick_extra_target(config, group_segments)
        if extra_target <= 0:
            return

        structural_kick_set = set(structural_kick_slots)
        structural_snare_set = set(structural_snare_slots)
        candidates: list[tuple[int, float, str]] = []

        for group_start, group_size in group_segments:
            priority_map = _kick_group_priority_map(group_size)
            for local_slot, base_weight in priority_map.items():
                if base_weight <= 0:
                    continue
                global_slot = group_start + local_slot - 1
                if global_slot >= bar.total_slots:
                    continue
                if global_slot in structural_kick_set or global_slot in structural_snare_set:
                    continue
                if global_slot in conflict_slots:
                    continue
                if not _slot_allowed(global_slot, allowed, forbidden):
                    continue
                weight = self._kick_extra_weight(
                    global_slot,
                    bar.total_slots,
                    base_weight,
                    accent_slots,
                    previous_slots,
                    bar_hits.get(config.key, set()),
                    sync_level,
                )
                if weight <= 0:
                    continue
                candidates.append((global_slot, weight, HIT_MAIN))

        for slot, weight, hit_type in self._select_weighted_slots(candidates, rng):
            current_extra_hits = len(bar_hits[config.key]) - len(structural_kick_set & bar_hits[config.key])
            if current_extra_hits >= extra_target:
                break
            placement_gate = self._kick_extra_gate(weight)
            placement_gate -= self._same_instrument_density_penalty(slot, bar_hits.get(config.key, set()))
            placement_gate -= self._cross_instrument_proximity_penalty(slot, conflict_slots)
            if rng.random() > max(0.04, placement_gate):
                continue
            self._add_hit(bar, config, slot, hit_type, rng, bar_hits, hit_priority=weight)

    def _select_weighted_slots(
        self,
        candidates: list[tuple[int, float, str]],
        rng: random.Random,
    ) -> list[tuple[int, float, str]]:
        ranked = []
        for slot, weight, hit_type in candidates:
            ranked.append((slot, weight * rng.uniform(0.78, 1.24), weight, hit_type))
        ranked.sort(key=lambda item: item[1], reverse=True)
        return [(slot, base_weight, hit_type) for slot, _, base_weight, hit_type in ranked]

    def _choose_weighted_slot(
        self,
        candidates: list[tuple[int, float]],
        rng: random.Random,
    ) -> tuple[int, float]:
        total_weight = sum(max(0.01, weight) for _, weight in candidates)
        threshold = rng.random() * total_weight
        cursor = 0.0
        for slot, weight in candidates:
            cursor += max(0.01, weight)
            if cursor >= threshold:
                return slot, weight
        return candidates[-1]

    def _same_instrument_density_penalty(self, slot: int, existing_slots: set[int]) -> float:
        if not existing_slots:
            return 0.0
        nearest = min(abs(slot - existing) for existing in existing_slots)
        if nearest == 0:
            return 1.0
        if nearest == 1:
            return 0.42
        if nearest == 2:
            return 0.18
        return 0.0

    def _best_structural_fallback(
        self,
        structural_slots: list[int],
        allowed: set[int],
        forbidden: set[int],
        total_slots: int,
        conflict_slots: set[int],
    ) -> int | None:
        for slot in structural_slots:
            if slot >= total_slots:
                continue
            if slot in conflict_slots:
                continue
            if _slot_allowed(slot, allowed, forbidden):
                return slot
        return None

    def _choose_tom_anchor(
        self,
        anchors: list[int],
        accent_slots: list[int],
        rng: random.Random,
    ) -> int:
        ranked: list[tuple[float, int]] = []
        for anchor in anchors:
            weight = 1.0
            if anchor in accent_slots:
                weight += 0.2
            if anchor % 2 == 1:
                weight += 0.15
            ranked.append((weight * rng.uniform(0.8, 1.25), anchor))
        ranked.sort(reverse=True)
        return ranked[0][1]

    def _build_tom_phrase_slots(
        self,
        anchor: int,
        total_slots: int,
        profile: dict[str, float | int | bool],
        rng: random.Random,
    ) -> list[int]:
        span = rng.randint(int(profile["span_min"]), int(profile["span_max"]))
        max_length = max(1, min(int(profile["length_max"]), span))
        phrase_length = rng.randint(int(profile["length_min"]), max_length)
        step_options = [1] * int(profile["step_bias_one"]) + [2] * int(profile["step_bias_two"])
        direction = rng.choice([-1, 1]) if profile["allow_reverse"] else 1
        cursor = self._nearest_odd_tom_slot(anchor, total_slots, direction)
        if cursor is None:
            return []
        slots: list[int] = []
        for _ in range(phrase_length):
            step = rng.choice(step_options)
            cursor += direction * step * 2
            if cursor < 0 or cursor >= total_slots:
                break
            slots.append(cursor)
            if profile["allow_direction_flip"] and rng.random() < float(profile["direction_flip_gate"]):
                direction *= -1
        return slots

    def _nearest_odd_tom_slot(
        self,
        anchor: int,
        total_slots: int,
        direction: int,
    ) -> int | None:
        candidates: list[int] = []
        for offset in (direction, -direction, 1, -1):
            candidate = anchor + offset
            if 0 <= candidate < total_slots and candidate % 2 == 1:
                candidates.append(candidate)
        return candidates[0] if candidates else None

    def _tom_phrase_sequence(
        self,
        active_tom_keys: list[str],
        phrase_length: int,
        sync_level: int,
        rng: random.Random,
    ) -> list[str]:
        if phrase_length <= 0:
            return []
        if len(active_tom_keys) == 1:
            return [active_tom_keys[0]] * phrase_length
        if len(active_tom_keys) == 2:
            a, b = active_tom_keys
            patterns = [
                [a, b],
                [b, a],
                [a, b, a],
                [b, a, b],
            ]
            if sync_level >= 3:
                patterns.extend([[a, a, b], [b, b, a]])
            pattern = rng.choice(patterns)
            return [pattern[index % len(pattern)] for index in range(phrase_length)]
        patterns = [
            active_tom_keys,
            list(reversed(active_tom_keys)),
            [active_tom_keys[0], active_tom_keys[1], active_tom_keys[0]],
            [active_tom_keys[-1], active_tom_keys[1], active_tom_keys[-1]],
        ]
        if sync_level >= 3:
            patterns.extend([
                [active_tom_keys[0], active_tom_keys[1], active_tom_keys[2], active_tom_keys[1]],
                [active_tom_keys[2], active_tom_keys[1], active_tom_keys[0], active_tom_keys[1]],
            ])
        pattern = rng.choice(patterns)
        return [pattern[index % len(pattern)] for index in range(phrase_length)]

    def _tom_phrase_keep_cap(
        self,
        phrase_length: int,
        avg_density: float,
    ) -> int:
        if phrase_length <= 0:
            return 0
        min_hits = self._tom_phrase_min_hits(avg_density)
        fullness = 0.2 + (avg_density ** 0.9) * 0.8
        target = round(min_hits + max(0, phrase_length - min_hits) * fullness)
        return max(min_hits, min(phrase_length, target))

    def _tom_phrase_min_hits(self, activity: float) -> int:
        return 2 if activity < 0.72 else 3

    def _tom_phrase_trigger_gate(
        self,
        profile: dict[str, float | int | bool],
        activity: float,
    ) -> float:
        base = float(profile["trigger_gate"])
        activity_push = activity * 0.7
        return min(0.98, max(0.05, base * 0.35 + activity_push))

    def _tom_phrase_hit_gate(
        self,
        instrument_density: float,
        avg_density: float,
        note_index: int,
        phrase_length: int,
        slot: int,
        accent_slots: list[int],
        profile: dict[str, float | int | bool],
    ) -> float:
        base = float(profile["base_keep_gate"])
        density_push = avg_density * 0.42 + instrument_density * 0.18
        phrase_bonus = 0.06 if phrase_length <= 2 else 0.0
        tail_bonus = 0.08 if note_index == phrase_length - 1 else 0.0
        accent_bonus = 0.05 if slot in accent_slots else 0.0
        return min(0.94, max(0.08, base + density_push + phrase_bonus + tail_bonus + accent_bonus))

    def _tom_phrase_hit_priority(
        self,
        instrument_density: float,
        avg_density: float,
        note_index: int,
        phrase_length: int,
        slot: int,
        accent_slots: list[int],
        profile: dict[str, float | int | bool],
    ) -> float:
        base = float(profile["base_priority"])
        density_push = avg_density * 0.28 + instrument_density * 0.14
        movement_bonus = 0.05 if phrase_length >= 3 else 0.0
        tail_bonus = 0.07 if note_index == phrase_length - 1 else 0.0
        accent_bonus = 0.04 if slot in accent_slots else 0.0
        return min(0.96, max(0.2, base + density_push + movement_bonus + tail_bonus + accent_bonus))

    def _slot_layer_count(self, slot: int, bar_hits: dict[str, set[int]]) -> int:
        return sum(1 for slots in bar_hits.values() if slot in slots)

    def _open_hat_candidate_allowed(
        self,
        base_weight: float,
        density: float,
    ) -> bool:
        threshold = max(0.22, 0.92 - density * 0.72)
        return base_weight >= threshold

    def _open_hat_group_hit_cap(self, group_size: int, density: float) -> int:
        if density >= 0.92 and group_size >= 3:
            return 2
        return 1

    def _open_hat_group_gate(self, weight: float, density: float) -> float:
        base_gate = 0.08 + density * 0.34
        weight_push = weight * (0.28 + density * 0.08)
        return min(0.84, max(0.06, base_gate + weight_push))

    def _open_hat_group_weight(
        self,
        slot: int,
        group_start: int,
        group_size: int,
        base_weight: float,
        bar_hits: dict[str, set[int]],
        total_slots: int,
    ) -> float:
        weight = base_weight
        if slot in bar_hits.get("crash", set()):
            weight -= 0.55
        if slot in bar_hits.get("snare", set()):
            weight -= 0.45
        group_end = group_start + group_size * 8
        group_occupancy = sum(
            1
            for instrument_slots in bar_hits.values()
            for existing in instrument_slots
            if group_start <= existing < group_end
        )
        weight -= min(0.18, group_occupancy * 0.035)
        local_density = 0
        for delta in (-2, -1, 1, 2):
            nearby = slot + delta
            if nearby < 0 or nearby >= total_slots:
                continue
            if self._slot_layer_count(nearby, bar_hits) > 0:
                local_density += 1
        weight -= local_density * 0.06
        if self._slot_layer_count(slot, bar_hits) >= 2:
            weight -= 0.22
        return max(0.0, min(1.0, weight))

    def _crash_candidate_allowed(
        self,
        base_weight: float,
        density: float,
    ) -> bool:
        threshold = max(0.16, 0.95 - density * 0.82)
        return base_weight >= threshold

    def _crash_group_gate(self, weight: float, density: float) -> float:
        base_gate = 0.05 + density * 0.26
        weight_push = weight * (0.36 + density * 0.06)
        return min(0.78, max(0.04, base_gate + weight_push))

    def _crash_group_weight(
        self,
        slot: int,
        group_start: int,
        group_size: int,
        base_weight: float,
        bar_hits: dict[str, set[int]],
        total_slots: int,
        existing_crash_slots: set[int],
    ) -> float:
        weight = base_weight
        if slot in bar_hits.get("hihat_open", set()):
            weight -= 0.24
        group_end = group_start + group_size * 8
        group_occupancy = sum(
            1
            for instrument_slots in bar_hits.values()
            for existing in instrument_slots
            if group_start <= existing < group_end
        )
        weight -= min(0.16, group_occupancy * 0.03)
        local_density = 0
        for delta in (-2, -1, 1, 2):
            nearby = slot + delta
            if nearby < 0 or nearby >= total_slots:
                continue
            if self._slot_layer_count(nearby, bar_hits) > 0:
                local_density += 1
        weight -= local_density * 0.05
        if self._slot_layer_count(slot, bar_hits) >= 2:
            weight -= 0.18
        if existing_crash_slots:
            nearest_crash = min(abs(slot - existing) for existing in existing_crash_slots)
            if nearest_crash <= 4:
                weight -= 0.3
            elif nearest_crash <= 8:
                weight -= 0.14
        return max(0.0, min(1.0, weight))

    def _should_keep_kick_structural_hit(
        self,
        slot: int,
        structural_slots: list[int],
        sync_level: int,
        rng: random.Random,
    ) -> bool:
        keep_gate = _kick_structural_keep_weight(sync_level)
        if keep_gate >= 1.0:
            return True
        if structural_slots and slot == structural_slots[0]:
            keep_gate += 0.08
        return rng.random() < min(0.98, keep_gate)

    def _kick_structural_hit_priority(
        self,
        slot: int,
        structural_slots: list[int],
        sync_level: int,
    ) -> float:
        priority = _kick_structural_keep_weight(sync_level)
        if priority >= 1.0:
            return 1.0
        if structural_slots and slot == structural_slots[0]:
            priority += 0.08
        return min(0.98, max(0.0, priority))

    def _should_keep_snare_structural_hit(
        self,
        slot: int,
        structural_slots: list[int],
        sync_level: int,
        rng: random.Random,
    ) -> bool:
        keep_gate = _snare_structural_keep_weight(sync_level)
        if keep_gate >= 1.0:
            return True
        if structural_slots and slot == structural_slots[0]:
            keep_gate += 0.08
        return rng.random() < min(0.98, keep_gate)

    def _snare_structural_hit_priority(
        self,
        slot: int,
        structural_slots: list[int],
        sync_level: int,
    ) -> float:
        priority = _snare_structural_keep_weight(sync_level)
        if priority >= 1.0:
            return 1.0
        if structural_slots and slot == structural_slots[0]:
            priority += 0.08
        return min(0.98, max(0.0, priority))

    def _snare_extra_target(
        self,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
    ) -> int:
        if config.density <= 0:
            return 0
        group_capacity = sum(_snare_group_extra_capacity(group_size) for _, group_size in group_segments)
        density_scale = config.density ** 0.85
        return max(0, min(group_capacity, round(group_capacity * density_scale)))

    def _kick_extra_target(
        self,
        config: InstrumentConfig,
        group_segments: list[tuple[int, int]],
    ) -> int:
        if config.density <= 0:
            return 0
        group_capacity = sum(_kick_group_extra_capacity(group_size) for _, group_size in group_segments)
        density_scale = config.density ** 0.85
        return max(0, min(group_capacity, round(group_capacity * density_scale)))

    def _snare_extra_weight(
        self,
        slot: int,
        total_slots: int,
        base_weight: float,
        accent_slots: list[int],
        previous_slots: set[int],
        existing_slots: set[int],
        sync_level: int,
    ) -> float:
        boosted_weight = _snare_sync_priority_weight(base_weight, sync_level)
        repeat_bonus = 0.08 if slot in previous_slots else 0.0
        accent_bonus = 0.03 if slot in accent_slots and sync_level > 0 else 0.0
        density_penalty = self._same_instrument_density_penalty(slot, existing_slots) * 0.28
        return max(
            0.0,
            boosted_weight
            + repeat_bonus
            + accent_bonus
            + slot_shape_curve(slot, total_slots) * 0.03
            - density_penalty,
        )

    def _snare_extra_gate(
        self,
        weight: float,
    ) -> float:
        return min(
            0.94,
            max(
                0.05,
                weight * 0.56,
            ),
        )

    def _kick_extra_weight(
        self,
        slot: int,
        total_slots: int,
        base_weight: float,
        accent_slots: list[int],
        previous_slots: set[int],
        existing_slots: set[int],
        sync_level: int,
    ) -> float:
        boosted_weight = _kick_sync_priority_weight(base_weight, sync_level)
        repeat_bonus = 0.08 if slot in previous_slots else 0.0
        accent_bonus = 0.03 if slot in accent_slots and sync_level > 0 else 0.0
        density_penalty = self._same_instrument_density_penalty(slot, existing_slots) * 0.28
        return max(
            0.0,
            boosted_weight
            + repeat_bonus
            + accent_bonus
            + slot_shape_curve(slot, total_slots) * 0.03
            - density_penalty,
        )

    def _kick_extra_gate(
        self,
        weight: float,
    ) -> float:
        return min(
            0.94,
            max(
                0.05,
                weight * 0.56,
            ),
        )

    def _cross_instrument_proximity_penalty(self, slot: int, other_slots: set[int]) -> float:
        if not other_slots:
            return 0.0
        nearest = min(abs(slot - other) for other in other_slots)
        if nearest == 0:
            return 1.0
        if nearest == 1:
            return 0.28
        if nearest == 2:
            return 0.12
        return 0.0

    def _validate_kick_snare_bar(
        self,
        bar: DrumBar,
        bar_hits: dict[str, set[int]],
        structural_kick_slots: list[int],
        structural_snare_slots: list[int],
    ) -> None:
        collisions = sorted(bar_hits.get("kick", set()) & bar_hits.get("snare", set()))
        if not collisions:
            return

        kick_structural = set(structural_kick_slots)
        snare_structural = set(structural_snare_slots)

        for slot in collisions:
            kick_hit = self._find_hit(bar, "kick", slot)
            snare_hit = self._find_hit(bar, "snare", slot)
            if kick_hit is None or snare_hit is None:
                continue

            if slot in snare_structural and slot not in kick_structural:
                self._remove_hit(bar, kick_hit, bar_hits)
                continue
            if slot in kick_structural and slot not in snare_structural:
                self._remove_hit(bar, snare_hit, bar_hits)
                continue
            if slot in snare_structural:
                self._remove_hit(bar, kick_hit, bar_hits)
                continue
            self._remove_hit(bar, snare_hit, bar_hits)

    def _find_hit(self, bar: DrumBar, instrument: str, slot: int) -> DrumHit | None:
        for hit in bar.hits:
            if hit.instrument == instrument and hit.slot_index == slot:
                return hit
        return None

    def _remove_hit(
        self,
        bar: DrumBar,
        hit: DrumHit,
        bar_hits: dict[str, set[int]],
    ) -> None:
        bar.remove_hit(hit)
        bar_hits[hit.instrument].discard(hit.slot_index)

    def _add_hit(
        self,
        bar: DrumBar,
        config: InstrumentConfig,
        slot: int,
        hit_type: str,
        rng: random.Random,
        bar_hits: dict[str, set[int]],
        hit_priority: float | None = None,
    ) -> None:
        if slot in bar_hits[config.key]:
            return
        velocity_min = config.velocity_min
        velocity_max = config.velocity_max
        if hit_priority is None:
            stored_priority = 0.94 if hit_type == HIT_ACCENT else 0.72
        else:
            stored_priority = hit_priority
        velocity = velocity_from_priority(stored_priority, velocity_min, velocity_max)
        hit = DrumHit(
            instrument=config.key,
            midi_note=config.midi_note,
            slot_index=slot,
            bar_index=bar.index,
            velocity=velocity,
            priority=stored_priority,
            hit_type=hit_type,
        )
        bar.add_hit(hit)
        bar_hits[config.key].add(slot)


def _parse_slot_spec(spec: str, total_slots: int) -> set[int]:
    values: set[int] = set()
    cleaned = spec.strip()
    if not cleaned:
        return values
    for chunk in cleaned.split(","):
        part = chunk.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start = int(start_text) - 1
            end = int(end_text) - 1
            values.update(slot for slot in range(start, end + 1) if 0 <= slot < total_slots)
            continue
        value = int(part) - 1
        if 0 <= value < total_slots:
            values.add(value)
    return values


def _slot_filters_for_config(config: InstrumentConfig, total_slots: int) -> tuple[set[int], set[int]]:
    allowed = _parse_slot_spec(config.allowed_slots, total_slots)
    forbidden = _parse_slot_spec(config.forbidden_slots, total_slots)
    return allowed, forbidden


def _slot_allowed(slot: int, allowed: set[int], forbidden: set[int]) -> bool:
    if allowed and slot not in allowed:
        return False
    if slot in forbidden:
        return False
    return True


def _normalized_syncopation(syncopation_amount: float) -> float:
    return max(0.0, min(1.0, syncopation_amount))


def _syncopation_level(syncopation_amount: float) -> int:
    return max(0, min(5, int(round(_normalized_syncopation(syncopation_amount) * 5))))


def _chaos_amount(syncopation_amount: float) -> float:
    sync_amount = _normalized_syncopation(syncopation_amount)
    return max(0.0, (sync_amount - 0.5) / 0.5)


def _division_slots(division: str, total_slots: int) -> list[int]:
    if division == "quarter":
        step = 8
    elif division == "eighth":
        step = 4
    else:
        step = 2
    return list(range(0, total_slots, step))


def _pulse_accent_strength(division: str, slot: int) -> float:
    slot_in_beat = slot % 8
    if division == "quarter":
        return 0.9
    if division == "eighth":
        return 1.0 if slot_in_beat == 0 else 0.72
    if slot_in_beat == 0:
        return 1.0
    if slot_in_beat == 4:
        return 0.72
    return 0.45


def _pulse_overlap_strength(
    accent_strength: float,
    slot: int,
    kick_slots: set[int],
    snare_slots: set[int],
) -> float:
    if slot in snare_slots:
        accent_strength += 0.15
    if slot in kick_slots:
        accent_strength += 0.10
    return min(1.0, accent_strength)


def _pulse_space_value(config: InstrumentConfig) -> float:
    return max(0.0, min(1.0, config.pulse_space))


def _pulse_drop_weight(config: InstrumentConfig, slot: int) -> float:
    slot_in_beat = slot % 8
    if config.pulse_division == "quarter":
        return 0.0
    if config.pulse_division == "eighth":
        weight = 0.0 if slot_in_beat == 0 else 0.35
    else:
        if slot_in_beat == 0:
            weight = 0.15
        elif slot_in_beat == 4:
            weight = 0.35
        elif slot_in_beat in {2, 6}:
            weight = 0.60
        else:
            weight = 0.85
    if config.key == "ride":
        weight *= 0.82
    return max(0.0, min(1.0, weight))


def _clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def _timing_feel_bias_amount(base_timing_amount: int) -> int:
    return _clamp_int(4 + round(base_timing_amount * 0.25), 4, 8)


def _timing_feel_bias(feel: str, base_timing_amount: int, rng: random.Random) -> int:
    bias_amount = _timing_feel_bias_amount(base_timing_amount)
    if feel == "push":
        return -bias_amount
    if feel == "drag":
        return bias_amount
    if feel == "random":
        return rng.randint(-bias_amount, bias_amount)
    return 0


def _timing_offset_limit(timing_amount: int, base_timing_amount: int) -> int:
    bias_amount = _timing_feel_bias_amount(base_timing_amount)
    return _clamp_int(max(8, timing_amount + bias_amount), 8, 24)


def _open_hat_group_priority_map(group_size: int) -> dict[int, float]:
    maps = {
        1: {
            7: 1.0,
        },
        2: {
            13: 0.7,
            15: 1.0,
        },
        3: {
            17: 0.35,
            21: 0.7,
            23: 1.0,
        },
        4: {
            15: 0.25,
            27: 0.45,
            29: 0.75,
            31: 1.0,
        },
    }
    return maps.get(group_size, {})


def _crash_group_priority_map(group_size: int) -> dict[int, float]:
    maps = {
        1: {
            1: 1.0,
        },
        2: {
            1: 1.0,
            9: 0.25,
        },
        3: {
            1: 1.0,
            9: 0.20,
            17: 0.18,
        },
        4: {
            1: 1.0,
            9: 0.18,
            17: 0.25,
            25: 0.12,
        },
    }
    return maps.get(group_size, {})


def _tom_phrase_profile(sync_level: int) -> dict[str, float | int | bool]:
    profiles = {
        0: {
            "trigger_gate": 0.0,
            "phrase_count_min": 0,
            "phrase_count_max": 0,
            "length_min": 0,
            "length_max": 0,
            "span_min": 0,
            "span_max": 0,
            "step_bias_one": 0,
            "step_bias_two": 0,
            "allow_reverse": False,
            "allow_direction_flip": False,
            "direction_flip_gate": 0.0,
            "kick_overlap_gate": 0.0,
            "base_keep_gate": 0.0,
            "base_priority": 0.0,
            "allow_fallback": False,
        },
        1: {
            "trigger_gate": 0.18,
            "phrase_count_min": 1,
            "phrase_count_max": 1,
            "length_min": 1,
            "length_max": 2,
            "span_min": 1,
            "span_max": 2,
            "step_bias_one": 6,
            "step_bias_two": 1,
            "allow_reverse": False,
            "allow_direction_flip": False,
            "direction_flip_gate": 0.0,
            "kick_overlap_gate": 0.08,
            "base_keep_gate": 0.18,
            "base_priority": 0.38,
            "allow_fallback": False,
        },
        2: {
            "trigger_gate": 0.32,
            "phrase_count_min": 1,
            "phrase_count_max": 2,
            "length_min": 1,
            "length_max": 3,
            "span_min": 1,
            "span_max": 3,
            "step_bias_one": 5,
            "step_bias_two": 2,
            "allow_reverse": True,
            "allow_direction_flip": False,
            "direction_flip_gate": 0.0,
            "kick_overlap_gate": 0.12,
            "base_keep_gate": 0.24,
            "base_priority": 0.46,
            "allow_fallback": False,
        },
        3: {
            "trigger_gate": 0.48,
            "phrase_count_min": 1,
            "phrase_count_max": 2,
            "length_min": 2,
            "length_max": 4,
            "span_min": 2,
            "span_max": 4,
            "step_bias_one": 4,
            "step_bias_two": 3,
            "allow_reverse": True,
            "allow_direction_flip": True,
            "direction_flip_gate": 0.1,
            "kick_overlap_gate": 0.2,
            "base_keep_gate": 0.3,
            "base_priority": 0.52,
            "allow_fallback": False,
        },
        4: {
            "trigger_gate": 0.64,
            "phrase_count_min": 2,
            "phrase_count_max": 3,
            "length_min": 2,
            "length_max": 5,
            "span_min": 2,
            "span_max": 5,
            "step_bias_one": 3,
            "step_bias_two": 4,
            "allow_reverse": True,
            "allow_direction_flip": True,
            "direction_flip_gate": 0.18,
            "kick_overlap_gate": 0.28,
            "base_keep_gate": 0.36,
            "base_priority": 0.58,
            "allow_fallback": True,
        },
        5: {
            "trigger_gate": 0.8,
            "phrase_count_min": 2,
            "phrase_count_max": 4,
            "length_min": 2,
            "length_max": 6,
            "span_min": 2,
            "span_max": 6,
            "step_bias_one": 2,
            "step_bias_two": 5,
            "allow_reverse": True,
            "allow_direction_flip": True,
            "direction_flip_gate": 0.26,
            "kick_overlap_gate": 0.34,
            "base_keep_gate": 0.42,
            "base_priority": 0.64,
            "allow_fallback": True,
        },
    }
    return profiles[max(0, min(5, sync_level))]


def _kick_group_priority_map(group_size: int) -> dict[int, float]:
    maps = {
        1: {
            1: 0.35, 2: 0.00, 3: 0.18, 4: 0.00, 5: 0.42, 6: 0.00, 7: 0.55, 8: 0.00,
        },
        2: {
            1: 1.00, 2: 0.00, 3: 0.22, 4: 0.00, 5: 0.45, 6: 0.00, 7: 0.72, 8: 0.00,
            9: 0.00, 10: 0.00, 11: 0.20, 12: 0.00, 13: 0.40, 14: 0.00, 15: 0.82, 16: 0.00,
        },
        3: {
            1: 1.00, 2: 0.00, 3: 0.20, 4: 0.00, 5: 0.45, 6: 0.00, 7: 0.70, 8: 0.00,
            9: 0.15, 10: 0.00, 11: 0.40, 12: 0.00, 13: 0.65, 14: 0.00, 15: 0.95, 16: 0.00,
            17: 0.00, 18: 0.00, 19: 0.35, 20: 0.00, 21: 0.60, 22: 0.00, 23: 0.50, 24: 0.00,
        },
        4: {
            1: 1.00, 2: 0.00, 3: 0.28, 4: 0.00, 5: 0.52, 6: 0.00, 7: 0.78, 8: 0.00,
            9: 0.00, 10: 0.00, 11: 0.30, 12: 0.00, 13: 0.55, 14: 0.00, 15: 0.26, 16: 0.00,
            17: 1.00, 18: 0.00, 19: 0.27, 20: 0.00, 21: 0.82, 22: 0.00, 23: 0.88, 24: 0.00,
            25: 0.00, 26: 0.00, 27: 0.58, 28: 0.00, 29: 0.85, 30: 0.00, 31: 0.60, 32: 0.00,
        },
    }
    return maps[group_size]


def _snare_group_priority_map(group_size: int) -> dict[int, float]:
    maps = {
        1: {
            1: 0.45, 2: 0.00, 3: 0.18, 4: 0.00, 5: 0.35, 6: 0.00, 7: 0.22, 8: 0.00,
        },
        2: {
            1: 0.00, 2: 0.00, 3: 0.15, 4: 0.00, 5: 0.30, 6: 0.00, 7: 0.55, 8: 0.00,
            9: 1.00, 10: 0.00, 11: 0.20, 12: 0.00, 13: 0.40, 14: 0.00, 15: 0.65, 16: 0.00,
        },
        3: {
            1: 0.00, 2: 0.00, 3: 0.12, 4: 0.00, 5: 0.28, 6: 0.00, 7: 0.45, 8: 0.00,
            9: 0.30, 10: 0.00, 11: 0.18, 12: 0.00, 13: 0.35, 14: 0.00, 15: 0.25, 16: 0.00,
            17: 1.00, 18: 0.00, 19: 0.18, 20: 0.00, 21: 0.42, 22: 0.00, 23: 0.35, 24: 0.00,
        },
        4: {
            1: 0.00, 2: 0.00, 3: 0.18, 4: 0.00, 5: 0.35, 6: 0.00, 7: 0.55, 8: 0.00,
            9: 1.00, 10: 0.00, 11: 0.22, 12: 0.00, 13: 0.45, 14: 0.00, 15: 0.30, 16: 0.00,
            17: 0.00, 18: 0.00, 19: 0.20, 20: 0.00, 21: 0.60, 22: 0.00, 23: 0.70, 24: 0.00,
            25: 1.00, 26: 0.00, 27: 0.28, 28: 0.00, 29: 0.75, 30: 0.00, 31: 0.50, 32: 0.00,
        },
    }
    return maps[group_size]


def _kick_group_extra_capacity(group_size: int) -> int:
    capacities = {
        1: 2,
        2: 3,
        3: 4,
        4: 5,
    }
    return capacities[group_size]


def _snare_group_extra_capacity(group_size: int) -> int:
    total_capacities = {
        1: 2,
        2: 3,
        3: 4,
        4: 6,
    }
    structural_counts = {
        1: 0,
        2: 1,
        3: 1,
        4: 2,
    }
    return total_capacities[group_size] - structural_counts[group_size]


def _kick_sync_priority_weight(base_weight: float, sync_level: int) -> float:
    if base_weight <= 0.0:
        return 0.0
    if base_weight >= 1.0:
        return 1.0
    alpha = _kick_sync_priority_alpha(sync_level)
    return min(1.0, max(0.0, base_weight ** alpha))


def _kick_sync_priority_alpha(sync_level: int) -> float:
    alphas = {
        0: 1.0,
        1: 0.88,
        2: 0.76,
        3: 0.66,
        4: 0.58,
        5: 0.5,
    }
    return alphas[max(0, min(5, sync_level))]


def _kick_structural_keep_weight(sync_level: int) -> float:
    keep_weights = {
        0: 1.0,
        1: 1.0,
        2: 1.0,
        3: 1.0,
        4: 0.9,
        5: 0.8,
    }
    return keep_weights[max(0, min(5, sync_level))]


def _snare_sync_priority_weight(base_weight: float, sync_level: int) -> float:
    if base_weight <= 0.0:
        return 0.0
    if base_weight >= 1.0:
        return 1.0
    alpha = _kick_sync_priority_alpha(sync_level)
    return min(1.0, max(0.0, base_weight ** alpha))


def _snare_structural_keep_weight(sync_level: int) -> float:
    return _kick_structural_keep_weight(sync_level)
