from __future__ import annotations

import random
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)

from core.audio_playback import PatternPlaybackEngine
from core.generator import DrumPatternGenerator
from core.instruments import build_default_instruments
from core.midi_export import export_pattern_to_midi
from core.pattern import DrumPattern
from core.timing import parse_grouping, total_slots_per_bar
from gui.controls import GlobalControlsWidget, InstrumentsSidebar
from gui.grid_view import GridView


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Rule-Based Drum MIDI Generator")
        self.resize(1500, 860)

        self.generator = DrumPatternGenerator()
        self.current_pattern: DrumPattern | None = None
        self._ghost_reroll_count = 0
        self.playback = PatternPlaybackEngine(self)

        self.global_controls = GlobalControlsWidget()
        self.global_controls.preset_requested.connect(self.apply_preset)
        self.global_controls.generate_requested.connect(self.generate_pattern)
        self.global_controls.generate_ghosts_requested.connect(self.generate_ghosts)
        self.global_controls.export_requested.connect(self.export_midi)
        self.global_controls.clear_requested.connect(self.clear_pattern)
        self.global_controls.randomize_requested.connect(self.randomize_parameters)
        self.global_controls.play_requested.connect(self.play_pattern)
        self.global_controls.restart_requested.connect(self.restart_pattern)
        self.global_controls.stop_requested.connect(self.stop_pattern)
        self.global_controls.loop_toggled.connect(self.playback.set_loop_enabled)
        self.global_controls.edit_mode_toggled.connect(self._set_grid_edit_mode)

        self.sidebar = InstrumentsSidebar(build_default_instruments())
        self.grid = GridView()
        self.grid.base_hit_add_requested.connect(self._add_base_hit_from_grid)
        self.grid.base_hit_remove_requested.connect(self._remove_base_hit_from_grid)
        self.grid.base_hit_move_requested.connect(self._move_base_hit_from_grid)
        self.grid.ghost_hit_remove_requested.connect(self._remove_ghost_hit_from_grid)
        self.grid.ghost_hit_move_requested.connect(self._move_ghost_hit_from_grid)
        self.summary_label = QLabel("No pattern generated yet.")
        self.summary_label.setWordWrap(True)

        self.playback.state_changed.connect(self.global_controls.set_playback_state)
        self.playback.info_message.connect(self._show_playback_message)

        self._build_ui()
        self.grid.set_edit_mode(self.global_controls.edit_mode_enabled())

    def _build_ui(self) -> None:
        central = QWidget()
        root = QHBoxLayout(central)
        root.setContentsMargins(10, 10, 10, 10)
        root.setSpacing(12)

        self.global_controls.setMinimumWidth(320)
        self.global_controls.setMaximumWidth(380)

        global_column = QWidget()
        global_layout = QVBoxLayout(global_column)
        global_layout.setContentsMargins(0, 0, 0, 0)
        global_layout.addWidget(self.global_controls, 1)

        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.VLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)

        right_column = QWidget()
        right_layout = QVBoxLayout(right_column)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(10)

        self.sidebar.setMinimumHeight(280)
        self.sidebar.setMaximumHeight(360)

        instruments_label = QLabel("Instruments")
        instruments_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        right_layout.addWidget(instruments_label)
        right_layout.addWidget(self.sidebar, 0)

        grid_container = QWidget()
        grid_layout = QVBoxLayout(grid_container)
        grid_layout.setContentsMargins(0, 0, 0, 0)
        grid_layout.setSpacing(8)
        grid_layout.addWidget(self.summary_label)
        grid_layout.addWidget(self.grid, 1)
        right_layout.addWidget(grid_container, 1)

        root.addWidget(global_column, 0)
        root.addWidget(separator, 0)
        root.addWidget(right_column, 1)
        self.setCentralWidget(central)
        self.setStatusBar(QStatusBar())
        self.statusBar().showMessage("Ready")

    def generate_pattern(self) -> None:
        try:
            settings = self.global_controls.settings()
            parse_grouping(settings.grouping)
            instruments = self.sidebar.instrument_configs()
            self.current_pattern = self.generator.generate(settings, instruments)
            self._ghost_reroll_count = 0
        except ValueError as exc:
            QMessageBox.warning(self, "Invalid settings", str(exc))
            return
        self.grid.render_pattern(self.current_pattern)
        self.summary_label.setText(self._pattern_summary(self.current_pattern))
        if self.playback.is_playing:
            self.play_pattern()
        self.statusBar().showMessage("Pattern generated", 3000)

    def generate_ghosts(self) -> None:
        if self.current_pattern is None:
            self.statusBar().showMessage("Generate a pattern before generating ghosts.", 3000)
            return

        self.current_pattern.instruments = self.sidebar.instrument_configs()
        settings = self.global_controls.settings()
        seed = None if settings.seed is None else settings.seed + self._ghost_reroll_count + 1
        self.generator.regenerate_ghost_hits(self.current_pattern, seed=seed)
        self._ghost_reroll_count += 1

        self.grid.render_pattern(self.current_pattern)
        self.summary_label.setText(self._pattern_summary(self.current_pattern))
        if self.playback.is_playing:
            self.play_pattern()
        self.statusBar().showMessage("Ghost notes regenerated", 3000)

    def export_midi(self) -> None:
        if self.current_pattern is None:
            self.generate_pattern()
        if self.current_pattern is None:
            return
        ui_settings = self.global_controls.settings()
        default_name = (
            f"drum_pattern_{self.current_pattern.settings.numerator}"
            f"_{self.current_pattern.settings.denominator}_{self.current_pattern.settings.bars}bars.mid"
        )
        destination, _ = QFileDialog.getSaveFileName(
            self,
            "Export MIDI",
            str(Path.cwd() / default_name),
            "MIDI files (*.mid)",
        )
        if not destination:
            return
        export_pattern_to_midi(self.current_pattern, destination, bpm_override=ui_settings.bpm)
        self.statusBar().showMessage(f"MIDI exported to {destination} at {ui_settings.bpm} BPM", 4000)

    def clear_pattern(self) -> None:
        self.playback.stop()
        self.current_pattern = None
        self._ghost_reroll_count = 0
        self.grid.clear_pattern()
        self.summary_label.setText("No pattern generated yet.")
        self.statusBar().showMessage("Pattern cleared", 3000)

    def randomize_parameters(self) -> None:
        rng = random.Random()
        settings = self.global_controls.settings()
        settings.swing = round(rng.uniform(0.0, 0.28), 2)
        settings.bar_similarity = round(rng.uniform(0.0, 1.0), 2)
        settings.bars = int(rng.choice([1, 2, 4, 8]))
        settings.fill_every = int(rng.choice([1, 2, 4, 8]))
        settings.fill_length = rng.choice(["short", "medium", "long"])
        settings.fill_intensity = rng.choice(["off", "low", "medium", "high"])
        settings.seed = rng.randint(0, 999999)
        self.global_controls.set_settings(settings)

        randomized = self.sidebar.instrument_configs()
        for config in randomized.values():
            if config.key in {"hihat_closed", "ride"}:
                config.pulse_division = rng.choice(["quarter", "eighth", "sixteenth"])
                config.pulse_space = round(min(0.85, rng.betavariate(1.4, 3.2)), 2)
                config.timing_feel = rng.choice(["neutral", "push", "drag", "random"])
            elif config.key == "hihat_open":
                config.density = round(rng.uniform(0.05, 0.9), 2)
                config.syncopation_amount = 0.0
            elif config.key == "crash":
                config.density = round(rng.uniform(0.04, 0.5), 2)
                config.syncopation_amount = 0.0
            elif config.key in {"tom_high", "tom_mid", "tom_low"}:
                config.tom_hit_count = rng.randint(0, 3)
                config.enabled = config.tom_hit_count > 0
            else:
                config.density = round(rng.uniform(0.1, 0.95), 2)
                config.syncopation_amount = rng.randint(0, 5) / 5
                if config.key in {"kick", "snare"}:
                    config.timing_feel = rng.choice(["neutral", "push", "drag", "random"])
            if config.ghost_settings is not None:
                config.ghost_settings.density = round(rng.uniform(0.05, 0.45), 2)
                config.ghost_settings.velocity = rng.randint(22, 42)
                (
                    config.ghost_settings.velocity_min,
                    config.ghost_settings.velocity_max,
                ) = config.ghost_settings.velocity_bounds()
        self.sidebar.update_configs(randomized)
        self.statusBar().showMessage("Parameters randomized", 3000)

    def apply_preset(self, preset_name: str) -> None:
        from core.presets import load_preset

        settings, instruments = load_preset(preset_name)
        self.global_controls.set_settings(settings)
        self.sidebar.update_configs(instruments)
        self.statusBar().showMessage(f"Preset loaded: {preset_name}", 3000)

    def play_pattern(self) -> None:
        if self.current_pattern is None:
            self.generate_pattern()
        if self.current_pattern is None:
            return
        bpm = self.global_controls.settings().bpm
        if self.playback.play_pattern(
            self.current_pattern,
            loop_enabled=self.global_controls.playback_loop_enabled(),
            bpm_override=bpm,
        ):
            self.statusBar().showMessage(f"Playback started at {bpm} BPM", 3000)

    def restart_pattern(self) -> None:
        if self.current_pattern is None:
            self.generate_pattern()
        if self.current_pattern is None:
            return
        bpm = self.global_controls.settings().bpm
        if self.playback.restart(bpm_override=bpm):
            self.statusBar().showMessage(f"Playback restarted at {bpm} BPM", 3000)

    def stop_pattern(self) -> None:
        self.playback.stop()
        self.statusBar().showMessage("Playback stopped", 3000)

    def _pattern_summary(self, pattern: DrumPattern) -> str:
        hit_count = len(pattern.all_hits())
        slots_per_bar = total_slots_per_bar(pattern.settings.numerator)
        return (
            f"{pattern.settings.bars} bar(s), {pattern.settings.numerator}/{pattern.settings.denominator}, "
            f"{slots_per_bar} slot per bar, {hit_count} hits generated. "
            "Legend: main hits use a velocity color gradient; G = ghost."
        )

    def closeEvent(self, event) -> None:  # type: ignore[override]
        self.playback.stop()
        super().closeEvent(event)

    def _show_playback_message(self, message: str) -> None:
        self.statusBar().showMessage(message, 5000)

    def _set_grid_edit_mode(self, enabled: bool) -> None:
        self.grid.set_edit_mode(enabled)
        self.statusBar().showMessage("Grid edit enabled" if enabled else "Grid edit disabled", 2500)

    def _add_base_hit_from_grid(self, instrument_key: str, global_slot_index: int) -> None:
        if self.current_pattern is None:
            return
        self.current_pattern.instruments = self.sidebar.instrument_configs()
        settings = self.global_controls.settings()
        config = self.current_pattern.instruments[instrument_key]
        hit = self.current_pattern.add_manual_base_hit(
            instrument_key=instrument_key,
            global_slot_index=global_slot_index,
            config=config,
            humanize_timing=settings.humanize_timing,
            humanize_velocity_amount=settings.humanize_velocity,
        )
        if hit is None:
            return
        self._refresh_pattern_after_edit(f"Added {config.name} hit")

    def _remove_base_hit_from_grid(self, instrument_key: str, global_slot_index: int) -> None:
        if self.current_pattern is None:
            return
        if not self.current_pattern.remove_base_hit_at_cell(instrument_key, global_slot_index):
            return
        instrument_name = self.current_pattern.instruments[instrument_key].name
        self._refresh_pattern_after_edit(f"Removed {instrument_name} hit")

    def _move_base_hit_from_grid(self, instrument_key: str, from_global_slot_index: int, to_global_slot_index: int) -> None:
        if self.current_pattern is None:
            return
        if not self.current_pattern.move_base_hit(instrument_key, from_global_slot_index, to_global_slot_index):
            self.statusBar().showMessage("Move blocked: target cell already occupied.", 2500)
            return
        instrument_name = self.current_pattern.instruments[instrument_key].name
        self._refresh_pattern_after_edit(f"Moved {instrument_name} hit")

    def _remove_ghost_hit_from_grid(self, instrument_key: str, global_slot_index: int) -> None:
        if self.current_pattern is None:
            return
        if not self.current_pattern.remove_ghost_hit_at_cell(instrument_key, global_slot_index):
            return
        instrument_name = self.current_pattern.instruments[instrument_key].name
        self._refresh_pattern_after_edit(f"Removed {instrument_name} ghost")

    def _move_ghost_hit_from_grid(self, instrument_key: str, from_global_slot_index: int, to_global_slot_index: int) -> None:
        if self.current_pattern is None:
            return
        if not self.current_pattern.move_ghost_hit(instrument_key, from_global_slot_index, to_global_slot_index):
            self.statusBar().showMessage("Move blocked: target cell already occupied.", 2500)
            return
        instrument_name = self.current_pattern.instruments[instrument_key].name
        self._refresh_pattern_after_edit(f"Moved {instrument_name} ghost")

    def _refresh_pattern_after_edit(self, message: str) -> None:
        if self.current_pattern is None:
            return
        self.grid.render_pattern(self.current_pattern)
        self.summary_label.setText(self._pattern_summary(self.current_pattern))
        if self.playback.is_playing:
            self.play_pattern()
        self.statusBar().showMessage(message, 2500)


def run() -> None:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
