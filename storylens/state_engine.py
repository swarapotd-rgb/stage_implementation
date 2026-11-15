"""
Query engine for spoiler-safe narrative character state reconstruction.

Given a character and story point (scene_order), constructs the character's:
1. Cumulative epistemic memories (only memories where available_from <= scene_order)
2. Active persona phases (valid_from <= scene_order <= valid_until)
3. Active relationship phases (valid_from <= scene_order <= valid_until)
4. Task 1 official checkpoint states and developments (strictly when scene_order is an official checkpoint)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from storylens.loader import STAGELoader
from storylens.models import (
    CharacterCheckpointState,
    CurrentStateClaim,
    DevelopmentRecord,
    MemoryRecord,
    PersonaPhaseRecord,
    RelationshipPhaseRecord,
    TimingFlag,
)


class StoryLensEngine:
    """
    Core engine to query character states at any scene checkpoint.
    """

    def __init__(self, loader: STAGELoader) -> None:
        self.loader = loader

    def get_state(self, character: str, scene_order: int) -> CharacterCheckpointState:
        """
        Query a character's state at a specific scene order.

        Rules:
        - Includes only memories where available_from.scene_order <= scene_order.
        - Preserves fact_origin, available_from, access_type, and source identifiers.
        - Includes persona and relationship phases only when valid_from <= scene_order <= valid_until.
        - Missing valid_until is treated as open-ended.
        - Includes Task 1 claims/developments ONLY if scene_order is an official checkpoint.
        - Does not interpolate or invent Task 1 claims at non-checkpoint scenes.
        - Records with missing or malformed timing are flagged, not silently included.
        """
        norm_char = self.loader._normalize_character_name(character)
        role = self.loader.primary_roles.get(norm_char)

        timing_flags: list[TimingFlag] = list(self.loader.global_flags)

        if not role:
            # Character not in primary grounded roles
            flag = TimingFlag(
                record_type="character",
                record_id=None,
                character=character,
                reason=f"Character '{character}' has no primary grounded role asset in dataset.",
                details={"available_primary_characters": self.loader.get_available_characters()}
            )
            timing_flags.append(flag)
            return CharacterCheckpointState(
                character=character,
                scene_order=scene_order,
                is_official_checkpoint=False,
                timing_flags=timing_flags
            )

        role_id = role.get("role_id")

        # 1. Epistemic Memories (Strictly cumulative by available_from)
        valid_memories: list[MemoryRecord] = []
        for mem in role.get("memories", []):
            mem_id = mem.get("memory_id")
            af = mem.get("available_from")
            fo = mem.get("fact_origin")

            if not af or not isinstance(af, dict) or af.get("scene_order") is None:
                timing_flags.append(
                    TimingFlag(
                        record_type="memory",
                        record_id=mem_id,
                        character=norm_char,
                        reason="Memory missing valid available_from.scene_order timing",
                        details={"memory_id": mem_id, "available_from": af}
                    )
                )
                continue

            avail_scene = af["scene_order"]

            # Knowledge timing boundary check:
            # Character CANNOT know this memory before its available_from scene,
            # even if fact_origin occurred earlier.
            if avail_scene <= scene_order:
                valid_memories.append(
                    MemoryRecord(
                        source_file="data/raw/task_3_role_assets.json",
                        source_memory_id=mem_id,
                        source_role_id=role_id,
                        memory_text=mem.get("memory_text", ""),
                        access_type=mem.get("access_type"),
                        fact_origin=fo,
                        available_from=af,
                        grounded_facts=mem.get("grounded_facts", []) or [],
                        importance=mem.get("importance"),
                        source_evidence_ids=mem.get("source_evidence_ids", []) or [],
                        source_episode_ids=mem.get("source_episode_ids", []) or [],
                        source_fact_ids=mem.get("source_fact_ids", []) or [],
                    )
                )

        # 2. Active Persona Phases (valid_from <= scene_order <= valid_until)
        active_persona_phases: list[PersonaPhaseRecord] = []
        for phase in role.get("persona_phases", []):
            phase_id = phase.get("persona_phase_id")
            vf = phase.get("valid_from")
            vu = phase.get("valid_until")

            if not vf or not isinstance(vf, dict) or vf.get("scene_order") is None:
                timing_flags.append(
                    TimingFlag(
                        record_type="persona_phase",
                        record_id=phase_id,
                        character=norm_char,
                        reason="Persona phase missing valid valid_from.scene_order",
                        details={"phase_id": phase_id, "valid_from": vf}
                    )
                )
                continue

            vf_scene = vf["scene_order"]
            vu_scene = vu.get("scene_order") if (vu and isinstance(vu, dict)) else None

            # Window check
            if vf_scene <= scene_order and (vu_scene is None or scene_order <= vu_scene):
                active_persona_phases.append(
                    PersonaPhaseRecord(
                        source_file="data/raw/task_3_role_assets.json",
                        source_persona_phase_id=phase_id,
                        source_role_id=role_id,
                        valid_from=vf,
                        valid_until=vu,
                        traits=phase.get("traits", []) or [],
                        behavioral_constraints=phase.get("behavioral_constraints", []) or [],
                        speaking_style=phase.get("speaking_style", []) or [],
                        source_evidence_ids=phase.get("source_evidence_ids", []) or [],
                    )
                )

        # 3. Active Relationship Phases (valid_from <= scene_order <= valid_until)
        active_rel_phases: list[RelationshipPhaseRecord] = []
        for phase in role.get("relationship_phases", []):
            phase_id = phase.get("relationship_phase_id")
            vf = phase.get("valid_from")
            vu = phase.get("valid_until")

            if not vf or not isinstance(vf, dict) or vf.get("scene_order") is None:
                timing_flags.append(
                    TimingFlag(
                        record_type="relationship_phase",
                        record_id=phase_id,
                        character=norm_char,
                        reason="Relationship phase missing valid valid_from.scene_order",
                        details={"phase_id": phase_id, "valid_from": vf}
                    )
                )
                continue

            vf_scene = vf["scene_order"]
            vu_scene = vu.get("scene_order") if (vu and isinstance(vu, dict)) else None

            # Window check
            if vf_scene <= scene_order and (vu_scene is None or scene_order <= vu_scene):
                active_rel_phases.append(
                    RelationshipPhaseRecord(
                        source_file="data/raw/task_3_role_assets.json",
                        source_relationship_phase_id=phase_id,
                        source_role_id=role_id,
                        valid_from=vf,
                        valid_until=vu,
                        target=phase.get("target", "Unknown"),
                        polarity=phase.get("polarity", "neutral"),
                        description=phase.get("value", ""),
                        source_evidence_ids=phase.get("source_evidence_ids", []) or [],
                        source_state_ids=phase.get("source_state_ids", []) or [],
                        source_development_ids=phase.get("source_development_ids", []) or [],
                    )
                )

        # 4. Task 1 Checkpoint Verification
        cp_record = self.loader.task1_checkpoints.get((norm_char, scene_order))
        is_official = cp_record is not None
        checkpoint_id = None
        seq_idx = None
        interval = None
        current_states = None
        developments = None

        if is_official:
            checkpoint_id = cp_record["checkpoint_id"]
            seq_idx = cp_record["sequence_index"]
            interval = cp_record["screenplay_interval"]

            # Parse current_state claims
            current_states = []
            for cs in cp_record.get("current_state", []):
                current_states.append(
                    CurrentStateClaim(
                        source_file="data/raw/task_1_reference_state_update.json",
                        source_checkpoint_id=checkpoint_id,
                        source_instance_id=cp_record.get("instance_id"),
                        source_state_id=cs.get("state_id"),
                        claim=cs.get("claim", ""),
                        evidence_scene_orders=cs.get("evidence_scene_orders", []) or [],
                    )
                )

            # Parse developments
            developments = []
            for dev in cp_record.get("developments", []):
                developments.append(
                    DevelopmentRecord(
                        source_file="data/raw/task_1_reference_state_update.json",
                        source_checkpoint_id=checkpoint_id,
                        source_instance_id=cp_record.get("instance_id"),
                        source_development_id=dev.get("development_id"),
                        claim=dev.get("claim", ""),
                        evidence_scene_orders=dev.get("evidence_scene_orders", []) or [],
                    )
                )

        return CharacterCheckpointState(
            character=norm_char,
            scene_order=scene_order,
            is_official_checkpoint=is_official,
            checkpoint_id=checkpoint_id,
            checkpoint_sequence_index=seq_idx,
            screenplay_interval=interval,
            current_states=current_states,
            developments=developments,
            cumulative_memories=valid_memories,
            active_persona_phases=active_persona_phases,
            active_relationship_phases=active_rel_phases,
            timing_flags=timing_flags,
        )

    def build_demo_checkpoints(self, max_scene: int = 20) -> dict[str, Any]:
        """
        Build full dataset for official checkpoints within max_scene.
        For The Fault in Our Stars (scenes 1-20):
        - Hazel Grace: scenes 1, 10, 11, 19
        - Augustus Waters: scene 8
        """
        output: dict[str, Any] = {
            "movie": self.loader.movie_metadata.get("title", "The Fault in Our Stars (film)"),
            "movie_id": self.loader.movie_metadata.get("movie_id", "en3f51f126ac684887812de45cc7f2c35e"),
            "release_year": self.loader.movie_metadata.get("release_year", "2014"),
            "total_screenplay_scenes": int(self.loader.movie_metadata.get("num_scenes", 107)),
            "demo_scene_scope": max_scene,
            "description": (
                "StoryLens spoiler-safe checkpoint-state layer generated from official STAGE benchmark assets. "
                "Preserves exact character knowledge boundaries, epistemic access types, active persona/relationship "
                "windows, and Task 1 checkpoint state ledgers. Does NOT interpolate non-checkpoint scenes or use Task 2 QA data."
            ),
            "source_provenance": {
                "benchmark": "STAGE (arXiv:2601.08510)",
                "used_files": [
                    "data/raw/task_1_reference_state_update.json",
                    "data/raw/task_3_role_assets.json",
                    "data/raw/info.json",
                    "data/raw/movie_metadata.json"
                ],
                "excluded_files": [
                    {
                        "file": "data/raw/task_2_question_answering.csv",
                        "reason": "Reserved strictly for independent evaluation; excluded to prevent benchmark answer contamination."
                    }
                ],
                "role_selection_notes": (
                    "Selected primary grounded role assets by canonical_name ('Hazel Grace', 'Augustus Waters') "
                    "with verified role_ids and grounded facts. Legacy un-grounded role cards (Roles 2, 3, 4) lack "
                    "fact_origin, access_type, and persona phases and are excluded from the grounded view."
                )
            },
            "characters": self.loader.get_available_characters(),
            "checkpoints": []
        }

        # Collect official checkpoints within scope for all primary characters
        for char in self.loader.get_available_characters():
            all_cp_scenes = self.loader.get_official_checkpoints(char)
            scoped_cp_scenes = [sc for sc in all_cp_scenes if sc <= max_scene]

            for sc in scoped_cp_scenes:
                state = self.get_state(char, sc)
                output["checkpoints"].append(state.to_dict())

        # Sort checkpoints by scene_order, then character
        output["checkpoints"].sort(key=lambda cp: (cp["scene_order"], cp["character"]))
        output["total_demo_checkpoints"] = len(output["checkpoints"])
        return output

    def get_graph_as_of(self, character: str, scene_order: int, max_scope: int = 20) -> Any:
        """
        Query the temporal knowledge graph for a character as of a specific scene.
        Guarantees that the graph and state engine cannot disagree.
        """
        from storylens.graph import TemporalGraphBuilder
        builder = TemporalGraphBuilder(loader=self.loader, engine=self)
        return builder.get_graph_as_of(character=character, scene_order=scene_order, max_scope=max_scope)

    def export_demo_json(self, output_path: Path | str, max_scene: int = 20) -> None:
        """Export demo checkpoints to JSON."""
        out_file = Path(output_path)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        data = self.build_demo_checkpoints(max_scene=max_scene)
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

