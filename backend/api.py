import os
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from core.generator import DrumPatternGenerator
from core.instruments import build_default_instruments
from core.midi_export import export_pattern_to_midi
from core.pattern import GlobalSettings
from core.pattern_serialization import deserialize_pattern, serialize_pattern
from core.presets import load_preset, preset_names
from core.timing import parse_grouping

def parse_cors_origins() -> list[str]:
    configured = os.getenv("BACKEND_CORS_ORIGINS", "")
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]

    if origins:
        return origins

    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://ghostgroove.com",
        "https://www.ghostgroove.com",
    ]


app = FastAPI()
generator = DrumPatternGenerator()

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_origin_regex=r"https://.*\.pages\.dev",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets/drums", StaticFiles(directory=Path(__file__).resolve().parent / "assets" / "drums"), name="drum-assets")


class GenerateRequest(BaseModel):
    bpm: int
    preset: str | None = None
    seed: int | None = Field(default=None, ge=0)
    bars: int | None = None
    grouping: str | None = None
    swing: float | None = Field(default=None, ge=0.0, le=0.65)
    humanize_timing: int | None = Field(default=None, ge=0, le=24)
    humanize_velocity: int | None = Field(default=None, ge=0, le=24)
    bar_similarity: float | None = Field(default=None, ge=0.0, le=1.0)
    fill_intensity: Literal["off", "low", "medium", "high"] | None = None
    fill_length: Literal["short", "medium", "long"] | None = None
    fill_every: int | None = Field(default=None, gt=0)
    kick_enabled: bool | None = None
    kick_density: float | None = Field(default=None, ge=0.0, le=1.0)
    kick_syncopation: int | None = Field(default=None, ge=0, le=5)
    kick_timing_feel: Literal["neutral", "push", "drag", "random"] | None = None
    kick_velocity_min: int | None = Field(default=None, ge=1, le=127)
    kick_velocity_max: int | None = Field(default=None, ge=1, le=127)
    snare_enabled: bool | None = None
    snare_density: float | None = Field(default=None, ge=0.0, le=1.0)
    snare_syncopation: int | None = Field(default=None, ge=0, le=5)
    snare_timing_feel: Literal["neutral", "push", "drag", "random"] | None = None
    snare_velocity_min: int | None = Field(default=None, ge=1, le=127)
    snare_velocity_max: int | None = Field(default=None, ge=1, le=127)
    snare_ghost_enabled: bool | None = None
    snare_ghost_density: float | None = Field(default=None, ge=0.0, le=1.0)
    snare_ghost_velocity: int | None = Field(default=None, ge=1, le=127)
    snare_ghost_placement: Literal["before", "after", "both"] | None = None
    hihat_closed_enabled: bool | None = None
    hihat_closed_division: Literal["quarter", "eighth", "sixteenth"] | None = None
    hihat_closed_space: float | None = Field(default=None, ge=0.0, le=1.0)
    hihat_closed_timing_feel: Literal["neutral", "push", "drag", "random"] | None = None
    hihat_closed_velocity_min: int | None = Field(default=None, ge=1, le=127)
    hihat_closed_velocity_max: int | None = Field(default=None, ge=1, le=127)
    hihat_closed_ghost_enabled: bool | None = None
    hihat_closed_ghost_density: float | None = Field(default=None, ge=0.0, le=1.0)
    hihat_closed_ghost_velocity: int | None = Field(default=None, ge=1, le=127)
    hihat_closed_ghost_placement: Literal["before", "after", "both"] | None = None
    ride_enabled: bool | None = None
    ride_division: Literal["quarter", "eighth", "sixteenth"] | None = None
    ride_space: float | None = Field(default=None, ge=0.0, le=1.0)
    ride_timing_feel: Literal["neutral", "push", "drag", "random"] | None = None
    ride_velocity_min: int | None = Field(default=None, ge=1, le=127)
    ride_velocity_max: int | None = Field(default=None, ge=1, le=127)
    ride_ghost_enabled: bool | None = None
    ride_ghost_density: float | None = Field(default=None, ge=0.0, le=1.0)
    ride_ghost_velocity: int | None = Field(default=None, ge=1, le=127)
    ride_ghost_placement: Literal["before", "after", "both"] | None = None
    hihat_open_enabled: bool | None = None
    hihat_open_density: float | None = Field(default=None, ge=0.0, le=1.0)
    hihat_open_velocity_min: int | None = Field(default=None, ge=1, le=127)
    hihat_open_velocity_max: int | None = Field(default=None, ge=1, le=127)
    crash_enabled: bool | None = None
    crash_density: float | None = Field(default=None, ge=0.0, le=1.0)
    crash_velocity_min: int | None = Field(default=None, ge=1, le=127)
    crash_velocity_max: int | None = Field(default=None, ge=1, le=127)
    toms_high_hits: int | None = Field(default=None, ge=0, le=3)
    toms_mid_hits: int | None = Field(default=None, ge=0, le=3)
    toms_low_hits: int | None = Field(default=None, ge=0, le=3)
    toms_velocity_min: int | None = Field(default=None, ge=1, le=127)
    toms_velocity_max: int | None = Field(default=None, ge=1, le=127)


class PatternMetaRequest(BaseModel):
    bpm: int = Field(ge=1)
    bars: int = Field(ge=1)
    grouping: str
    slots_per_bar: int = Field(ge=1)
    swing: float = Field(default=0.0, ge=0.0, le=0.65)
    humanize_timing: int = Field(default=6, ge=0, le=24)
    humanize_velocity: int = Field(default=6, ge=0, le=24)


class PatternEventRequest(BaseModel):
    bar: int = Field(ge=0)
    slot: int = Field(ge=0)
    hit_type: Literal["main", "accent", "ghost"]
    velocity: int = Field(ge=1, le=127)
    offset: int
    length_ticks: int = Field(ge=1)
    source: str = "generated"


class FillRegionRequest(BaseModel):
    bar: int = Field(ge=0)
    slots: list[int]
    intensity: str


class PatternPayloadRequest(BaseModel):
    pattern_version: int = 1
    meta: PatternMetaRequest
    instrument_order: list[str]
    events: dict[str, list[PatternEventRequest]]
    fill_regions: list[FillRegionRequest] = []
    bpm_override: int | None = Field(default=None, ge=1)


class PatternCellRequest(BaseModel):
    pattern: PatternPayloadRequest
    instrument: str
    bar: int = Field(ge=0)
    slot: int = Field(ge=0)
    context: GenerateRequest | None = None


class PatternMoveRequest(BaseModel):
    pattern: PatternPayloadRequest
    instrument: str
    from_bar: int = Field(ge=0)
    from_slot: int = Field(ge=0)
    to_bar: int = Field(ge=0)
    to_slot: int = Field(ge=0)
    hit_type: Literal["main", "accent", "ghost"]
    context: GenerateRequest | None = None


class PatternGenerateGhostsRequest(BaseModel):
    pattern: PatternPayloadRequest
    seed: int | None = Field(default=None, ge=0)
    snare_enabled: bool | None = None
    snare_ghost_enabled: bool | None = None
    snare_ghost_density: float | None = Field(default=None, ge=0.0, le=1.0)
    snare_ghost_velocity: int | None = Field(default=None, ge=1, le=127)
    snare_ghost_placement: Literal["before", "after", "both"] | None = None
    hihat_closed_enabled: bool | None = None
    hihat_closed_division: Literal["quarter", "eighth", "sixteenth"] | None = None
    hihat_closed_ghost_enabled: bool | None = None
    hihat_closed_ghost_density: float | None = Field(default=None, ge=0.0, le=1.0)
    hihat_closed_ghost_velocity: int | None = Field(default=None, ge=1, le=127)
    hihat_closed_ghost_placement: Literal["before", "after", "both"] | None = None
    ride_enabled: bool | None = None
    ride_division: Literal["quarter", "eighth", "sixteenth"] | None = None
    ride_ghost_enabled: bool | None = None
    ride_ghost_density: float | None = Field(default=None, ge=0.0, le=1.0)
    ride_ghost_velocity: int | None = Field(default=None, ge=1, le=127)
    ride_ghost_placement: Literal["before", "after", "both"] | None = None


@app.get("/")
def root():
    return {"status": "ok", "message": "GhostGroove backend is running"}


@app.get("/presets")
def presets():
    items = []
    for name in preset_names():
        settings, instruments = load_preset(name)
        kick = instruments["kick"]
        snare = instruments["snare"]
        hihat_closed = instruments["hihat_closed"]
        ride = instruments["ride"]
        hihat_open = instruments["hihat_open"]
        crash = instruments["crash"]
        tom_high = instruments["tom_high"]
        tom_mid = instruments["tom_mid"]
        tom_low = instruments["tom_low"]
        items.append(
            {
                "id": name,
                "label": name,
                "settings": {
                    "bpm": settings.bpm,
                    "bars": settings.bars,
                    "grouping": settings.grouping,
                    "swing": settings.swing,
                    "humanize_timing": settings.humanize_timing,
                    "humanize_velocity": settings.humanize_velocity,
                    "bar_similarity": settings.bar_similarity,
                    "fill_intensity": settings.fill_intensity,
                    "fill_length": settings.fill_length,
                    "fill_every": settings.fill_every,
                },
                "kick": {
                    "enabled": kick.enabled,
                    "density": kick.density,
                    "syncopation": round(kick.syncopation_amount * 5),
                    "timing_feel": kick.timing_feel,
                    "velocity_min": kick.velocity_min,
                    "velocity_max": kick.velocity_max,
                },
                "snare": {
                    "enabled": snare.enabled,
                    "density": snare.density,
                    "syncopation": round(snare.syncopation_amount * 5),
                    "timing_feel": snare.timing_feel,
                    "velocity_min": snare.velocity_min,
                    "velocity_max": snare.velocity_max,
                    "ghost_settings": {
                        "enabled": snare.ghost_settings.enabled,
                        "density": snare.ghost_settings.density,
                        "velocity": snare.ghost_settings.velocity,
                        "placement": snare.ghost_settings.placement,
                    }
                    if snare.ghost_settings is not None
                    else None,
                },
                "hihat_closed": {
                    "enabled": hihat_closed.enabled,
                    "division": hihat_closed.pulse_division,
                    "space": hihat_closed.pulse_space,
                    "timing_feel": hihat_closed.timing_feel,
                    "velocity_min": hihat_closed.velocity_min,
                    "velocity_max": hihat_closed.velocity_max,
                    "ghost_settings": {
                        "enabled": hihat_closed.ghost_settings.enabled,
                        "density": hihat_closed.ghost_settings.density,
                        "velocity": hihat_closed.ghost_settings.velocity,
                        "placement": hihat_closed.ghost_settings.placement,
                    }
                    if hihat_closed.ghost_settings is not None
                    else None,
                },
                "ride": {
                    "enabled": ride.enabled,
                    "division": ride.pulse_division,
                    "space": ride.pulse_space,
                    "timing_feel": ride.timing_feel,
                    "velocity_min": ride.velocity_min,
                    "velocity_max": ride.velocity_max,
                    "ghost_settings": {
                        "enabled": ride.ghost_settings.enabled,
                        "density": ride.ghost_settings.density,
                        "velocity": ride.ghost_settings.velocity,
                        "placement": ride.ghost_settings.placement,
                    }
                    if ride.ghost_settings is not None
                    else None,
                },
                "hihat_open": {
                    "enabled": hihat_open.enabled,
                    "density": hihat_open.density,
                    "velocity_min": hihat_open.velocity_min,
                    "velocity_max": hihat_open.velocity_max,
                },
                "crash": {
                    "enabled": crash.enabled,
                    "density": crash.density,
                    "velocity_min": crash.velocity_min,
                    "velocity_max": crash.velocity_max,
                },
                "toms": {
                    "high_hits": tom_high.tom_hit_count,
                    "mid_hits": tom_mid.tom_hit_count,
                    "low_hits": tom_low.tom_hit_count,
                    "velocity_min": tom_high.velocity_min,
                    "velocity_max": tom_high.velocity_max,
                },
            }
        )
    return items


def _delete_file(path: str) -> None:
    if os.path.exists(path):
        os.unlink(path)


def _apply_generate_request_overrides(settings, instruments, request: GenerateRequest) -> None:
    settings.bpm = request.bpm
    if request.bars is not None:
        settings.bars = request.bars
    if request.grouping is not None:
        settings.grouping = request.grouping.strip()
        try:
            parse_grouping(settings.grouping)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.seed is not None:
        settings.seed = request.seed
    if request.swing is not None:
        settings.swing = request.swing
    if request.humanize_timing is not None:
        settings.humanize_timing = request.humanize_timing
    if request.humanize_velocity is not None:
        settings.humanize_velocity = request.humanize_velocity
    if request.bar_similarity is not None:
        settings.bar_similarity = request.bar_similarity
    if request.fill_intensity is not None:
        settings.fill_intensity = request.fill_intensity
    if request.fill_length is not None:
        settings.fill_length = request.fill_length
    if request.fill_every is not None:
        settings.fill_every = request.fill_every
    kick = instruments["kick"]
    if request.kick_enabled is not None:
        kick.enabled = request.kick_enabled
    if request.kick_density is not None:
        kick.density = request.kick_density
    if request.kick_syncopation is not None:
        kick.syncopation_amount = request.kick_syncopation / 5
    if request.kick_timing_feel is not None:
        kick.timing_feel = request.kick_timing_feel
    if request.kick_velocity_min is not None:
        kick.velocity_min = request.kick_velocity_min
    if request.kick_velocity_max is not None:
        kick.velocity_max = request.kick_velocity_max
    if kick.velocity_max < kick.velocity_min:
        raise HTTPException(status_code=400, detail="Kick velocity max must be greater than or equal to min")
    snare = instruments["snare"]
    if request.snare_enabled is not None:
        snare.enabled = request.snare_enabled
    if request.snare_density is not None:
        snare.density = request.snare_density
    if request.snare_syncopation is not None:
        snare.syncopation_amount = request.snare_syncopation / 5
    if request.snare_timing_feel is not None:
        snare.timing_feel = request.snare_timing_feel
    if request.snare_velocity_min is not None:
        snare.velocity_min = request.snare_velocity_min
    if request.snare_velocity_max is not None:
        snare.velocity_max = request.snare_velocity_max
    if snare.ghost_settings is not None:
        if request.snare_ghost_enabled is not None:
            snare.ghost_settings.enabled = request.snare_ghost_enabled
        if request.snare_ghost_density is not None:
            snare.ghost_settings.density = request.snare_ghost_density
        if request.snare_ghost_velocity is not None:
            snare.ghost_settings.velocity = request.snare_ghost_velocity
            snare.ghost_settings.velocity_min, snare.ghost_settings.velocity_max = snare.ghost_settings.velocity_bounds()
        if request.snare_ghost_placement is not None:
            snare.ghost_settings.placement = request.snare_ghost_placement
    if snare.velocity_max < snare.velocity_min:
        raise HTTPException(status_code=400, detail="Snare velocity max must be greater than or equal to min")
    hihat_closed = instruments["hihat_closed"]
    if request.hihat_closed_enabled is not None:
        hihat_closed.enabled = request.hihat_closed_enabled
    if request.hihat_closed_division is not None:
        hihat_closed.pulse_division = request.hihat_closed_division
    if request.hihat_closed_space is not None:
        hihat_closed.pulse_space = request.hihat_closed_space
    if request.hihat_closed_timing_feel is not None:
        hihat_closed.timing_feel = request.hihat_closed_timing_feel
    if request.hihat_closed_velocity_min is not None:
        hihat_closed.velocity_min = request.hihat_closed_velocity_min
    if request.hihat_closed_velocity_max is not None:
        hihat_closed.velocity_max = request.hihat_closed_velocity_max
    if hihat_closed.ghost_settings is not None:
        if request.hihat_closed_ghost_enabled is not None:
            hihat_closed.ghost_settings.enabled = request.hihat_closed_ghost_enabled
        if request.hihat_closed_ghost_density is not None:
            hihat_closed.ghost_settings.density = request.hihat_closed_ghost_density
        if request.hihat_closed_ghost_velocity is not None:
            hihat_closed.ghost_settings.velocity = request.hihat_closed_ghost_velocity
            (
                hihat_closed.ghost_settings.velocity_min,
                hihat_closed.ghost_settings.velocity_max,
            ) = hihat_closed.ghost_settings.velocity_bounds()
        if request.hihat_closed_ghost_placement is not None:
            hihat_closed.ghost_settings.placement = request.hihat_closed_ghost_placement
    if hihat_closed.velocity_max < hihat_closed.velocity_min:
        raise HTTPException(status_code=400, detail="Hi-Hat Closed velocity max must be greater than or equal to min")
    ride = instruments["ride"]
    if request.ride_enabled is not None:
        ride.enabled = request.ride_enabled
    if request.ride_division is not None:
        ride.pulse_division = request.ride_division
    if request.ride_space is not None:
        ride.pulse_space = request.ride_space
    if request.ride_timing_feel is not None:
        ride.timing_feel = request.ride_timing_feel
    if request.ride_velocity_min is not None:
        ride.velocity_min = request.ride_velocity_min
    if request.ride_velocity_max is not None:
        ride.velocity_max = request.ride_velocity_max
    if ride.ghost_settings is not None:
        if request.ride_ghost_enabled is not None:
            ride.ghost_settings.enabled = request.ride_ghost_enabled
        if request.ride_ghost_density is not None:
            ride.ghost_settings.density = request.ride_ghost_density
        if request.ride_ghost_velocity is not None:
            ride.ghost_settings.velocity = request.ride_ghost_velocity
            ride.ghost_settings.velocity_min, ride.ghost_settings.velocity_max = ride.ghost_settings.velocity_bounds()
        if request.ride_ghost_placement is not None:
            ride.ghost_settings.placement = request.ride_ghost_placement
    if ride.velocity_max < ride.velocity_min:
        raise HTTPException(status_code=400, detail="Ride velocity max must be greater than or equal to min")
    hihat_open = instruments["hihat_open"]
    if request.hihat_open_enabled is not None:
        hihat_open.enabled = request.hihat_open_enabled
    if request.hihat_open_density is not None:
        hihat_open.density = request.hihat_open_density
    if request.hihat_open_velocity_min is not None:
        hihat_open.velocity_min = request.hihat_open_velocity_min
    if request.hihat_open_velocity_max is not None:
        hihat_open.velocity_max = request.hihat_open_velocity_max
    if hihat_open.velocity_max < hihat_open.velocity_min:
        raise HTTPException(status_code=400, detail="Hi-Hat Open velocity max must be greater than or equal to min")
    crash = instruments["crash"]
    if request.crash_enabled is not None:
        crash.enabled = request.crash_enabled
    if request.crash_density is not None:
        crash.density = request.crash_density
    if request.crash_velocity_min is not None:
        crash.velocity_min = request.crash_velocity_min
    if request.crash_velocity_max is not None:
        crash.velocity_max = request.crash_velocity_max
    if crash.velocity_max < crash.velocity_min:
        raise HTTPException(status_code=400, detail="Crash velocity max must be greater than or equal to min")
    tom_high = instruments["tom_high"]
    tom_mid = instruments["tom_mid"]
    tom_low = instruments["tom_low"]
    if request.toms_high_hits is not None:
        tom_high.tom_hit_count = request.toms_high_hits
        tom_high.enabled = request.toms_high_hits > 0
    if request.toms_mid_hits is not None:
        tom_mid.tom_hit_count = request.toms_mid_hits
        tom_mid.enabled = request.toms_mid_hits > 0
    if request.toms_low_hits is not None:
        tom_low.tom_hit_count = request.toms_low_hits
        tom_low.enabled = request.toms_low_hits > 0
    if request.toms_velocity_min is not None:
        tom_high.velocity_min = request.toms_velocity_min
        tom_mid.velocity_min = request.toms_velocity_min
        tom_low.velocity_min = request.toms_velocity_min
    if request.toms_velocity_max is not None:
        tom_high.velocity_max = request.toms_velocity_max
        tom_mid.velocity_max = request.toms_velocity_max
        tom_low.velocity_max = request.toms_velocity_max
    if tom_high.velocity_max < tom_high.velocity_min:
        raise HTTPException(status_code=400, detail="Toms velocity max must be greater than or equal to min")


def _build_pattern(request: GenerateRequest):
    if request.preset is None:
        settings = GlobalSettings()
        instruments = build_default_instruments()
    else:
        try:
            settings, instruments = load_preset(request.preset)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    _apply_generate_request_overrides(settings, instruments, request)
    return generator.generate(settings, instruments)


def _pattern_from_payload(payload: PatternPayloadRequest):
    try:
        return deserialize_pattern(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _apply_ghost_regeneration_overrides(pattern, request: PatternGenerateGhostsRequest) -> None:
    snare = pattern.instruments["snare"]
    if request.snare_enabled is not None:
        snare.enabled = request.snare_enabled
    if snare.ghost_settings is not None:
        if request.snare_ghost_enabled is not None:
            snare.ghost_settings.enabled = request.snare_ghost_enabled
        if request.snare_ghost_density is not None:
            snare.ghost_settings.density = request.snare_ghost_density
        if request.snare_ghost_velocity is not None:
            snare.ghost_settings.velocity = request.snare_ghost_velocity
            snare.ghost_settings.velocity_min, snare.ghost_settings.velocity_max = snare.ghost_settings.velocity_bounds()
        if request.snare_ghost_placement is not None:
            snare.ghost_settings.placement = request.snare_ghost_placement

    hihat_closed = pattern.instruments["hihat_closed"]
    if request.hihat_closed_enabled is not None:
        hihat_closed.enabled = request.hihat_closed_enabled
    if request.hihat_closed_division is not None:
        hihat_closed.pulse_division = request.hihat_closed_division
    if hihat_closed.ghost_settings is not None:
        if request.hihat_closed_ghost_enabled is not None:
            hihat_closed.ghost_settings.enabled = request.hihat_closed_ghost_enabled
        if request.hihat_closed_ghost_density is not None:
            hihat_closed.ghost_settings.density = request.hihat_closed_ghost_density
        if request.hihat_closed_ghost_velocity is not None:
            hihat_closed.ghost_settings.velocity = request.hihat_closed_ghost_velocity
            (
                hihat_closed.ghost_settings.velocity_min,
                hihat_closed.ghost_settings.velocity_max,
            ) = hihat_closed.ghost_settings.velocity_bounds()
        if request.hihat_closed_ghost_placement is not None:
            hihat_closed.ghost_settings.placement = request.hihat_closed_ghost_placement

    ride = pattern.instruments["ride"]
    if request.ride_enabled is not None:
        ride.enabled = request.ride_enabled
    if request.ride_division is not None:
        ride.pulse_division = request.ride_division
    if ride.ghost_settings is not None:
        if request.ride_ghost_enabled is not None:
            ride.ghost_settings.enabled = request.ride_ghost_enabled
        if request.ride_ghost_density is not None:
            ride.ghost_settings.density = request.ride_ghost_density
        if request.ride_ghost_velocity is not None:
            ride.ghost_settings.velocity = request.ride_ghost_velocity
            ride.ghost_settings.velocity_min, ride.ghost_settings.velocity_max = ride.ghost_settings.velocity_bounds()
        if request.ride_ghost_placement is not None:
            ride.ghost_settings.placement = request.ride_ghost_placement


def _global_slot(pattern, bar: int, slot: int) -> int:
    if bar < 0 or bar >= pattern.settings.bars:
        raise HTTPException(status_code=400, detail=f"Invalid bar index: {bar}")
    if slot < 0 or slot >= pattern.total_slots_per_bar:
        raise HTTPException(status_code=400, detail=f"Invalid slot index: {slot}")
    return bar * pattern.total_slots_per_bar + slot


@app.post("/generate-pattern")
def generate_pattern(request: GenerateRequest):
    return serialize_pattern(_build_pattern(request))


@app.post("/pattern/add-base-hit")
def add_base_hit(request: PatternCellRequest):
    pattern = _pattern_from_payload(request.pattern)
    if request.context is not None:
        _apply_generate_request_overrides(pattern.settings, pattern.instruments, request.context)
    config = pattern.instruments.get(request.instrument)
    if config is None:
        raise HTTPException(status_code=400, detail=f"Unknown instrument: {request.instrument}")

    global_slot_index = _global_slot(pattern, request.bar, request.slot)
    added = pattern.add_manual_base_hit(
        instrument_key=request.instrument,
        global_slot_index=global_slot_index,
        config=config,
        humanize_timing=pattern.settings.humanize_timing,
        humanize_velocity_amount=pattern.settings.humanize_velocity,
    )
    if added is None:
        raise HTTPException(status_code=400, detail="Could not add base hit at requested cell")
    return serialize_pattern(pattern)


@app.post("/pattern/remove-hit")
def remove_hit(request: PatternCellRequest):
    pattern = _pattern_from_payload(request.pattern)
    if request.context is not None:
        _apply_generate_request_overrides(pattern.settings, pattern.instruments, request.context)
    if request.instrument not in pattern.instruments:
        raise HTTPException(status_code=400, detail=f"Unknown instrument: {request.instrument}")

    global_slot_index = _global_slot(pattern, request.bar, request.slot)
    removed = pattern.remove_base_hit_at_cell(request.instrument, global_slot_index)
    if not removed:
        removed = pattern.remove_ghost_hit_at_cell(request.instrument, global_slot_index)
    if not removed:
        raise HTTPException(status_code=400, detail="Could not remove hit at requested cell")
    return serialize_pattern(pattern)


@app.post("/pattern/move-hit")
def move_hit(request: PatternMoveRequest):
    pattern = _pattern_from_payload(request.pattern)
    if request.context is not None:
        _apply_generate_request_overrides(pattern.settings, pattern.instruments, request.context)
    if request.instrument not in pattern.instruments:
        raise HTTPException(status_code=400, detail=f"Unknown instrument: {request.instrument}")

    from_global_slot_index = _global_slot(pattern, request.from_bar, request.from_slot)
    to_global_slot_index = _global_slot(pattern, request.to_bar, request.to_slot)

    if request.hit_type == "ghost":
        moved = pattern.move_ghost_hit(request.instrument, from_global_slot_index, to_global_slot_index)
    else:
        moved = pattern.move_base_hit(request.instrument, from_global_slot_index, to_global_slot_index)

    if not moved:
        raise HTTPException(status_code=400, detail="Could not move hit to requested cell")
    return serialize_pattern(pattern)


@app.post("/pattern/generate-ghosts")
def generate_ghosts(request: PatternGenerateGhostsRequest):
    pattern = _pattern_from_payload(request.pattern)
    _apply_ghost_regeneration_overrides(pattern, request)
    generator.regenerate_ghost_hits(pattern, seed=request.seed)
    return serialize_pattern(pattern)


@app.post("/export-midi")
def export_midi(request: PatternPayloadRequest):
    try:
        pattern = deserialize_pattern(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    file_descriptor, midi_path = tempfile.mkstemp(suffix=".mid")
    os.close(file_descriptor)

    export_pattern_to_midi(pattern, midi_path, bpm_override=request.bpm_override or request.meta.bpm)

    return FileResponse(
        midi_path,
        filename="pattern.mid",
        media_type="audio/midi",
        background=BackgroundTask(_delete_file, midi_path),
    )


@app.post("/generate")
def generate(request: GenerateRequest):
    pattern = _build_pattern(request)

    file_descriptor, midi_path = tempfile.mkstemp(suffix=".mid")
    os.close(file_descriptor)

    export_pattern_to_midi(pattern, midi_path, bpm_override=request.bpm)

    return FileResponse(
        midi_path,
        filename="pattern.mid",
        media_type="audio/midi",
        background=BackgroundTask(_delete_file, midi_path),
    )
