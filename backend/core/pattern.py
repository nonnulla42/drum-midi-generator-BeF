from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Iterable, Sequence


HIT_MAIN = "main"
HIT_ACCENT = "accent"
HIT_GHOST = "ghost"
BASE_HIT_TYPES = (HIT_ACCENT, HIT_MAIN)


@dataclass(slots=True)
class GhostSettings:
    enabled: bool = False
    density: float = 0.25
    velocity: int = 34
    placement: str = "both"

    # Legacy/internal fields kept for compatibility with existing code paths.
    probability: float = 0.2
    velocity_min: int = 22
    velocity_max: int = 48
    timing_offset_amount: int = 8
    allowed_slots: str = ""
    max_distance_from_anchor: int = 1

    def velocity_bounds(self) -> tuple[int, int]:
        spread = max(4, min(12, round(self.velocity * 0.18)))
        minimum = max(1, self.velocity - spread)
        maximum = min(127, self.velocity + spread)
        return minimum, max(minimum, maximum)


@dataclass(slots=True)
class InstrumentConfig:
    key: str
    name: str
    midi_note: int
    enabled: bool = True
    tom_hit_count: int = 0
    density: float = 0.5
    pulse_division: str = "eighth"
    pulse_space: float = 0.0
    velocity_min: int = 72
    velocity_max: int = 108
    allowed_slots: str = ""
    forbidden_slots: str = ""
    syncopation_amount: float = 0.2
    timing_feel: str = "neutral"
    repetition_vs_variation: float = 0.7
    ghost_settings: GhostSettings | None = None


@dataclass(slots=True)
class GlobalSettings:
    bpm: int = 110
    denominator: int = 4
    bars: int = 1
    grouping: str = "2+2"
    swing: float = 0.0
    humanize_timing: int = 6
    humanize_velocity: int = 6
    bar_similarity: float = 0.7
    fill_every: int = 2
    fill_length: str = "medium"
    fill_intensity: str = "off"
    seed: int | None = None

    @property
    def grouping_values(self) -> tuple[int, ...]:
        from core.timing import parse_grouping

        return tuple(parse_grouping(self.grouping))

    @property
    def numerator(self) -> int:
        return sum(self.grouping_values)


@dataclass(slots=True)
class DrumHit:
    instrument: str
    midi_note: int
    slot_index: int
    bar_index: int
    velocity: int
    priority: float = 0.75
    hit_type: str = HIT_MAIN
    micro_timing_offset: int = 0
    length_ticks: int = 90
    source: str = "generated"


@dataclass(slots=True)
class FillRegion:
    bar_index: int
    slots: list[int]
    intensity: str


@dataclass(slots=True)
class DrumBar:
    index: int
    total_slots: int
    base_hits: list[DrumHit] = field(default_factory=list)
    ghost_hits: list[DrumHit] = field(default_factory=list)
    fill_region_slots: list[int] = field(default_factory=list)
    fill_active_slots: list[int] = field(default_factory=list)

    def add_hit(self, hit: DrumHit) -> None:
        if hit.hit_type == HIT_GHOST:
            self.ghost_hits.append(hit)
            return
        self.base_hits.append(hit)

    def remove_hit(self, hit: DrumHit) -> None:
        target = self.ghost_hits if hit.hit_type == HIT_GHOST else self.base_hits
        if hit in target:
            target.remove(hit)

    def clear_ghost_hits(self) -> None:
        self.ghost_hits.clear()

    def set_ghost_hits(self, hits: Sequence[DrumHit]) -> None:
        self.ghost_hits = [hit for hit in hits if hit.hit_type == HIT_GHOST]

    def find_hit(self, instrument: str, slot_index: int, hit_type: str | None = None) -> DrumHit | None:
        target = self.get_all_hits() if hit_type is None else (self.ghost_hits if hit_type == HIT_GHOST else self.base_hits)
        for hit in target:
            if hit.instrument == instrument and hit.slot_index == slot_index:
                return hit
        return None

    def get_all_hits(self) -> list[DrumHit]:
        return sorted([*self.base_hits, *self.ghost_hits], key=lambda hit: hit.slot_index)

    @property
    def hits(self) -> list[DrumHit]:
        return self.get_all_hits()

    @hits.setter
    def hits(self, values: Sequence[DrumHit]) -> None:
        self.base_hits = []
        self.ghost_hits = []
        for hit in values:
            self.add_hit(hit)


@dataclass(slots=True)
class DrumPattern:
    settings: GlobalSettings
    bars: list[DrumBar]
    instruments: dict[str, InstrumentConfig]
    fill_regions: list[FillRegion] = field(default_factory=list)

    @property
    def total_slots_per_bar(self) -> int:
        return self.settings.numerator * 8

    @property
    def total_slots(self) -> int:
        return self.total_slots_per_bar * self.settings.bars

    def all_hits(self) -> list[DrumHit]:
        return self.get_all_hits()

    def get_all_hits(self) -> list[DrumHit]:
        hits: list[DrumHit] = []
        for bar in self.bars:
            hits.extend(bar.get_all_hits())
        return hits

    def hits_for_cell(self, instrument_key: str, global_slot_index: int) -> list[DrumHit]:
        matches: list[DrumHit] = []
        for hit in self.get_all_hits():
            absolute_slot = hit.bar_index * self.total_slots_per_bar + hit.slot_index
            if hit.instrument == instrument_key and absolute_slot == global_slot_index:
                matches.append(hit)
        return matches

    def hit_for_cell(
        self,
        instrument_key: str,
        global_slot_index: int,
        hit_type: str | None = None,
    ) -> DrumHit | None:
        hits = self.hits_for_cell(instrument_key, global_slot_index)
        if hit_type is not None:
            hits = [hit for hit in hits if hit.hit_type == hit_type]
        if not hits:
            return None
        return sorted(hits, key=_visible_hit_priority)[0]

    def visible_base_hit_for_cell(self, instrument_key: str, global_slot_index: int) -> DrumHit | None:
        hits = [
            hit
            for hit in self.hits_for_cell(instrument_key, global_slot_index)
            if hit.hit_type in BASE_HIT_TYPES
        ]
        if not hits:
            return None
        return sorted(hits, key=_visible_hit_priority)[0]

    def iter_hits(self) -> Iterable[DrumHit]:
        for bar in self.bars:
            yield from bar.get_all_hits()

    def clear_ghost_hits(self) -> None:
        for bar in self.bars:
            bar.clear_ghost_hits()

    def set_ghost_hits(self, hits: Sequence[DrumHit]) -> None:
        hits_by_bar: dict[int, list[DrumHit]] = {bar.index: [] for bar in self.bars}
        for hit in hits:
            hits_by_bar.setdefault(hit.bar_index, []).append(hit)
        for bar in self.bars:
            bar.set_ghost_hits(hits_by_bar.get(bar.index, []))

    def replace_bars(self, bars: Sequence[DrumBar]) -> "DrumPattern":
        return DrumPattern(
            settings=self.settings,
            bars=list(bars),
            instruments=self.instruments,
            fill_regions=self.fill_regions,
        )

    def add_manual_base_hit(
        self,
        instrument_key: str,
        global_slot_index: int,
        config: InstrumentConfig,
        humanize_timing: int,
        humanize_velocity_amount: int,
        rng: random.Random | None = None,
    ) -> DrumHit | None:
        from core.timing import (
            clamp_velocity,
            clamp_int,
            humanize_velocity,
            note_length_ticks,
            scaled_humanize_amount,
            timing_feel_bias,
            timing_offset_limit,
            velocity_from_priority,
        )

        location = self._resolve_global_slot(global_slot_index)
        if location is None:
            return None
        if self.hit_for_cell(instrument_key, global_slot_index) is not None:
            return None

        rng = random.Random() if rng is None else rng
        bar_index, slot_index = location
        base_priority = 0.72
        velocity = velocity_from_priority(base_priority, config.velocity_min, config.velocity_max)
        velocity = humanize_velocity(velocity, scaled_humanize_amount(humanize_velocity_amount), rng)
        velocity = clamp_velocity(max(config.velocity_min, min(config.velocity_max, velocity)))
        base_timing_amount = scaled_humanize_amount(humanize_timing)
        timing_amount = base_timing_amount
        offset = rng.randint(-timing_amount, timing_amount) if timing_amount else 0
        offset += timing_feel_bias(config.timing_feel, base_timing_amount, rng)
        max_offset = timing_offset_limit(timing_amount, base_timing_amount)
        hit = DrumHit(
            instrument=instrument_key,
            midi_note=config.midi_note,
            slot_index=slot_index,
            bar_index=bar_index,
            velocity=velocity,
            priority=base_priority,
            hit_type=HIT_MAIN,
            micro_timing_offset=clamp_int(offset, -max_offset, max_offset),
            length_ticks=note_length_ticks(HIT_MAIN),
            source="manual",
        )
        self.bars[bar_index].add_hit(hit)
        return hit

    def remove_base_hit_at_cell(self, instrument_key: str, global_slot_index: int) -> bool:
        hit = self.visible_base_hit_for_cell(instrument_key, global_slot_index)
        if hit is None:
            return False
        self.bars[hit.bar_index].remove_hit(hit)
        return True

    def remove_ghost_hit_at_cell(self, instrument_key: str, global_slot_index: int) -> bool:
        if self.visible_base_hit_for_cell(instrument_key, global_slot_index) is not None:
            return False
        hit = self.hit_for_cell(instrument_key, global_slot_index, hit_type=HIT_GHOST)
        if hit is None:
            return False
        self.bars[hit.bar_index].remove_hit(hit)
        return True

    def move_base_hit(self, instrument_key: str, from_global_slot_index: int, to_global_slot_index: int) -> bool:
        hit = self.visible_base_hit_for_cell(instrument_key, from_global_slot_index)
        destination = self._resolve_global_slot(to_global_slot_index)
        if hit is None or destination is None or from_global_slot_index == to_global_slot_index:
            return False
        if self.hit_for_cell(instrument_key, to_global_slot_index) is not None:
            return False

        source_bar = self.bars[hit.bar_index]
        destination_bar_index, destination_slot_index = destination
        source_bar.remove_hit(hit)
        hit.bar_index = destination_bar_index
        hit.slot_index = destination_slot_index
        self.bars[destination_bar_index].add_hit(hit)
        return True

    def move_ghost_hit(self, instrument_key: str, from_global_slot_index: int, to_global_slot_index: int) -> bool:
        if self.visible_base_hit_for_cell(instrument_key, from_global_slot_index) is not None:
            return False
        hit = self.hit_for_cell(instrument_key, from_global_slot_index, hit_type=HIT_GHOST)
        destination = self._resolve_global_slot(to_global_slot_index)
        if hit is None or destination is None or from_global_slot_index == to_global_slot_index:
            return False
        if self.visible_base_hit_for_cell(instrument_key, to_global_slot_index) is not None:
            return False
        if self.hit_for_cell(instrument_key, to_global_slot_index, hit_type=HIT_GHOST) is not None:
            return False

        source_bar = self.bars[hit.bar_index]
        destination_bar_index, destination_slot_index = destination
        source_bar.remove_hit(hit)
        hit.bar_index = destination_bar_index
        hit.slot_index = destination_slot_index
        self.bars[destination_bar_index].add_hit(hit)
        return True

    def _resolve_global_slot(self, global_slot_index: int) -> tuple[int, int] | None:
        if global_slot_index < 0 or global_slot_index >= self.total_slots:
            return None
        bar_index = global_slot_index // self.total_slots_per_bar
        slot_index = global_slot_index % self.total_slots_per_bar
        return bar_index, slot_index


def _visible_hit_priority(hit: DrumHit) -> int:
    if hit.hit_type == HIT_ACCENT:
        return 0
    if hit.hit_type == HIT_MAIN:
        return 1
    return 2
