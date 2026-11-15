"""
Data loader for official STAGE benchmark assets.

Loads Task 1 (reference states & developments) and Task 3 (role assets),
with strict character identification, grounded asset selection, and timing validation.
Does NOT load Task 2 question-answering data.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from storylens.models import (
    CurrentStateClaim,
    DevelopmentRecord,
    MemoryRecord,
    PersonaPhaseRecord,
    RelationshipPhaseRecord,
    TimingFlag,
)


class STAGELoader:
    """
    Loads and indexes STAGE benchmark data from data/raw/.
    """

    def __init__(self, raw_data_dir: Path | str) -> None:
        self.raw_data_dir = Path(raw_data_dir)
        self.movie_info: dict[str, Any] = {}
        self.movie_metadata: dict[str, Any] = {}
        self.primary_roles: dict[str, dict[str, Any]] = {}
        self.legacy_roles: list[dict[str, Any]] = []
        self.task1_checkpoints: dict[tuple[str, int], dict[str, Any]] = {}
        self.all_task1_checkpoints_by_char: dict[str, list[dict[str, Any]]] = {}
        self.movie_scenes: dict[int, dict[str, Any]] = {}
        self.global_flags: list[TimingFlag] = []

        self._load_metadata()
        self._load_task3_role_assets()
        self._load_task1_reference_state_updates()

    def _load_metadata(self) -> None:
        """Load movie metadata, info files, and processed scene records."""
        info_path = self.raw_data_dir / "info.json"
        if info_path.exists():
            with open(info_path, encoding="utf-8") as f:
                self.movie_info = json.load(f)

        meta_path = self.raw_data_dir / "movie_metadata.json"
        if meta_path.exists():
            with open(meta_path, encoding="utf-8") as f:
                self.movie_metadata = json.load(f)

        # Load processed movie.json for rich scene metadata (titles, characters, events)
        proc_candidates = [
            self.raw_data_dir.parent / "processed" / "movie.json",
            Path("input/STAGE/data/processed/movie.json"),
            Path(__file__).resolve().parents[1] / "input" / "STAGE" / "data" / "processed" / "movie.json",
        ]
        for proc_path in proc_candidates:
            if proc_path.exists():
                with open(proc_path, encoding="utf-8") as f:
                    proc_data = json.load(f)
                    for sc in proc_data.get("scenes", []):
                        sc_id = sc.get("scene_id")
                        if sc_id is not None:
                            self.movie_scenes[int(sc_id)] = sc
                break

    def _load_task3_role_assets(self) -> None:
        """
        Load Task 3 role assets and select primary grounded roles.
        Distinguishes primary grounded role records from legacy un-grounded records.
        """
        assets_path = self.raw_data_dir / "task_3_role_assets.json"
        if not assets_path.exists():
            raise FileNotFoundError(f"Missing role assets file: {assets_path}")

        with open(assets_path, encoding="utf-8") as f:
            data = json.load(f)

        for role in data.get("roles", []):
            canonical = role.get("canonical_name")
            char_name = role.get("character_name")
            role_id = role.get("role_id")
            memories = role.get("memories", [])
            persona_phases = role.get("persona_phases", [])
            relationship_phases = role.get("relationship_phases", [])

            # Check if this is a primary grounded role asset
            # Primary roles in STAGE have:
            # 1. Non-empty canonical_name
            # 2. Valid role_id (e.g. task3-role-...)
            # 3. Memories with fact_origin and grounded_facts
            # 4. Rich persona_phases and relationship_phases
            has_grounded_memories = any(
                isinstance(m.get("fact_origin"), dict) and m.get("grounded_facts")
                for m in memories
            )

            if canonical and role_id and has_grounded_memories:
                # Primary role asset
                norm_name = self._normalize_character_name(canonical)
                self.primary_roles[norm_name] = role
            else:
                # Un-grounded or legacy role asset (e.g., Roles 2, 3, 4)
                name = canonical or char_name or "Unknown"
                self.legacy_roles.append({
                    "name": name,
                    "character_name": char_name,
                    "canonical_name": canonical,
                    "role_id": role_id,
                    "memories_count": len(memories),
                    "reason_excluded": (
                        "Legacy or un-grounded role asset: missing role_id, missing fact_origin in memories, "
                        "and lacks persona/relationship phases. Kept separate from primary state queries."
                    )
                })

    def _load_task1_reference_state_updates(self) -> None:
        """
        Load Task 1 reference state updates and index checkpoints by (character, scene_order).
        """
        t1_path = self.raw_data_dir / "task_1_reference_state_update.json"
        if not t1_path.exists():
            raise FileNotFoundError(f"Missing Task 1 reference file: {t1_path}")

        with open(t1_path, encoding="utf-8") as f:
            data = json.load(f)

        for traj in data.get("trajectories", []):
            raw_char = traj.get("character", "")
            norm_char = self._normalize_character_name(raw_char)
            self.all_task1_checkpoints_by_char[norm_char] = []

            for cp in traj.get("checkpoints", []):
                interval = cp.get("screenplay_interval", {})
                end_scene = interval.get("end_scene_order_inclusive")
                if end_scene is None:
                    # Flag checkpoint with missing end scene
                    self.global_flags.append(
                        TimingFlag(
                            record_type="task1_checkpoint",
                            record_id=cp.get("checkpoint_id"),
                            character=norm_char,
                            reason="Checkpoint missing end_scene_order_inclusive in screenplay_interval",
                            details={"checkpoint": cp}
                        )
                    )
                    continue

                cp_record = {
                    "checkpoint_id": cp.get("checkpoint_id"),
                    "instance_id": cp.get("instance_id"),
                    "sequence_index": cp.get("sequence_index"),
                    "checkpoint_scene": end_scene,
                    "screenplay_interval": interval,
                    "current_state": cp.get("evaluation_target", {}).get("current_state", []),
                    "developments": cp.get("evaluation_target", {}).get("developments_since_previous_checkpoint", []),
                }

                self.task1_checkpoints[(norm_char, end_scene)] = cp_record
                self.all_task1_checkpoints_by_char[norm_char].append(cp_record)

    @staticmethod
    def _normalize_character_name(name: str) -> str:
        """Normalize character naming variations."""
        name_clean = name.strip()
        lower = name_clean.lower()
        if "hazel" in lower:
            return "Hazel Grace"
        if "augustus" in lower or lower == "gus":
            return "Augustus Waters"
        if "frannie" in lower:
            return "Frannie Lancaster"
        return name_clean

    def get_available_characters(self) -> list[str]:
        """Return list of characters with primary grounded role assets."""
        return sorted(list(self.primary_roles.keys()))

    def get_official_checkpoints(self, character: str) -> list[int]:
        """Return the list of official checkpoint scene numbers for a character."""
        norm_char = self._normalize_character_name(character)
        cps = self.all_task1_checkpoints_by_char.get(norm_char, [])
        return sorted([cp["checkpoint_scene"] for cp in cps])

