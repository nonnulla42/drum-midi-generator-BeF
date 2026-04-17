from __future__ import annotations

from PySide6.QtCore import QPoint, QRect, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import (
    QHeaderView,
    QStyledItemDelegate,
    QStyle,
    QStyleOptionViewItem,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from core.instruments import INSTRUMENT_ORDER
from core.pattern import HIT_ACCENT, HIT_GHOST, HIT_MAIN, DrumPattern
from core.timing import ticks_to_milliseconds


ROLE_HIT_LABEL = Qt.ItemDataRole.UserRole + 1
ROLE_OFFSET_TEXT = Qt.ItemDataRole.UserRole + 2
ROLE_FILL_COLOR = Qt.ItemDataRole.UserRole + 3
ROLE_BG_COLOR = Qt.ItemDataRole.UserRole + 4
ROLE_COLUMN_KIND = Qt.ItemDataRole.UserRole + 5
ROLE_DRAG_STATE = Qt.ItemDataRole.UserRole + 6

COLUMN_NORMAL = "normal"
COLUMN_MID = "mid"
COLUMN_BEAT = "beat"
DRAG_NONE = "none"
DRAG_SOURCE = "source"
DRAG_TARGET_VALID = "target_valid"
DRAG_TARGET_BLOCKED = "target_blocked"

DEFAULT_COLUMN_WIDTH = 28
MID_COLUMN_WIDTH = 30
BEAT_COLUMN_WIDTH = 36

HIT_STYLES = {
    HIT_MAIN: ("", None),
    HIT_ACCENT: ("", None),
    HIT_GHOST: ("G", QColor("#cbd5e1")),
}

COLUMN_BACKGROUNDS = {
    COLUMN_NORMAL: QColor("#0f172a"),
    COLUMN_MID: QColor("#131d30"),
    COLUMN_BEAT: QColor("#18263d"),
}


class GridItemDelegate(QStyledItemDelegate):
    def paint(
        self,
        painter: QPainter,
        option: QStyleOptionViewItem,
        index,
    ) -> None:
        bg_color = index.data(ROLE_BG_COLOR)
        fill_color = index.data(ROLE_FILL_COLOR)
        label = index.data(ROLE_HIT_LABEL) or ""
        offset_text = index.data(ROLE_OFFSET_TEXT) or ""
        column_kind = index.data(ROLE_COLUMN_KIND) or COLUMN_NORMAL
        drag_state = index.data(ROLE_DRAG_STATE) or DRAG_NONE

        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)

        if option.state & QStyle.StateFlag.State_Selected:
            painter.fillRect(option.rect, option.palette.highlight())
        else:
            painter.fillRect(option.rect, bg_color if isinstance(bg_color, QColor) else QColor("#0f172a"))

        if isinstance(fill_color, QColor):
            inset = 2 if column_kind == COLUMN_BEAT else 3
            inner_rect = option.rect.adjusted(inset, 2, -inset, -2)
            painter.fillRect(inner_rect, fill_color)

        self._paint_column_guides(painter, option.rect, column_kind)
        self._paint_drag_state(painter, option.rect, drag_state)

        if label or offset_text:
            self._paint_hit_text(painter, option.rect, label, offset_text)

        painter.restore()

    def _paint_column_guides(self, painter: QPainter, rect: QRect, column_kind: str) -> None:
        if column_kind == COLUMN_BEAT:
            pen = QPen(QColor("#5b7aa5"))
            pen.setWidth(1)
            painter.setPen(pen)
            painter.drawLine(rect.topLeft(), rect.bottomLeft())
            painter.drawLine(rect.topRight(), rect.bottomRight())
        elif column_kind == COLUMN_MID:
            pen = QPen(QColor("#243449"))
            pen.setWidth(1)
            painter.setPen(pen)
            painter.drawLine(rect.topLeft(), rect.bottomLeft())

    def _paint_hit_text(self, painter: QPainter, rect: QRect, label: str, offset_text: str) -> None:
        main_font = QFont(painter.font())
        main_font.setBold(True)
        main_font.setPointSize(max(8, main_font.pointSize() + 1))

        offset_font = QFont(main_font)
        offset_font.setBold(False)
        offset_font.setPointSize(max(6, main_font.pointSize() - 3))

        if label:
            label_rect = rect.adjusted(1, 1, -1, -rect.height() // 3)
            offset_rect = rect.adjusted(1, rect.height() // 2 - 1, -1, -1)
            painter.setPen(QColor("#f8fafc"))
            painter.setFont(main_font)
            painter.drawText(label_rect, Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter, label)
        else:
            offset_rect = rect.adjusted(1, rect.height() // 2 - 4, -1, -2)

        if offset_text:
            painter.setPen(QColor("#e2e8f0"))
            painter.setFont(offset_font)
            painter.drawText(
                offset_rect,
                Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop,
                offset_text,
            )

    def _paint_drag_state(self, painter: QPainter, rect: QRect, drag_state: str) -> None:
        if drag_state == DRAG_NONE:
            return
        if drag_state == DRAG_SOURCE:
            painter.fillRect(rect.adjusted(1, 1, -1, -1), QColor(255, 255, 255, 42))
            pen = QPen(QColor("#f8fafc"))
            pen.setWidth(3)
        elif drag_state == DRAG_TARGET_VALID:
            painter.fillRect(rect.adjusted(1, 1, -1, -1), QColor(52, 211, 153, 36))
            pen = QPen(QColor("#34d399"))
            pen.setWidth(2)
        else:
            painter.fillRect(rect.adjusted(1, 1, -1, -1), QColor(248, 113, 113, 36))
            pen = QPen(QColor("#f87171"))
            pen.setWidth(2)
        painter.setPen(pen)
        painter.drawRect(rect.adjusted(1, 1, -2, -2))


class GridView(QTableWidget):
    base_hit_add_requested = Signal(str, int)
    base_hit_remove_requested = Signal(str, int)
    base_hit_move_requested = Signal(str, int, int)
    ghost_hit_remove_requested = Signal(str, int)
    ghost_hit_move_requested = Signal(str, int, int)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._delegate = GridItemDelegate(self)
        self._pattern: DrumPattern | None = None
        self._edit_mode_enabled = False
        self._press_pos: QPoint | None = None
        self._press_cell: tuple[str, int] | None = None
        self._drag_origin: tuple[str, int] | None = None
        self._drag_target: tuple[str, int, str] | None = None
        self._drag_started = False
        self.setItemDelegate(self._delegate)
        self.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.setAlternatingRowColors(False)
        self.verticalHeader().setVisible(True)
        self.verticalHeader().setDefaultSectionSize(34)
        self.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        self.horizontalHeader().setDefaultSectionSize(DEFAULT_COLUMN_WIDTH)
        self.horizontalHeader().setMinimumSectionSize(DEFAULT_COLUMN_WIDTH)
        self.horizontalHeader().setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setShowGrid(True)
        self.setWordWrap(True)
        self.setMouseTracking(True)

    def clear_pattern(self) -> None:
        self._pattern = None
        self._press_pos = None
        self._press_cell = None
        self._drag_origin = None
        self._drag_target = None
        self._drag_started = False
        self.clear()
        self.setRowCount(0)
        self.setColumnCount(0)

    def render_pattern(self, pattern: DrumPattern) -> None:
        self._pattern = pattern
        total_columns = pattern.total_slots
        self.clear()
        self.setRowCount(len(INSTRUMENT_ORDER))
        self.setColumnCount(total_columns)
        self.setVerticalHeaderLabels([pattern.instruments[key].name for key in INSTRUMENT_ORDER])
        self.setHorizontalHeaderLabels([str(index + 1) for index in range(total_columns)])

        for column in range(total_columns):
            self._configure_column(pattern, column)

        for row, instrument_key in enumerate(INSTRUMENT_ORDER):
            for column in range(total_columns):
                item = QTableWidgetItem("")
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                hits = pattern.hits_for_cell(instrument_key, column)
                self._configure_cell(item, pattern, instrument_key, column, hits)
                self.setItem(row, column, item)

    def set_edit_mode(self, enabled: bool) -> None:
        self._edit_mode_enabled = enabled
        self.setCursor(Qt.CursorShape.CrossCursor if enabled else Qt.CursorShape.ArrowCursor)

    def mousePressEvent(self, event) -> None:  # type: ignore[override]
        if not self._edit_mode_enabled or event.button() != Qt.MouseButton.LeftButton or self._pattern is None:
            super().mousePressEvent(event)
            return

        index = self.indexAt(event.pos())
        if not index.isValid():
            super().mousePressEvent(event)
            return

        instrument_key = INSTRUMENT_ORDER[index.row()]
        global_slot = index.column()
        base_hit = self._pattern.visible_base_hit_for_cell(instrument_key, global_slot)
        ghost_hit = None if base_hit is not None else self._pattern.hit_for_cell(instrument_key, global_slot, hit_type=HIT_GHOST)
        self._press_pos = event.pos()
        self._press_cell = (instrument_key, global_slot)
        self._drag_started = False
        self._drag_origin = (instrument_key, global_slot) if base_hit is not None or ghost_hit is not None else None
        self._drag_target = None
        event.accept()

    def mouseMoveEvent(self, event) -> None:  # type: ignore[override]
        if not self._edit_mode_enabled or self._pattern is None or self._press_pos is None or self._drag_origin is None:
            super().mouseMoveEvent(event)
            return

        if not self._drag_started and (event.pos() - self._press_pos).manhattanLength() >= 6:
            index = self.indexAt(event.pos())
            if index.isValid():
                instrument_key = INSTRUMENT_ORDER[index.row()]
                global_slot = index.column()
                origin_instrument, origin_slot = self._drag_origin
                if instrument_key == origin_instrument and global_slot != origin_slot:
                    self._drag_started = True
                    self.setCursor(Qt.CursorShape.ClosedHandCursor)
        if self._drag_started:
            self._update_drag_target(event.pos())
        event.accept()

    def mouseReleaseEvent(self, event) -> None:  # type: ignore[override]
        if not self._edit_mode_enabled or event.button() != Qt.MouseButton.LeftButton or self._pattern is None:
            super().mouseReleaseEvent(event)
            return

        index = self.indexAt(event.pos())
        if not index.isValid():
            self._reset_pointer_state()
            super().mouseReleaseEvent(event)
            return

        instrument_key = INSTRUMENT_ORDER[index.row()]
        global_slot = index.column()
        target_base_hit = self._pattern.visible_base_hit_for_cell(instrument_key, global_slot)
        target_ghost_hit = None if target_base_hit is not None else self._pattern.hit_for_cell(instrument_key, global_slot, hit_type=HIT_GHOST)

        if self._drag_started and self._drag_origin is not None:
            origin_instrument, origin_slot = self._drag_origin
            if instrument_key == origin_instrument and global_slot != origin_slot:
                origin_base_hit = self._pattern.visible_base_hit_for_cell(origin_instrument, origin_slot)
                if origin_base_hit is not None:
                    self.base_hit_move_requested.emit(origin_instrument, origin_slot, global_slot)
                elif self._pattern.hit_for_cell(origin_instrument, origin_slot, hit_type=HIT_GHOST) is not None:
                    self.ghost_hit_move_requested.emit(origin_instrument, origin_slot, global_slot)
        elif self._press_cell is not None:
            pressed_instrument, pressed_slot = self._press_cell
            pressed_base_hit = self._pattern.visible_base_hit_for_cell(pressed_instrument, pressed_slot)
            if pressed_base_hit is not None:
                self.base_hit_remove_requested.emit(pressed_instrument, pressed_slot)
            elif self._pattern.hit_for_cell(pressed_instrument, pressed_slot, hit_type=HIT_GHOST) is not None:
                self.ghost_hit_remove_requested.emit(pressed_instrument, pressed_slot)
            elif (
                pressed_instrument == instrument_key
                and pressed_slot == global_slot
                and target_base_hit is None
                and target_ghost_hit is None
                and not self._pattern.hits_for_cell(pressed_instrument, pressed_slot)
            ):
                self.base_hit_add_requested.emit(pressed_instrument, pressed_slot)

        self._reset_pointer_state()
        event.accept()

    def _reset_pointer_state(self) -> None:
        self._press_pos = None
        self._press_cell = None
        self._drag_origin = None
        self._drag_target = None
        self._drag_started = False
        if self._edit_mode_enabled:
            self.setCursor(Qt.CursorShape.CrossCursor)
        else:
            self.setCursor(Qt.CursorShape.ArrowCursor)
        self.viewport().update()

    def _configure_column(self, pattern: DrumPattern, column: int) -> None:
        column_kind = _column_kind(column, pattern.total_slots_per_bar)
        if column_kind == COLUMN_BEAT:
            width = BEAT_COLUMN_WIDTH
            header_bg = QColor("#243b5a")
        elif column_kind == COLUMN_MID:
            width = MID_COLUMN_WIDTH
            header_bg = QColor("#18263d")
        else:
            width = DEFAULT_COLUMN_WIDTH
            header_bg = QColor("#111827")

        self.setColumnWidth(column, width)
        header_item = self.horizontalHeaderItem(column)
        if header_item is not None:
            header_item.setBackground(header_bg)
            header_item.setForeground(QColor("#e5e7eb"))
            header_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

    def _configure_cell(
        self,
        item: QTableWidgetItem,
        pattern: DrumPattern,
        instrument_key: str,
        column: int,
        hits: list,
    ) -> None:
        column_kind = _column_kind(column, pattern.total_slots_per_bar)
        item.setData(ROLE_COLUMN_KIND, column_kind)
        item.setData(ROLE_BG_COLOR, COLUMN_BACKGROUNDS[column_kind])
        item.setData(ROLE_DRAG_STATE, self._drag_state_for_cell(instrument_key, column, hits))

        if not hits:
            return

        hit = sorted(hits, key=lambda candidate: _hit_priority(candidate.hit_type))[0]
        label, color = HIT_STYLES[hit.hit_type]
        offset_ms = ticks_to_milliseconds(hit.micro_timing_offset, pattern.settings.bpm)
        instrument_config = pattern.instruments[hit.instrument]

        if hit.hit_type == HIT_GHOST:
            fill_color = _hit_fill_color(color, column_kind) if isinstance(color, QColor) else None
            tooltip_kind = label or "ghost"
        else:
            fill_color = _hit_fill_color(
                color_from_velocity(
                    hit.velocity,
                    instrument_config.velocity_min,
                    instrument_config.velocity_max,
                ),
                column_kind,
            )
            tooltip_kind = "hit"

        item.setData(ROLE_HIT_LABEL, label)
        item.setData(ROLE_OFFSET_TEXT, _format_offset(offset_ms))
        item.setData(ROLE_FILL_COLOR, fill_color)
        item.setToolTip(
            f"{instrument_config.name}: {tooltip_kind} vel {hit.velocity} "
            f"{_format_offset(offset_ms) or '0'}"
        )

    def _update_drag_target(self, position: QPoint) -> None:
        if self._pattern is None or self._drag_origin is None:
            return
        index = self.indexAt(position)
        if not index.isValid():
            new_target = None
        else:
            instrument_key = INSTRUMENT_ORDER[index.row()]
            global_slot = index.column()
            origin_instrument, origin_slot = self._drag_origin
            if instrument_key != origin_instrument or global_slot == origin_slot:
                new_target = None
            else:
                origin_is_base = self._pattern.visible_base_hit_for_cell(origin_instrument, origin_slot) is not None
                if origin_is_base:
                    occupied = self._pattern.visible_base_hit_for_cell(instrument_key, global_slot) is not None
                else:
                    occupied = (
                        self._pattern.visible_base_hit_for_cell(instrument_key, global_slot) is not None
                        or self._pattern.hit_for_cell(instrument_key, global_slot, hit_type=HIT_GHOST) is not None
                    )
                drag_state = DRAG_TARGET_BLOCKED if occupied else DRAG_TARGET_VALID
                new_target = (instrument_key, global_slot, drag_state)
        if new_target != self._drag_target:
            self._drag_target = new_target
            self.viewport().update()

    def _drag_state_for_cell(self, instrument_key: str, column: int, hits: list) -> str:
        if not self._drag_started:
            return DRAG_NONE
        if self._drag_origin is not None:
            origin_instrument, origin_slot = self._drag_origin
            if instrument_key == origin_instrument and origin_slot == column:
                return DRAG_SOURCE
        if self._drag_target is not None:
            target_instrument, target_slot, drag_state = self._drag_target
            if instrument_key == target_instrument and target_slot == column:
                return drag_state
        return DRAG_NONE


def _column_kind(column: int, slots_per_bar: int) -> str:
    slot_in_bar = column % slots_per_bar
    if slot_in_bar % 8 == 0:
        return COLUMN_BEAT
    if slot_in_bar % 8 == 4:
        return COLUMN_MID
    return COLUMN_NORMAL


def _hit_fill_color(base: QColor, column_kind: str) -> QColor:
    if column_kind == COLUMN_BEAT:
        return _mix_colors(base, QColor("#ffffff"), 0.14)
    if column_kind == COLUMN_MID:
        return _mix_colors(base, QColor("#94a3b8"), 0.08)
    return base


def _mix_colors(primary: QColor, secondary: QColor, ratio: float) -> QColor:
    inverse = 1.0 - ratio
    return QColor(
        int(primary.red() * inverse + secondary.red() * ratio),
        int(primary.green() * inverse + secondary.green() * ratio),
        int(primary.blue() * inverse + secondary.blue() * ratio),
    )


def color_from_velocity(velocity: int, velocity_min: int, velocity_max: int) -> QColor:
    start_color = QColor("#34d399")
    end_color = QColor("#8b5cf6")
    position = _normalized_velocity_position(velocity, velocity_min, velocity_max)
    return _mix_colors(start_color, end_color, position)


def _normalized_velocity_position(velocity: int, velocity_min: int, velocity_max: int) -> float:
    if velocity_max <= velocity_min:
        return 1.0
    normalized = (velocity - velocity_min) / (velocity_max - velocity_min)
    return max(0.0, min(1.0, normalized))


def _format_offset(offset_ms: int) -> str:
    if offset_ms == 0:
        return ""
    return f"{offset_ms:+d}"


def _hit_priority(hit_type: str) -> int:
    if hit_type == HIT_ACCENT:
        return 0
    if hit_type == HIT_MAIN:
        return 1
    return 2
