from __future__ import annotations

from pathlib import Path

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

from core.pattern import DrumPattern
from core.timing import TICKS_PER_BEAT, slot_to_ticks


def export_pattern_to_midi(pattern: DrumPattern, destination: str | Path, bpm_override: int | None = None) -> Path:
    export_bpm = pattern.settings.bpm if bpm_override is None else bpm_override
    midi = MidiFile(ticks_per_beat=TICKS_PER_BEAT)
    track = MidiTrack()
    midi.tracks.append(track)

    track.append(MetaMessage("set_tempo", tempo=bpm2tempo(export_bpm), time=0))
    track.append(
        MetaMessage(
            "time_signature",
            numerator=pattern.settings.numerator,
            denominator=pattern.settings.denominator,
            clocks_per_click=24,
            notated_32nd_notes_per_beat=8,
            time=0,
        )
    )

    events: list[tuple[int, Message]] = []
    for hit in pattern.iter_hits():
        absolute_slot = hit.bar_index * pattern.total_slots_per_bar + hit.slot_index
        start_tick = slot_to_ticks(absolute_slot, pattern.settings.swing) + hit.micro_timing_offset
        end_tick = start_tick + hit.length_ticks
        events.append((max(0, start_tick), Message("note_on", note=hit.midi_note, velocity=hit.velocity, channel=9)))
        events.append((max(0, end_tick), Message("note_off", note=hit.midi_note, velocity=0, channel=9)))

    events.sort(key=lambda item: (item[0], 0 if item[1].type == "note_off" else 1))
    last_tick = 0
    for tick, message in events:
        message.time = max(0, tick - last_tick)
        track.append(message)
        last_tick = tick

    destination = Path(destination)
    midi.save(destination)
    return destination
