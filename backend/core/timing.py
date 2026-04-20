from __future__ import annotations

import math
import random

from core.pattern import FillRegion, GlobalSettings


TICKS_PER_BEAT = 480
TICKS_PER_SLOT = TICKS_PER_BEAT // 8


def total_slots_per_bar(numerator: int) -> int:
    return numerator * 8


def parse_grouping(grouping_text: str) -> list[int]:
    if not grouping_text.strip():
        raise ValueError("Grouping cannot be empty")
    try:
        grouping = [int(part.strip()) for part in grouping_text.split("+") if part.strip()]
    except ValueError as exc:
        raise ValueError("Grouping must contain only integers separated by '+'") from exc
    if not grouping:
        raise ValueError("Grouping cannot be empty")
    if any(group < 1 or group > 4 for group in grouping):
        raise ValueError("Grouping values must be between 1 and 4")
    return grouping


def grouping_boundaries(grouping: list[int]) -> list[int]:
    boundaries: list[int] = [0]
    cursor = 0
    for group in grouping:
        cursor += group * 8
        boundaries.append(cursor)
    return boundaries


def grouping_structural_slots(grouping: list[int]) -> dict[str, list[int]]:
    kick_slots: list[int] = []
    snare_slots: list[int] = []
    cursor = 0

    for group_size in grouping:
        if group_size == 2:
            kick_slots.append(cursor)
            snare_slots.append(cursor + 8)
        elif group_size == 3:
            kick_slots.append(cursor)
            snare_slots.append(cursor + 16)
        elif group_size == 4:
            kick_slots.extend((cursor, cursor + 16))
            snare_slots.extend((cursor + 8, cursor + 24))
        cursor += group_size * 8

    return {
        "kick": kick_slots,
        "snare": snare_slots,
    }


def grouping_segments(grouping: list[int]) -> list[tuple[int, int]]:
    segments: list[tuple[int, int]] = []
    cursor = 0
    for group_size in grouping:
        segments.append((cursor, group_size))
        cursor += group_size * 8
    return segments


def metric_accent_slots(settings: GlobalSettings) -> list[int]:
    grouping = list(settings.grouping_values)
    boundaries = grouping_boundaries(grouping)
    accents: list[int] = []
    for index, boundary in enumerate(boundaries[:-1]):
        accents.append(boundary)
        if index > 0:
            accents.append(boundary + 4)
    return sorted({slot for slot in accents if slot < total_slots_per_bar(settings.numerator)})


def strong_snare_slots(settings: GlobalSettings) -> list[int]:
    if settings.numerator == 4:
        return [8, 24]
    if settings.numerator == 3:
        return [8, 16]
    grouping = list(settings.grouping_values)
    boundaries = grouping_boundaries(grouping)
    result: list[int] = []
    for boundary in boundaries[1:-1]:
        result.append(max(0, boundary - 4))
    if not result:
        result.append(8)
    return sorted({slot for slot in result if slot < total_slots_per_bar(settings.numerator)})


def slot_to_ticks(slot_index: int, swing: float) -> int:
    ticks = slot_index * TICKS_PER_SLOT
    subdivision = slot_index % 2
    if subdivision == 1 and swing > 0:
        ticks += int(TICKS_PER_SLOT * 0.45 * swing)
    return ticks


def ticks_to_milliseconds(ticks: int, bpm: int, ticks_per_beat: int = TICKS_PER_BEAT) -> int:
    if bpm <= 0 or ticks_per_beat <= 0:
        return 0
    beat_ms = 60000 / bpm
    return int(round((ticks / ticks_per_beat) * beat_ms))


def humanize_velocity(base_velocity: int, amount: int, rng: random.Random) -> int:
    if amount <= 0:
        return clamp_velocity(base_velocity)
    return clamp_velocity(base_velocity + rng.randint(-amount, amount))


def scaled_humanize_amount(value: int, maximum: int = 24, exponent: float = 1.5) -> int:
    clamped = max(0, min(maximum, value))
    if clamped == 0 or maximum <= 0:
        return 0
    normalized = clamped / maximum
    return min(maximum, max(0, round(maximum * (normalized ** exponent))))


def velocity_from_priority(priority: float, velocity_min: int, velocity_max: int) -> int:
    clamped_priority = max(0.0, min(1.0, priority))
    if velocity_max <= velocity_min:
        return clamp_velocity(velocity_min)
    return clamp_velocity(round(velocity_min + (velocity_max - velocity_min) * clamped_priority))


def note_length_ticks(hit_type: str) -> int:
    if hit_type == "ghost":
        return 45
    if hit_type == "accent":
        return 80
    return 70


def clamp_velocity(velocity: int) -> int:
    return max(1, min(127, velocity))


def clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def timing_feel_bias_amount(base_timing_amount: int) -> int:
    return clamp_int(4 + round(base_timing_amount * 0.25), 4, 8)


def timing_feel_bias(feel: str, base_timing_amount: int, rng: random.Random) -> int:
    bias_amount = timing_feel_bias_amount(base_timing_amount)
    if feel == "push":
        return -bias_amount
    if feel == "drag":
        return bias_amount
    if feel == "random":
        return rng.randint(-bias_amount, bias_amount)
    return 0


def timing_offset_limit(timing_amount: int, base_timing_amount: int) -> int:
    bias_amount = timing_feel_bias_amount(base_timing_amount)
    return clamp_int(max(8, timing_amount + bias_amount), 8, 24)


def evenly_spaced_slots(numerator: int, step: int = 2) -> list[int]:
    return list(range(0, total_slots_per_bar(numerator), step))


def fill_every_value(settings: GlobalSettings) -> int:
    allowed = {1, 2, 4, 8}
    fill_every = settings.fill_every if settings.fill_every in allowed else 2
    return min(fill_every, settings.bars)


def build_fill_regions(settings: GlobalSettings) -> list[FillRegion]:
    if settings.fill_intensity == "off":
        return []
    fill_every = fill_every_value(settings)
    grouping = list(settings.grouping_values)
    group_boundaries = grouping_boundaries(grouping)
    last_group_start = group_boundaries[-2]
    last_group_end = group_boundaries[-1]
    last_group_slots = list(range(last_group_start, last_group_end))
    fill_length_map = {
        "short": 4,
        "medium": 6,
        "long": 8,
    }
    region_length = fill_length_map.get(settings.fill_length, 6)
    final_slots = last_group_slots[-min(region_length, len(last_group_slots)) :]
    fill_regions: list[FillRegion] = []
    for one_based_bar_index in range(1, settings.bars + 1):
        if one_based_bar_index % fill_every != 0:
            continue
        fill_regions.append(
            FillRegion(
                bar_index=one_based_bar_index - 1,
                slots=list(final_slots),
                intensity=settings.fill_intensity,
            )
        )
    return fill_regions


def slot_shape_curve(slot: int, total_slots: int) -> float:
    if total_slots <= 1:
        return 1.0
    position = slot / (total_slots - 1)
    return 0.55 + 0.45 * math.sin(position * math.pi)
