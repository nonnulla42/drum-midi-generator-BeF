from __future__ import annotations

from collections import defaultdict

from core.instruments import INSTRUMENT_ORDER, build_default_instruments
from core.pattern import DrumBar, DrumHit, DrumPattern, FillRegion, GlobalSettings


def serialize_pattern(pattern: DrumPattern) -> dict[str, object]:
    events: dict[str, list[dict[str, object]]] = {key: [] for key in INSTRUMENT_ORDER}

    for hit in pattern.iter_hits():
        events.setdefault(hit.instrument, []).append(
            {
                "bar": hit.bar_index,
                "slot": hit.slot_index,
                "hit_type": hit.hit_type,
                "velocity": hit.velocity,
                "offset": hit.micro_timing_offset,
                "length_ticks": hit.length_ticks,
                "source": hit.source,
            }
        )

    fill_regions = [
        {
            "bar": region.bar_index,
            "slots": list(region.slots),
            "intensity": region.intensity,
        }
        for region in pattern.fill_regions
    ]

    return {
        "pattern_version": 1,
        "meta": {
            "bpm": pattern.settings.bpm,
            "bars": pattern.settings.bars,
            "grouping": pattern.settings.grouping,
            "slots_per_bar": pattern.total_slots_per_bar,
            "swing": pattern.settings.swing,
            "humanize_timing": pattern.settings.humanize_timing,
            "humanize_velocity": pattern.settings.humanize_velocity,
        },
        "instrument_order": list(INSTRUMENT_ORDER),
        "events": events,
        "fill_regions": fill_regions,
    }


def deserialize_pattern(payload: dict[str, object]) -> DrumPattern:
    meta = payload["meta"]
    settings = GlobalSettings(
        bpm=int(meta["bpm"]),
        bars=int(meta["bars"]),
        grouping=str(meta["grouping"]),
        swing=float(meta.get("swing", 0.0)),
        humanize_timing=int(meta.get("humanize_timing", 6)),
        humanize_velocity=int(meta.get("humanize_velocity", 6)),
    )
    if int(meta["slots_per_bar"]) != settings.numerator * 8:
        raise ValueError("slots_per_bar does not match grouping")

    instruments = build_default_instruments()
    events = payload["events"]
    unknown_instruments = set(events.keys()) - set(INSTRUMENT_ORDER)
    if unknown_instruments:
        raise ValueError(f"Unknown instruments in pattern payload: {', '.join(sorted(unknown_instruments))}")
    hits_by_bar: dict[int, list[DrumHit]] = defaultdict(list)

    for instrument_key in INSTRUMENT_ORDER:
        instrument_events = events.get(instrument_key, [])
        config = instruments[instrument_key]
        for event in instrument_events:
            bar_index = int(event["bar"])
            slot_index = int(event["slot"])
            if bar_index < 0 or bar_index >= settings.bars:
                raise ValueError(f"Invalid bar index for {instrument_key}: {bar_index}")
            if slot_index < 0 or slot_index >= settings.numerator * 8:
                raise ValueError(f"Invalid slot index for {instrument_key}: {slot_index}")

            hits_by_bar[bar_index].append(
                DrumHit(
                    instrument=instrument_key,
                    midi_note=config.midi_note,
                    slot_index=slot_index,
                    bar_index=bar_index,
                    velocity=int(event["velocity"]),
                    hit_type=str(event["hit_type"]),
                    micro_timing_offset=int(event["offset"]),
                    length_ticks=int(event["length_ticks"]),
                    source=str(event.get("source", "generated")),
                )
            )

    bars: list[DrumBar] = []
    for bar_index in range(settings.bars):
        bar = DrumBar(index=bar_index, total_slots=settings.numerator * 8)
        bar.hits = sorted(hits_by_bar.get(bar_index, []), key=lambda hit: hit.slot_index)
        bars.append(bar)

    fill_regions = [
        FillRegion(
            bar_index=int(region["bar"]),
            slots=[int(slot) for slot in region["slots"]],
            intensity=str(region["intensity"]),
        )
        for region in payload.get("fill_regions", [])
    ]

    return DrumPattern(settings=settings, bars=bars, instruments=instruments, fill_regions=fill_regions)
