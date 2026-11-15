"""
Automated unit tests for StoryLens checkpoint-state layer.

Verifies:
1. Knowledge boundary: No memory returned has available_from > selected scene.
2. Timing distinction: fact_origin and available_from are distinct and preserved.
3. Temporal phase validity: Persona and relationship phases are active only when valid_from <= scene <= valid_until.
4. Task 1 checkpoints: Claims and developments appear only at official checkpoints. Non-checkpoint scenes do not interpolate.
5. Task 2 isolation: Task 2 QA data is never loaded or referenced.
6. Timing flags: Missing/malformed timing is explicitly flagged, never guessed.
7. Cumulative knowledge: Memory count is monotonically non-decreasing over story progression.
8. Source provenance: Source file and record IDs are preserved on all generated objects.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from storylens.loader import STAGELoader
from storylens.models import CharacterCheckpointState
from storylens.state_engine import StoryLensEngine

WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
RAW_DATA_DIR = WORKSPACE_ROOT / "input" / "STAGE" / "data" / "raw"


class TestStoryLensCheckpointLayer(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.loader = STAGELoader(raw_data_dir=RAW_DATA_DIR)
        cls.engine = StoryLensEngine(loader=cls.loader)

    def test_task2_qa_data_is_never_loaded(self) -> None:
        """Verify Task 2 question-answering data is nowhere in the loader or engine."""
        # Ensure loader has no QA attribute or data
        self.assertFalse(hasattr(self.loader, "qa_data"))
        self.assertFalse(hasattr(self.loader, "qa_by_scene"))

        # Inspect source code of loader to guarantee no loading of QA CSV
        loader_code = Path(WORKSPACE_ROOT / "storylens" / "loader.py").read_text(encoding="utf-8")
        self.assertNotIn("task_2_question_answering", loader_code)
        self.assertNotIn("csv.DictReader", loader_code)
        self.assertNotIn("csv.reader", loader_code)

        # Verify engine metadata explicitly flags task_2 as excluded
        demo_data = self.engine.build_demo_checkpoints(max_scene=20)
        excluded = [e["file"] for e in demo_data["source_provenance"]["excluded_files"]]
        self.assertTrue(any("task_2" in f for f in excluded))

    def test_knowledge_boundary_no_future_memories(self) -> None:
        """Verify that no memory has available_from.scene_order > selected scene."""
        for char in ["Hazel Grace", "Augustus Waters"]:
            for sc in [1, 5, 8, 10, 11, 15, 19, 20]:
                state = self.engine.get_state(char, sc)
                for mem in state.cumulative_memories:
                    avail_scene = mem.available_from["scene_order"]
                    self.assertLessEqual(
                        avail_scene,
                        sc,
                        f"Spoiler leak: Memory {mem.source_memory_id} available at scene {avail_scene} appeared at scene {sc}!"
                    )

    def test_distinguishes_fact_origin_from_available_from(self) -> None:
        """Verify fact_origin (event time) and available_from (knowledge time) are distinct and preserved."""
        # Hazel Grace at scene 10
        state = self.engine.get_state("Hazel Grace", 10)
        self.assertGreater(len(state.cumulative_memories), 0)

        found_indirect = False
        for mem in state.cumulative_memories:
            # Check fields exist
            self.assertIsNotNone(mem.available_from)
            self.assertIn("scene_order", mem.available_from)
            self.assertIn("char_end", mem.available_from)

            # fact_origin is preserved as an independent object
            self.assertIsNotNone(mem.fact_origin)
            self.assertIn("scene_order", mem.fact_origin)

            if mem.access_type in ["told", "inferred"]:
                found_indirect = True

        self.assertTrue(found_indirect, "Should contain indirect epistemic memories (told/inferred).")

    def test_phase_validity_window(self) -> None:
        """Verify persona and relationship phases are active only when valid_from <= scene <= valid_until."""
        for char in ["Hazel Grace", "Augustus Waters"]:
            for sc in [1, 8, 10, 11, 19]:
                state = self.engine.get_state(char, sc)

                # Check persona phases
                for pp in state.active_persona_phases:
                    vf = pp.valid_from["scene_order"]
                    vu = pp.valid_until["scene_order"] if pp.valid_until else None
                    self.assertLessEqual(vf, sc, f"Persona phase active before valid_from ({vf} > {sc})")
                    if vu is not None:
                        self.assertGreaterEqual(vu, sc, f"Persona phase active after valid_until ({vu} < {sc})")

                # Check relationship phases
                for rp in state.active_relationship_phases:
                    vf = rp.valid_from["scene_order"]
                    vu = rp.valid_until["scene_order"] if rp.valid_until else None
                    self.assertLessEqual(vf, sc, f"Relationship phase active before valid_from ({vf} > {sc})")
                    if vu is not None:
                        self.assertGreaterEqual(vu, sc, f"Relationship phase active after valid_until ({vu} < {sc})")

    def test_task1_claims_appear_only_at_official_checkpoints(self) -> None:
        """Verify Task 1 state claims appear ONLY at official checkpoints, never interpolated at non-checkpoints."""
        # Hazel official checkpoints: scenes 1, 10, 11, 19
        hazel_official = {1, 10, 11, 19}
        for sc in range(1, 21):
            state = self.engine.get_state("Hazel Grace", sc)
            if sc in hazel_official:
                self.assertTrue(state.is_official_checkpoint, f"Scene {sc} should be official checkpoint for Hazel")
                self.assertIsNotNone(state.current_states, f"Scene {sc} must contain current_states")
                self.assertIsNotNone(state.developments, f"Scene {sc} must contain developments list")
                self.assertIsNotNone(state.checkpoint_id)
            else:
                self.assertFalse(state.is_official_checkpoint, f"Scene {sc} should NOT be official checkpoint for Hazel")
                self.assertIsNone(state.current_states, f"Non-checkpoint scene {sc} must NOT have current_states")
                self.assertIsNone(state.developments, f"Non-checkpoint scene {sc} must NOT have developments")
                self.assertIsNone(state.checkpoint_id)

        # Augustus official checkpoint in scope: scene 8
        augustus_official = {8}
        for sc in range(1, 21):
            state = self.engine.get_state("Augustus Waters", sc)
            if sc in augustus_official:
                self.assertTrue(state.is_official_checkpoint, f"Scene {sc} should be official checkpoint for Augustus")
                self.assertIsNotNone(state.current_states)
                self.assertEqual(state.checkpoint_id, "checkpoint-c3ff49d6c914d36c152a")
            else:
                self.assertFalse(state.is_official_checkpoint, f"Scene {sc} should NOT be official checkpoint for Augustus")
                self.assertIsNone(state.current_states)
                self.assertIsNone(state.developments)

    def test_missing_or_malformed_timing_is_flagged(self) -> None:
        """Verify that malformed or legacy un-grounded records are flagged rather than guessed."""
        # Query an unknown character
        state = self.engine.get_state("Unknown Character", 5)
        self.assertFalse(state.is_official_checkpoint)
        self.assertGreater(len(state.timing_flags), 0)
        self.assertTrue(any("Unknown Character" in f.reason for f in state.timing_flags))

        # Check that legacy roles are recorded with explicit reason
        self.assertGreater(len(self.loader.legacy_roles), 0)
        for lr in self.loader.legacy_roles:
            self.assertIn("missing", lr["reason_excluded"])

    def test_knowledge_is_cumulative(self) -> None:
        """Verify that cumulative memories are non-decreasing as scenes advance."""
        for char in ["Hazel Grace", "Augustus Waters"]:
            prev_count = 0
            for sc in range(1, 21):
                state = self.engine.get_state(char, sc)
                count = state.to_dict()["cumulative_memories_count"]
                self.assertGreaterEqual(
                    count,
                    prev_count,
                    f"Memory count decreased from {prev_count} to {count} at scene {sc} for {char}!"
                )
                prev_count = count

    def test_source_provenance_preserved_on_all_entities(self) -> None:
        """Verify that source_file and source record identifiers are preserved on all items."""
        state = self.engine.get_state("Hazel Grace", 10)

        # Current state claims
        for cs in state.current_states:
            self.assertEqual(cs.source_file, "data/raw/task_1_reference_state_update.json")
            self.assertIsNotNone(cs.source_checkpoint_id)
            self.assertIsNotNone(cs.source_state_id)

        # Developments
        for dev in state.developments:
            self.assertEqual(dev.source_file, "data/raw/task_1_reference_state_update.json")
            self.assertIsNotNone(dev.source_checkpoint_id)
            self.assertIsNotNone(dev.source_development_id)

        # Memories
        for mem in state.cumulative_memories:
            self.assertEqual(mem.source_file, "data/raw/task_3_role_assets.json")
            self.assertIsNotNone(mem.source_memory_id)
            self.assertIsNotNone(mem.source_role_id)

        # Persona phases
        for pp in state.active_persona_phases:
            self.assertEqual(pp.source_file, "data/raw/task_3_role_assets.json")
            self.assertIsNotNone(pp.source_persona_phase_id)
            self.assertIsNotNone(pp.source_role_id)

        # Relationship phases
        for rp in state.active_relationship_phases:
            self.assertEqual(rp.source_file, "data/raw/task_3_role_assets.json")
            self.assertIsNotNone(rp.source_relationship_phase_id)
            self.assertIsNotNone(rp.source_role_id)


if __name__ == "__main__":
    unittest.main()
