import unittest
from pathlib import Path

from mido import MidiFile, bpm2tempo

from core.instruments import build_default_instruments
from core.midi_export import export_pattern_to_midi
from core.pattern import DrumBar, DrumHit, DrumPattern, GlobalSettings


class MidiExportTests(unittest.TestCase):
    def test_export_uses_runtime_bpm_override_for_tempo_meta(self) -> None:
        settings = GlobalSettings(bpm=120, bars=1, grouping="4")
        instruments = build_default_instruments()
        pattern = DrumPattern(
            settings=settings,
            bars=[
                DrumBar(
                    index=0,
                    total_slots=32,
                    base_hits=[
                        DrumHit(
                            instrument="kick",
                            midi_note=36,
                            slot_index=0,
                            bar_index=0,
                            velocity=100,
                        )
                    ],
                )
            ],
            instruments=instruments,
        )

        destination = Path(__file__).resolve().parent / "_tempo_override_test.mid"
        try:
            export_pattern_to_midi(pattern, destination, bpm_override=90)
            midi = MidiFile(destination)
        finally:
            if destination.exists():
                destination.unlink()

        tempo_messages = [message for track in midi.tracks for message in track if message.type == "set_tempo"]
        self.assertEqual(len(tempo_messages), 1)
        self.assertEqual(tempo_messages[0].tempo, bpm2tempo(90))


if __name__ == "__main__":
    unittest.main()
