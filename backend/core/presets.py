from __future__ import annotations

from copy import deepcopy

from core.instruments import build_default_instruments
from core.pattern import GlobalSettings, InstrumentConfig

VELOCITY_PRESET_DROP = 20


def _sync(level: int) -> float:
    return max(0.0, min(1.0, level / 5))


def _drop_velocity(value: int, amount: int = VELOCITY_PRESET_DROP) -> int:
    return max(1, value - amount)


def _apply_velocity_drop(instruments: dict[str, InstrumentConfig]) -> None:
    for key, config in instruments.items():
        if key != "hihat_closed":
            config.velocity_min = _drop_velocity(config.velocity_min)
            config.velocity_max = _drop_velocity(config.velocity_max)
        if config.ghost_settings is not None:
            config.ghost_settings.velocity_min, config.ghost_settings.velocity_max = config.ghost_settings.velocity_bounds()


PRESET_DEFINITIONS: dict[str, dict[str, object]] = {
    "Indie / Alt - Verse - Indie Tight": {
        "settings": {
            "bpm": 105,
            "swing": 0.02,
            "humanize_timing": 6,
            "humanize_velocity": 5,
            "bar_similarity": 0.80,
            "fill_every": 2,
            "fill_length": "short",
            "fill_intensity": "off",
        },
        "instruments": {
            "kick": {"density": 0.35, "syncopation_amount": _sync(1), "velocity_min": 84, "velocity_max": 114},
            "snare": {
                "density": 0.35,
                "velocity_min": 82,
                "velocity_max": 112,
                "ghost_settings": {"enabled": True, "density": 0.22, "placement": "after", "velocity": 31},
            },
            "hihat_closed": {
                "pulse_division": "sixteenth",
                "pulse_space": 0.08,
                "timing_feel": "neutral",
                "velocity_min": 62,
                "velocity_max": 90,
                "ghost_settings": {"enabled": True, "density": 0.12, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.10, "velocity_min": 70, "velocity_max": 94},
            "ride": {"enabled": False},
            "crash": {"enabled": False, "density": 0.0, "velocity_min": 94, "velocity_max": 108},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Indie / Alt - Chorus - Indie Wide": {
        "settings": {
            "bpm": 105,
            "swing": 0.02,
            "humanize_timing": 6,
            "humanize_velocity": 6,
            "bar_similarity": 0.70,
            "fill_every": 2,
            "fill_length": "medium",
            "fill_intensity": "low",
        },
        "instruments": {
            "kick": {"density": 0.50, "syncopation_amount": _sync(2), "velocity_min": 88, "velocity_max": 120},
            "snare": {
                "density": 0.40,
                "velocity_min": 92,
                "velocity_max": 122,
                "ghost_settings": {"enabled": True, "density": 0.15, "placement": "after", "velocity": 30},
            },
            "hihat_closed": {
                "pulse_division": "eighth",
                "pulse_space": 0.06,
                "timing_feel": "neutral",
                "velocity_min": 66,
                "velocity_max": 96,
                "ghost_settings": {"enabled": True, "density": 0.08, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.30, "velocity_min": 76, "velocity_max": 102},
            "ride": {
                "enabled": True,
                "pulse_division": "eighth",
                "pulse_space": 0.10,
                "timing_feel": "push",
                "velocity_min": 70,
                "velocity_max": 98,
                "ghost_settings": {"enabled": True, "density": 0.08, "placement": "after", "velocity": 26},
            },
            "crash": {"density": 0.25, "velocity_min": 102, "velocity_max": 118},
            "tom_high": {"enabled": True, "tom_hit_count": 1},
            "tom_mid": {"enabled": True, "tom_hit_count": 1},
            "tom_low": {"enabled": True, "tom_hit_count": 1},
        },
    },
    "Funk / Groove - Verse - Funk Pocket": {
        "settings": {
            "bpm": 100,
            "swing": 0.05,
            "humanize_timing": 8,
            "humanize_velocity": 7,
            "bar_similarity": 0.60,
            "fill_every": 2,
            "fill_length": "short",
            "fill_intensity": "off",
        },
        "instruments": {
            "kick": {"density": 0.50, "syncopation_amount": _sync(3), "velocity_min": 86, "velocity_max": 116},
            "snare": {
                "density": 0.45,
                "velocity_min": 84,
                "velocity_max": 114,
                "ghost_settings": {"enabled": True, "density": 0.45, "placement": "both", "velocity": 32},
            },
            "hihat_closed": {
                "pulse_division": "sixteenth",
                "pulse_space": 0.12,
                "timing_feel": "push",
                "velocity_min": 60,
                "velocity_max": 90,
                "ghost_settings": {"enabled": True, "density": 0.28, "placement": "both", "velocity": 24},
            },
            "hihat_open": {"density": 0.20, "velocity_min": 72, "velocity_max": 98},
            "ride": {
                "enabled": True,
                "pulse_division": "eighth",
                "pulse_space": 0.45,
                "timing_feel": "neutral",
                "velocity_min": 64,
                "velocity_max": 88,
                "ghost_settings": {"enabled": True, "density": 0.06, "placement": "after", "velocity": 24},
            },
            "crash": {"enabled": False, "density": 0.0, "velocity_min": 96, "velocity_max": 110},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": True, "tom_hit_count": 1},
        },
    },
    "Funk / Groove - Chorus - Funk Lift": {
        "settings": {
            "bpm": 100,
            "swing": 0.05,
            "humanize_timing": 9,
            "humanize_velocity": 8,
            "bar_similarity": 0.55,
            "fill_every": 2,
            "fill_length": "medium",
            "fill_intensity": "low",
        },
        "instruments": {
            "kick": {"density": 0.60, "syncopation_amount": _sync(3), "velocity_min": 90, "velocity_max": 120},
            "snare": {
                "density": 0.45,
                "velocity_min": 88,
                "velocity_max": 118,
                "ghost_settings": {"enabled": True, "density": 0.35, "placement": "both", "velocity": 31},
            },
            "hihat_closed": {
                "pulse_division": "sixteenth",
                "pulse_space": 0.18,
                "timing_feel": "push",
                "velocity_min": 62,
                "velocity_max": 92,
                "ghost_settings": {"enabled": True, "density": 0.22, "placement": "both", "velocity": 24},
            },
            "hihat_open": {"density": 0.30, "velocity_min": 76, "velocity_max": 102},
            "ride": {
                "enabled": True,
                "pulse_division": "eighth",
                "pulse_space": 0.22,
                "timing_feel": "push",
                "velocity_min": 68,
                "velocity_max": 94,
                "ghost_settings": {"enabled": True, "density": 0.10, "placement": "after", "velocity": 25},
            },
            "crash": {"density": 0.18, "velocity_min": 100, "velocity_max": 116},
            "tom_high": {"enabled": True, "tom_hit_count": 1},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Lo-Fi / Chill - Verse - Dusty Loop": {
        "settings": {
            "bpm": 78,
            "swing": 0.08,
            "humanize_timing": 10,
            "humanize_velocity": 9,
            "bar_similarity": 0.85,
            "fill_every": 4,
            "fill_length": "short",
            "fill_intensity": "off",
        },
        "instruments": {
            "kick": {
                "density": 0.35,
                "syncopation_amount": _sync(1),
                "timing_feel": "drag",
                "velocity_min": 78,
                "velocity_max": 108,
            },
            "snare": {
                "density": 0.30,
                "timing_feel": "drag",
                "velocity_min": 76,
                "velocity_max": 104,
                "ghost_settings": {"enabled": True, "density": 0.35, "placement": "after", "velocity": 28},
            },
            "hihat_closed": {
                "pulse_division": "sixteenth",
                "pulse_space": 0.20,
                "timing_feel": "drag",
                "velocity_min": 54,
                "velocity_max": 82,
                "ghost_settings": {"enabled": True, "density": 0.22, "placement": "after", "velocity": 22},
            },
            "hihat_open": {"density": 0.02, "velocity_min": 62, "velocity_max": 84},
            "ride": {"enabled": False},
            "crash": {"enabled": False, "density": 0.0},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Lo-Fi / Chill - Chorus - Lo-Fi Bloom": {
        "settings": {
            "bpm": 78,
            "swing": 0.08,
            "humanize_timing": 10,
            "humanize_velocity": 9,
            "bar_similarity": 0.65,
            "fill_every": 4,
            "fill_length": "short",
            "fill_intensity": "low",
        },
        "instruments": {
            "kick": {
                "density": 0.45,
                "syncopation_amount": _sync(1),
                "timing_feel": "drag",
                "velocity_min": 82,
                "velocity_max": 112,
            },
            "snare": {
                "density": 0.34,
                "timing_feel": "drag",
                "velocity_min": 80,
                "velocity_max": 108,
                "ghost_settings": {"enabled": True, "density": 0.25, "placement": "after", "velocity": 28},
            },
            "hihat_closed": {
                "pulse_division": "sixteenth",
                "pulse_space": 0.15,
                "timing_feel": "drag",
                "velocity_min": 56,
                "velocity_max": 84,
                "ghost_settings": {"enabled": True, "density": 0.18, "placement": "after", "velocity": 22},
            },
            "hihat_open": {"density": 0.12, "velocity_min": 66, "velocity_max": 88},
            "ride": {
                "enabled": True,
                "pulse_division": "quarter",
                "pulse_space": 0.62,
                "timing_feel": "neutral",
                "velocity_min": 60,
                "velocity_max": 82,
                "ghost_settings": {"enabled": False, "density": 0.0, "placement": "after", "velocity": 22},
            },
            "crash": {"density": 0.05, "velocity_min": 90, "velocity_max": 104},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": True, "tom_hit_count": 1},
        },
    },
    "Alt Rock - Verse - Driving Verse": {
        "settings": {
            "bpm": 120,
            "swing": 0.0,
            "humanize_timing": 6,
            "humanize_velocity": 6,
            "bar_similarity": 0.75,
            "fill_every": 2,
            "fill_length": "short",
            "fill_intensity": "off",
        },
        "instruments": {
            "kick": {"density": 0.45, "syncopation_amount": _sync(2), "velocity_min": 90, "velocity_max": 120},
            "snare": {
                "density": 0.35,
                "velocity_min": 88,
                "velocity_max": 118,
                "ghost_settings": {"enabled": True, "density": 0.18, "placement": "after", "velocity": 30},
            },
            "hihat_closed": {
                "pulse_division": "eighth",
                "pulse_space": 0.10,
                "timing_feel": "neutral",
                "velocity_min": 68,
                "velocity_max": 96,
                "ghost_settings": {"enabled": True, "density": 0.08, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.15, "velocity_min": 74, "velocity_max": 98},
            "ride": {"enabled": False},
            "crash": {"enabled": False, "density": 0.0, "velocity_min": 102, "velocity_max": 116},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Alt Rock - Chorus - Big Chorus": {
        "settings": {
            "bpm": 120,
            "swing": 0.0,
            "humanize_timing": 6,
            "humanize_velocity": 6,
            "bar_similarity": 0.70,
            "fill_every": 2,
            "fill_length": "medium",
            "fill_intensity": "low",
        },
        "instruments": {
            "kick": {"density": 0.60, "syncopation_amount": _sync(2), "velocity_min": 94, "velocity_max": 124},
            "snare": {
                "density": 0.38,
                "velocity_min": 96,
                "velocity_max": 124,
                "ghost_settings": {"enabled": True, "density": 0.10, "placement": "after", "velocity": 29},
            },
            "hihat_closed": {
                "pulse_division": "eighth",
                "pulse_space": 0.24,
                "timing_feel": "neutral",
                "velocity_min": 66,
                "velocity_max": 92,
                "ghost_settings": {"enabled": True, "density": 0.05, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.30, "velocity_min": 80, "velocity_max": 106},
            "ride": {
                "enabled": True,
                "pulse_division": "eighth",
                "pulse_space": 0.04,
                "timing_feel": "push",
                "velocity_min": 72,
                "velocity_max": 100,
                "ghost_settings": {"enabled": True, "density": 0.06, "placement": "after", "velocity": 25},
            },
            "crash": {"density": 0.30, "velocity_min": 106, "velocity_max": 122},
            "tom_high": {"enabled": True, "tom_hit_count": 1},
            "tom_mid": {"enabled": True, "tom_hit_count": 1},
            "tom_low": {"enabled": True, "tom_hit_count": 1},
        },
    },
    "Alt Groove - 5/4 - Verse": {
        "settings": {
            "bpm": 100,
            "grouping": "3+2",
            "swing": 0.02,
            "humanize_timing": 7,
            "humanize_velocity": 6,
            "bar_similarity": 0.75,
            "fill_every": 2,
            "fill_length": "short",
            "fill_intensity": "off",
        },
        "instruments": {
            "kick": {"density": 0.40, "syncopation_amount": _sync(2), "velocity_min": 82, "velocity_max": 110},
            "snare": {
                "density": 0.35,
                "syncopation_amount": _sync(1),
                "velocity_min": 78,
                "velocity_max": 108,
                "ghost_settings": {"enabled": True, "density": 0.25, "placement": "after", "velocity": 30},
            },
            "hihat_closed": {
                "pulse_division": "sixteenth",
                "pulse_space": 0.10,
                "velocity_min": 60,
                "velocity_max": 90,
                "ghost_settings": {"enabled": True, "density": 0.15, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.12},
            "ride": {"enabled": False},
            "crash": {"enabled": False, "density": 0.0},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Alt Groove - 5/4 - Chorus": {
        "settings": {
            "bpm": 100,
            "grouping": "3+2",
            "swing": 0.02,
            "humanize_timing": 7,
            "humanize_velocity": 6,
            "bar_similarity": 0.65,
            "fill_every": 2,
            "fill_length": "medium",
            "fill_intensity": "low",
        },
        "instruments": {
            "kick": {"density": 0.55, "syncopation_amount": _sync(2), "velocity_min": 88, "velocity_max": 118},
            "snare": {
                "density": 0.35,
                "syncopation_amount": _sync(1),
                "velocity_min": 84,
                "velocity_max": 114,
                "ghost_settings": {"enabled": True, "density": 0.18, "placement": "after", "velocity": 29},
            },
            "hihat_closed": {
                "pulse_division": "eighth",
                "pulse_space": 0.10,
                "velocity_min": 62,
                "velocity_max": 92,
                "ghost_settings": {"enabled": True, "density": 0.10, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.25},
            "ride": {
                "enabled": True,
                "pulse_division": "eighth",
                "pulse_space": 0.08,
                "timing_feel": "push",
                "velocity_min": 68,
                "velocity_max": 96,
                "ghost_settings": {"enabled": True, "density": 0.12, "placement": "after", "velocity": 24},
            },
            "crash": {"density": 0.22, "velocity_min": 102, "velocity_max": 118},
            "tom_high": {"enabled": True, "tom_hit_count": 1},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Math Drive - 7/4 - Verse": {
        "settings": {
            "bpm": 110,
            "grouping": "3+2+2",
            "swing": 0.0,
            "humanize_timing": 6,
            "humanize_velocity": 6,
            "bar_similarity": 0.70,
            "fill_every": 2,
            "fill_length": "short",
            "fill_intensity": "off",
        },
        "instruments": {
            "kick": {"density": 0.45, "syncopation_amount": _sync(2), "velocity_min": 86, "velocity_max": 116},
            "snare": {
                "density": 0.35,
                "velocity_min": 82,
                "velocity_max": 112,
                "ghost_settings": {"enabled": True, "density": 0.22, "placement": "after", "velocity": 30},
            },
            "hihat_closed": {
                "pulse_division": "eighth",
                "pulse_space": 0.12,
                "velocity_min": 62,
                "velocity_max": 90,
                "ghost_settings": {"enabled": True, "density": 0.10, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.15},
            "ride": {"enabled": False},
            "crash": {"enabled": False, "density": 0.0},
            "tom_high": {"enabled": False, "tom_hit_count": 0},
            "tom_mid": {"enabled": False, "tom_hit_count": 0},
            "tom_low": {"enabled": False, "tom_hit_count": 0},
        },
    },
    "Math Drive - 7/4 - Chorus": {
        "settings": {
            "bpm": 110,
            "grouping": "3+2+2",
            "swing": 0.0,
            "humanize_timing": 6,
            "humanize_velocity": 6,
            "bar_similarity": 0.60,
            "fill_every": 2,
            "fill_length": "medium",
            "fill_intensity": "low",
        },
        "instruments": {
            "kick": {"density": 0.60, "syncopation_amount": _sync(2), "velocity_min": 92, "velocity_max": 122},
            "snare": {
                "density": 0.38,
                "velocity_min": 94,
                "velocity_max": 122,
                "ghost_settings": {"enabled": True, "density": 0.14, "placement": "after", "velocity": 29},
            },
            "hihat_closed": {
                "pulse_division": "eighth",
                "pulse_space": 0.22,
                "velocity_min": 64,
                "velocity_max": 92,
                "ghost_settings": {"enabled": True, "density": 0.06, "placement": "after", "velocity": 24},
            },
            "hihat_open": {"density": 0.24},
            "ride": {
                "enabled": True,
                "pulse_division": "eighth",
                "pulse_space": 0.04,
                "timing_feel": "push",
                "velocity_min": 70,
                "velocity_max": 98,
                "ghost_settings": {"enabled": True, "density": 0.10, "placement": "after", "velocity": 24},
            },
            "crash": {"density": 0.25, "velocity_min": 104, "velocity_max": 120},
            "tom_high": {"enabled": True, "tom_hit_count": 1},
            "tom_mid": {"enabled": True, "tom_hit_count": 1},
            "tom_low": {"enabled": True, "tom_hit_count": 1},
        },
    },
}


def preset_names() -> list[str]:
    return list(PRESET_DEFINITIONS.keys())


def load_preset(name: str) -> tuple[GlobalSettings, dict[str, InstrumentConfig]]:
    definition = PRESET_DEFINITIONS.get(name)
    if definition is None:
        raise ValueError(f"Unknown preset: {name}")

    settings = GlobalSettings()
    instruments = build_default_instruments()

    for key, value in dict(definition["settings"]).items():
        setattr(settings, key, value)

    for instrument_key, overrides in dict(definition["instruments"]).items():
        config = instruments[instrument_key]
        for key, value in dict(overrides).items():
            if key == "ghost_settings":
                if config.ghost_settings is None:
                    continue
                for ghost_key, ghost_value in dict(value).items():
                    setattr(config.ghost_settings, ghost_key, ghost_value)
                config.ghost_settings.velocity_min, config.ghost_settings.velocity_max = config.ghost_settings.velocity_bounds()
                continue
            setattr(config, key, value)

    _apply_velocity_drop(instruments)

    return deepcopy(settings), deepcopy(instruments)
