from __future__ import annotations

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
    QSizePolicy,
)

from core.presets import preset_names
from core.instruments import INSTRUMENT_ORDER
from core.pattern import GhostSettings, GlobalSettings, InstrumentConfig
from core.timing import parse_grouping


class GlobalControlsWidget(QGroupBox):
    preset_requested = Signal(str)
    generate_requested = Signal()
    generate_ghosts_requested = Signal()
    export_requested = Signal()
    clear_requested = Signal()
    randomize_requested = Signal()
    play_requested = Signal()
    restart_requested = Signal()
    stop_requested = Signal()
    loop_toggled = Signal(bool)
    edit_mode_toggled = Signal(bool)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("Global Controls", parent)
        self._grouping_flash_active = False
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 12, 10, 10)
        layout.setSpacing(12)

        preset_box = QGroupBox("Presets")
        preset_layout = QVBoxLayout(preset_box)
        preset_layout.setContentsMargins(10, 12, 10, 10)
        preset_layout.setSpacing(8)

        self.preset_combo = QComboBox()
        self.preset_combo.addItems(preset_names())
        self.apply_preset_button = QPushButton("Apply Preset")
        self.apply_preset_button.clicked.connect(lambda: self.preset_requested.emit(self.preset_combo.currentText()))

        preset_layout.addWidget(self.preset_combo)
        preset_layout.addWidget(self.apply_preset_button)

        params_box = QGroupBox()
        params_layout = QVBoxLayout(params_box)
        params_layout.setContentsMargins(10, 12, 10, 10)
        params_layout.setSpacing(8)
        form = QFormLayout()
        form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)
        form.setContentsMargins(0, 0, 0, 0)
        form.setSpacing(8)

        self.bpm = QSpinBox()
        self.bpm.setRange(40, 240)
        self.bpm.setValue(110)

        self.bars = QComboBox()
        self.bars.addItems(["1", "2", "4", "8"])
        self.bars.setCurrentText("1")

        self.grouping = QLineEdit("2+2")
        self.swing = self._double_spin(0.0, 0.0, 0.65, 0.01)
        self.humanize_timing = QSpinBox()
        self.humanize_timing.setRange(0, 24)
        self.humanize_timing.setValue(6)

        self.humanize_velocity = QSpinBox()
        self.humanize_velocity.setRange(0, 24)
        self.humanize_velocity.setValue(6)

        self.bar_similarity = self._double_spin(0.7, 0.0, 1.0, 0.01)
        self.fill_every = QComboBox()
        self.fill_every.addItems(["1", "2", "4", "8"])
        self.fill_every.setCurrentText("2")

        self.fill_length = QComboBox()
        self.fill_length.addItems(["short", "medium", "long"])
        self.fill_length.setCurrentText("medium")

        self.fill_intensity = QComboBox()
        self.fill_intensity.addItems(["off", "low", "medium", "high"])
        self.fill_intensity.setCurrentText("off")
        self.seed = QSpinBox()
        self.seed.setRange(-1, 999999)
        self.seed.setSpecialValueText("Random")
        self.seed.setValue(-1)

        self.time_signature_display = QLabel()
        self.time_signature_display.setAlignment(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft)
        self.grouping_help = QLabel("Use '+' to build the bar, for example: 4, 3+2, 3+2+2")
        self.grouping_help.setWordWrap(True)
        self.grouping_help.setStyleSheet("color: #a0a0a0; font-size: 11px;")
        self.grouping.textChanged.connect(self._update_time_signature_summary)
        self._update_time_signature_summary(self.grouping.text())

        fields = [
            ("BPM", self.bpm),
            ("Pattern Length", self.bars),
            ("Beat Grouping", self.grouping),
            ("", self.grouping_help),
            ("Time Signature", self.time_signature_display),
            ("Swing", self.swing),
            ("Humanize Timing", self.humanize_timing),
            ("Humanize Velocity", self.humanize_velocity),
            ("Bar Similarity", self.bar_similarity),
            ("Fill Every", self.fill_every),
            ("Fill Length", self.fill_length),
            ("Fill Intensity", self.fill_intensity),
            ("Seed", self.seed),
        ]
        for label, widget in fields:
            form.addRow(label, widget)

        params_layout.addLayout(form)

        actions_box = QGroupBox("Playback & Actions")
        actions_layout = QVBoxLayout(actions_box)
        actions_layout.setContentsMargins(10, 12, 10, 10)
        actions_layout.setSpacing(10)

        buttons = QGridLayout()
        buttons.setContentsMargins(0, 0, 0, 0)
        buttons.setHorizontalSpacing(8)
        buttons.setVerticalSpacing(8)
        generate = QPushButton("Generate Pattern")
        generate_ghosts = QPushButton("Generate Ghosts")
        export = QPushButton("Export MIDI")
        clear = QPushButton("Clear")
        randomize = QPushButton("Randomize")
        play = QPushButton("Play")
        stop = QPushButton("Stop")
        restart = QPushButton("Restart")
        self.loop_enabled = QCheckBox("Loop")
        self.loop_enabled.setChecked(True)
        self.edit_grid_enabled = QCheckBox("Edit Grid")
        self.edit_grid_enabled.setChecked(False)
        self.playback_status = QLabel("Stopped")
        self.playback_status.setAlignment(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight)
        generate.clicked.connect(self.generate_requested)
        generate_ghosts.clicked.connect(self.generate_ghosts_requested)
        export.clicked.connect(self.export_requested)
        clear.clicked.connect(self.clear_requested)
        randomize.clicked.connect(self.randomize_requested)
        play.clicked.connect(self.play_requested)
        restart.clicked.connect(self.restart_requested)
        stop.clicked.connect(self.stop_requested)
        self.loop_enabled.toggled.connect(self.loop_toggled)
        self.edit_grid_enabled.toggled.connect(self.edit_mode_toggled)
        buttons.addWidget(generate, 0, 0)
        buttons.addWidget(generate_ghosts, 0, 1)
        buttons.addWidget(export, 1, 0)
        buttons.addWidget(clear, 1, 1)
        buttons.addWidget(randomize, 2, 0)
        buttons.addWidget(play, 2, 1)
        buttons.addWidget(restart, 3, 0)
        buttons.addWidget(stop, 3, 1)
        buttons.addWidget(self.loop_enabled, 4, 0, 1, 2)
        buttons.addWidget(self.edit_grid_enabled, 5, 0, 1, 2)

        playback_row = QHBoxLayout()
        playback_row.setContentsMargins(0, 0, 0, 0)
        playback_row.addWidget(QLabel("Playback"))
        playback_row.addStretch(1)
        playback_row.addWidget(self.playback_status)

        actions_layout.addLayout(buttons)
        actions_layout.addLayout(playback_row)

        layout.addWidget(preset_box, 0)
        layout.addWidget(params_box, 1)
        layout.addWidget(actions_box, 0)

    def _double_spin(self, value: float, minimum: float, maximum: float, step: float) -> QDoubleSpinBox:
        box = QDoubleSpinBox()
        box.setRange(minimum, maximum)
        box.setSingleStep(step)
        box.setDecimals(2)
        box.setValue(value)
        return box

    def settings(self) -> GlobalSettings:
        return GlobalSettings(
            bpm=self.bpm.value(),
            denominator=4,
            bars=int(self.bars.currentText()),
            grouping=self.grouping.text().strip(),
            swing=self.swing.value(),
            humanize_timing=self.humanize_timing.value(),
            humanize_velocity=self.humanize_velocity.value(),
            bar_similarity=self.bar_similarity.value(),
            fill_every=int(self.fill_every.currentText()),
            fill_length=self.fill_length.currentText(),
            fill_intensity=self.fill_intensity.currentText(),
            seed=None if self.seed.value() < 0 else self.seed.value(),
        )

    def set_settings(self, settings: GlobalSettings) -> None:
        previous_grouping = self.grouping.text().strip()
        self.bpm.setValue(settings.bpm)
        self.bars.setCurrentText(str(settings.bars))
        self.grouping.setText(settings.grouping)
        self.swing.setValue(settings.swing)
        self.humanize_timing.setValue(settings.humanize_timing)
        self.humanize_velocity.setValue(settings.humanize_velocity)
        self.bar_similarity.setValue(settings.bar_similarity)
        self.fill_every.setCurrentText(str(settings.fill_every))
        self.fill_length.setCurrentText(settings.fill_length)
        self.fill_intensity.setCurrentText(settings.fill_intensity)
        self.seed.setValue(-1 if settings.seed is None else settings.seed)
        self._update_time_signature_summary(settings.grouping)
        if previous_grouping and previous_grouping != settings.grouping:
            self._flash_grouping_field()

    def playback_loop_enabled(self) -> bool:
        return self.loop_enabled.isChecked()

    def set_playback_state(self, state_text: str) -> None:
        self.playback_status.setText(state_text)

    def edit_mode_enabled(self) -> bool:
        return self.edit_grid_enabled.isChecked()

    def _update_time_signature_summary(self, grouping_text: str) -> None:
        try:
            numerator = sum(parse_grouping(grouping_text.strip()))
        except ValueError:
            self.time_signature_display.setText("Invalid grouping")
            return
        self.time_signature_display.setText(f"{numerator}/4")

    def _flash_grouping_field(self) -> None:
        if self._grouping_flash_active:
            return
        self._grouping_flash_active = True
        default_style = self.grouping.styleSheet()
        self.grouping.setStyleSheet(
            "QLineEdit {"
            "background-color: #fff3bf;"
            "border: 1px solid #d4a017;"
            "border-radius: 4px;"
            "}"
        )

        def restore() -> None:
            self.grouping.setStyleSheet(default_style)
            self._grouping_flash_active = False

        QTimer.singleShot(1400, restore)


class InstrumentPanel(QGroupBox):
    def __init__(self, config: InstrumentConfig, parent: QWidget | None = None) -> None:
        super().__init__(config.name, parent)
        self.config = config
        self._build_ui()
        self.set_config(config)

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.setMinimumWidth(210)
        self.setMaximumWidth(260)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
        is_tom = self.config.key in {"tom_high", "tom_mid", "tom_low"}
        is_pulse_layer = self.config.key in {"hihat_closed", "ride"}
        is_open_hat = self.config.key == "hihat_open"
        is_crash = self.config.key == "crash"
        has_timing_feel = self.config.key in {"kick", "snare", "hihat_closed", "ride"}
        uses_syncopation = not is_pulse_layer and not is_tom and not is_open_hat and not is_crash

        self.enabled = None if is_tom else QCheckBox("Enabled")
        self.tom_hit_count = self._spin(0, 3) if is_tom else None
        self.density = self._double_spin(0.0, 1.0, 0.01) if not is_pulse_layer and not is_tom else None
        self.density_label = self._density_label()
        self.syncopation = QSpinBox() if uses_syncopation else None
        self.syncopation_label = QLabel() if uses_syncopation else None
        if self.syncopation is not None and self.syncopation_label is not None:
            self.syncopation.setRange(0, 5)
            self.syncopation_label.setAlignment(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft)
            self.syncopation_label.setFixedWidth(52)
            self.syncopation.valueChanged.connect(self._update_syncopation_label)
            syncopation_row = QWidget()
            syncopation_layout = QHBoxLayout(syncopation_row)
            syncopation_layout.setContentsMargins(0, 0, 0, 0)
            syncopation_layout.setSpacing(8)
            syncopation_layout.addWidget(self.syncopation)
            syncopation_layout.addWidget(self.syncopation_label)
            syncopation_layout.addStretch(1)
        else:
            syncopation_row = None
        self.division = QComboBox() if is_pulse_layer else None
        if self.division is not None:
            self.division.addItems(["Quarter", "Eighth", "Sixteenth"])
        self.space = self._double_spin(0.0, 1.0, 0.01) if is_pulse_layer else None
        self.timing_feel = QComboBox() if has_timing_feel else None
        if self.timing_feel is not None:
            self.timing_feel.addItems(["Neutral", "Push", "Drag", "Random"])
        self.velocity_min = self._spin(1, 127)
        self.velocity_max = self._spin(1, 127)

        if self.enabled is not None:
            form.addRow(self.enabled)
        if self.tom_hit_count is not None:
            form.addRow("Hits", self.tom_hit_count)
        if self.division is not None:
            form.addRow("Division", self.division)
        if self.space is not None:
            form.addRow("Space", self.space)
        if self.density is not None:
            form.addRow(self.density_label, self.density)
        if syncopation_row is not None:
            form.addRow("Syncopation", syncopation_row)
        if self.timing_feel is not None:
            form.addRow("Timing Feel", self.timing_feel)
        form.addRow("Velocity Min", self.velocity_min)
        form.addRow("Velocity Max", self.velocity_max)
        layout.addLayout(form)

        if self.config.ghost_settings is not None:
            ghost_box = QGroupBox("Ghost Notes")
            ghost_form = QFormLayout(ghost_box)
            self.ghost_enabled = QCheckBox("Enabled")
            self.ghost_density = self._double_spin(0.0, 1.0, 0.01)
            self.ghost_velocity = self._spin(1, 127)
            self.ghost_placement = QComboBox()
            self.ghost_placement.addItems(["before", "after", "both"])
            ghost_form.addRow(self.ghost_enabled)
            ghost_form.addRow("Density", self.ghost_density)
            ghost_form.addRow("Velocity", self.ghost_velocity)
            ghost_form.addRow("Placement", self.ghost_placement)
            layout.addWidget(ghost_box)
        else:
            self.ghost_enabled = None
            self.ghost_density = None
            self.ghost_velocity = None
            self.ghost_placement = None

    def _spin(self, minimum: int, maximum: int) -> QSpinBox:
        box = QSpinBox()
        box.setRange(minimum, maximum)
        return box

    def _double_spin(self, minimum: float, maximum: float, step: float) -> QDoubleSpinBox:
        box = QDoubleSpinBox()
        box.setRange(minimum, maximum)
        box.setSingleStep(step)
        box.setDecimals(2)
        return box

    def _density_label(self) -> str:
        return "Density"

    def set_config(self, config: InstrumentConfig) -> None:
        if self.enabled is not None:
            self.enabled.setChecked(config.enabled)
        if self.tom_hit_count is not None:
            self.tom_hit_count.setValue(max(0, min(3, config.tom_hit_count)))
        if self.division is not None:
            self.division.setCurrentText(_division_label(config.pulse_division))
        if self.space is not None:
            self.space.setValue(max(0.0, min(1.0, config.pulse_space)))
        if self.density is not None:
            self.density.setValue(config.density)
        if self.syncopation is not None:
            self.syncopation.setValue(_syncopation_level_from_amount(config.syncopation_amount))
        if self.timing_feel is not None:
            self.timing_feel.setCurrentText(_timing_feel_label(config.timing_feel))
        self.velocity_min.setValue(config.velocity_min)
        self.velocity_max.setValue(config.velocity_max)
        if config.ghost_settings is not None and self.ghost_enabled is not None:
            ghost = config.ghost_settings
            self.ghost_enabled.setChecked(ghost.enabled)
            self.ghost_density.setValue(ghost.density)
            self.ghost_velocity.setValue(ghost.velocity)
            self.ghost_placement.setCurrentText(ghost.placement)

    def config_from_ui(self) -> InstrumentConfig:
        ghost_settings = None
        if self.config.ghost_settings is not None and self.ghost_enabled is not None:
            base_ghost = self.config.ghost_settings
            ghost_settings = GhostSettings(
                enabled=self.ghost_enabled.isChecked(),
                density=self.ghost_density.value(),
                velocity=self.ghost_velocity.value(),
                placement=self.ghost_placement.currentText(),
                probability=base_ghost.probability,
                velocity_min=base_ghost.velocity_min,
                velocity_max=base_ghost.velocity_max,
                timing_offset_amount=base_ghost.timing_offset_amount,
                allowed_slots=base_ghost.allowed_slots,
                max_distance_from_anchor=base_ghost.max_distance_from_anchor,
            )
            ghost_settings.velocity_min, ghost_settings.velocity_max = ghost_settings.velocity_bounds()
        return InstrumentConfig(
            key=self.config.key,
            name=self.config.name,
            midi_note=self.config.midi_note,
            enabled=self.tom_hit_count.value() > 0 if self.tom_hit_count is not None else self.enabled.isChecked(),
            tom_hit_count=0 if self.tom_hit_count is None else self.tom_hit_count.value(),
            density=0.0 if self.tom_hit_count is not None else self.config.density if self.density is None else self.density.value(),
            pulse_division=self.config.pulse_division if self.division is None else _division_value(self.division.currentText()),
            pulse_space=self.config.pulse_space if self.space is None else self.space.value(),
            velocity_min=self.velocity_min.value(),
            velocity_max=self.velocity_max.value(),
            allowed_slots=self.config.allowed_slots,
            forbidden_slots=self.config.forbidden_slots,
            syncopation_amount=0.0 if self.tom_hit_count is not None else self.config.syncopation_amount if self.syncopation is None else _syncopation_amount_from_level(self.syncopation.value()),
            timing_feel=self.config.timing_feel if self.timing_feel is None else _timing_feel_value(self.timing_feel.currentText()),
            repetition_vs_variation=self.config.repetition_vs_variation,
            ghost_settings=ghost_settings,
        )

    def _update_syncopation_label(self, level: int) -> None:
        if self.syncopation_label is not None:
            self.syncopation_label.setText(_syncopation_label(level))


class TomsPanel(QGroupBox):
    TOM_KEYS = ("tom_high", "tom_mid", "tom_low")

    def __init__(self, configs: dict[str, InstrumentConfig], parent: QWidget | None = None) -> None:
        super().__init__("Toms", parent)
        self._configs = {key: configs[key] for key in self.TOM_KEYS}
        self._build_ui()
        self.set_configs(configs)

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.setMinimumWidth(240)
        self.setMaximumWidth(280)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)

        self.high_hits = self._spin(0, 3)
        self.mid_hits = self._spin(0, 3)
        self.low_hits = self._spin(0, 3)
        self.velocity_min = self._spin(1, 127)
        self.velocity_max = self._spin(1, 127)

        form.addRow("High Hits", self.high_hits)
        form.addRow("Mid Hits", self.mid_hits)
        form.addRow("Low Hits", self.low_hits)
        form.addRow("Velocity Min", self.velocity_min)
        form.addRow("Velocity Max", self.velocity_max)
        layout.addLayout(form)

    def _spin(self, minimum: int, maximum: int) -> QSpinBox:
        box = QSpinBox()
        box.setRange(minimum, maximum)
        return box

    def set_configs(self, configs: dict[str, InstrumentConfig]) -> None:
        self._configs = {key: configs[key] for key in self.TOM_KEYS}
        self.high_hits.setValue(max(0, min(3, configs["tom_high"].tom_hit_count)))
        self.mid_hits.setValue(max(0, min(3, configs["tom_mid"].tom_hit_count)))
        self.low_hits.setValue(max(0, min(3, configs["tom_low"].tom_hit_count)))
        self.velocity_min.setValue(configs["tom_high"].velocity_min)
        self.velocity_max.setValue(configs["tom_high"].velocity_max)

    def config_from_ui(self) -> dict[str, InstrumentConfig]:
        hit_counts = {
            "tom_high": self.high_hits.value(),
            "tom_mid": self.mid_hits.value(),
            "tom_low": self.low_hits.value(),
        }
        configs: dict[str, InstrumentConfig] = {}
        for key in self.TOM_KEYS:
            base = self._configs[key]
            configs[key] = InstrumentConfig(
                key=base.key,
                name=base.name,
                midi_note=base.midi_note,
                enabled=hit_counts[key] > 0,
                tom_hit_count=hit_counts[key],
                density=0.0,
                pulse_division=base.pulse_division,
                pulse_space=base.pulse_space,
                velocity_min=self.velocity_min.value(),
                velocity_max=self.velocity_max.value(),
                allowed_slots=base.allowed_slots,
                forbidden_slots=base.forbidden_slots,
                syncopation_amount=0.0,
                timing_feel=base.timing_feel,
                repetition_vs_variation=base.repetition_vs_variation,
                ghost_settings=base.ghost_settings,
            )
        return configs


class InstrumentsSidebar(QScrollArea):
    def __init__(self, instruments: dict[str, InstrumentConfig], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWidgetResizable(False)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._container = QWidget()
        self._layout = QHBoxLayout(self._container)
        self._layout.setContentsMargins(6, 6, 6, 6)
        self._layout.setSpacing(10)
        self._layout.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        self._container.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Preferred)
        self.panels: dict[str, InstrumentPanel] = {}
        self.toms_panel: TomsPanel | None = None
        self.setWidget(self._container)
        self.set_instruments(instruments)

    def set_instruments(self, instruments: dict[str, InstrumentConfig]) -> None:
        for panel in self.panels.values():
            panel.deleteLater()
        if self.toms_panel is not None:
            self.toms_panel.deleteLater()
        self.panels.clear()
        self.toms_panel = None
        for key in INSTRUMENT_ORDER:
            if key in TomsPanel.TOM_KEYS:
                if key == "tom_high":
                    self.toms_panel = TomsPanel(instruments)
                    self._layout.addWidget(self.toms_panel)
                continue
            panel = InstrumentPanel(instruments[key])
            self._layout.addWidget(panel)
            self.panels[key] = panel
        self._layout.addStretch(1)
        self._container.adjustSize()

    def instrument_configs(self) -> dict[str, InstrumentConfig]:
        configs = {key: panel.config_from_ui() for key, panel in self.panels.items()}
        if self.toms_panel is not None:
            configs.update(self.toms_panel.config_from_ui())
        return configs

    def update_configs(self, instruments: dict[str, InstrumentConfig]) -> None:
        for key, config in instruments.items():
            if key in self.panels:
                self.panels[key].config = config
                self.panels[key].setTitle(config.name)
                self.panels[key].set_config(config)
        if self.toms_panel is not None:
            self.toms_panel.set_configs(instruments)


def _syncopation_level_from_amount(syncopation_amount: float) -> int:
    return max(0, min(5, int(round(syncopation_amount * 5))))


def _syncopation_amount_from_level(level: int) -> float:
    return max(0.0, min(1.0, level / 5))


def _syncopation_label(level: int) -> str:
    labels = {
        0: "0 Structure",
        1: "1 Light",
        2: "2 Medium",
        3: "3 Active",
        4: "4 Loose",
        5: "5 Free",
    }
    return labels[max(0, min(5, level))]


def _division_label(division: str) -> str:
    mapping = {
        "quarter": "Quarter",
        "eighth": "Eighth",
        "sixteenth": "Sixteenth",
    }
    return mapping.get(division, "Eighth")


def _division_value(label: str) -> str:
    mapping = {
        "Quarter": "quarter",
        "Eighth": "eighth",
        "Sixteenth": "sixteenth",
    }
    return mapping[label]


def _timing_feel_label(feel: str) -> str:
    mapping = {
        "neutral": "Neutral",
        "push": "Push",
        "drag": "Drag",
        "random": "Random",
    }
    return mapping.get(feel, "Neutral")


def _timing_feel_value(label: str) -> str:
    mapping = {
        "Neutral": "neutral",
        "Push": "push",
        "Drag": "drag",
        "Random": "random",
    }
    return mapping[label]
