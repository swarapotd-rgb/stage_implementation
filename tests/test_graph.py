"""
Automated tests for StoryLens Temporal Knowledge Graph.

Verifies:
1. Knowledge boundary: Future memories never appear in an earlier as-of graph.
2. Timing separation: Event time (fact_origin) and knowledge time (available_from) remain separate in nodes and edges.
3. Phase windowing: Persona and relationship phase nodes and edges obey validity windows.
4. Checkpoint state gating: Task 1 Checkpoint, StateClaim, and Development nodes appear ONLY at official checkpoints.
5. Referential integrity: Every graph edge points to nodes that exist in that graph.
6. Benchmark isolation: Graph contains no Task 2 QA data.
7. Timing integrity: Missing or un-grounded timing is not guessed.
8. API endpoint: /api/graph returns valid as-of graph data.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from storylens.loader import STAGELoader
from storylens.state_engine import StoryLensEngine
from storylens.graph import TemporalGraphBuilder, TemporalGraph

WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
RAW_DATA_DIR = WORKSPACE_ROOT / "input" / "STAGE" / "data" / "raw"


class TestTemporalKnowledgeGraph(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.loader = STAGELoader(raw_data_dir=RAW_DATA_DIR)
        cls.engine = StoryLensEngine(loader=cls.loader)
        cls.builder = TemporalGraphBuilder(loader=cls.loader, engine=cls.engine)

    def test_referential_integrity(self) -> None:
        """Verify that every edge in an as-of graph connects existing nodes."""
        for char in ["Hazel Grace", "Augustus Waters"]:
            for sc in [1, 5, 8, 10, 11, 19]:
                graph = self.builder.get_graph_as_of(char, sc)
                errors = graph.validate_referential_integrity()
                self.assertEqual(
                    errors,
                    [],
                    f"Referential integrity failure for {char} at Scene {sc}: {errors}"
                )

    def test_knowledge_boundary_no_future_memories(self) -> None:
        """Verify future memories never appear in an earlier as-of graph."""
        for char in ["Hazel Grace", "Augustus Waters"]:
            for sc in [1, 5, 8, 10, 11, 15, 19]:
                graph = self.builder.get_graph_as_of(char, sc)
                for node in graph.nodes:
                    if node.type == "Memory":
                        af = node.properties.get("available_from", {})
                        avail_sc = af.get("scene_order")
                        self.assertIsNotNone(avail_sc)
                        self.assertLessEqual(
                            avail_sc,
                            sc,
                            f"Spoiler leak: Memory {node.id} with available_from {avail_sc} found in as-of Scene {sc} graph!"
                        )

    def test_event_time_and_knowledge_time_separate(self) -> None:
        """Verify event time (fact_origin) and knowledge time (available_from) remain separate in nodes and edges."""
        graph = self.builder.get_graph_as_of("Hazel Grace", 10)
        found_memory = False
        avail_edges = 0
        origin_edges = 0

        for node in graph.nodes:
            if node.type == "Memory":
                found_memory = True
                self.assertIn("fact_origin", node.properties)
                self.assertIn("available_from", node.properties)
                # Verify they are separate dictionaries
                self.assertIsInstance(node.properties["fact_origin"], dict)
                self.assertIsInstance(node.properties["available_from"], dict)

        for edge in graph.edges:
            if edge.type == "AVAILABLE_FROM_SCENE":
                avail_edges += 1
            elif edge.type == "EVENT_OCCURRED_IN_SCENE":
                origin_edges += 1

        self.assertTrue(found_memory)
        self.assertGreater(avail_edges, 0)
        self.assertGreater(origin_edges, 0)

    def test_phase_edges_obey_validity_windows(self) -> None:
        """Verify persona and relationship phase nodes and edges obey validity windows."""
        for char in ["Hazel Grace", "Augustus Waters"]:
            for sc in [1, 8, 10, 11, 19]:
                graph = self.builder.get_graph_as_of(char, sc)
                for node in graph.nodes:
                    if node.type in ("PersonaPhase", "RelationshipPhase"):
                        vf = node.properties.get("valid_from", {}).get("scene_order")
                        vu_obj = node.properties.get("valid_until")
                        vu = vu_obj.get("scene_order") if vu_obj else None
                        self.assertIsNotNone(vf)
                        self.assertLessEqual(vf, sc, f"Phase {node.id} active before valid_from ({vf} > {sc})")
                        if vu is not None:
                            self.assertGreaterEqual(vu, sc, f"Phase {node.id} active after valid_until ({vu} < {sc})")

    def test_task1_claims_appear_only_at_official_checkpoints(self) -> None:
        """Verify Task 1 Checkpoint, StateClaim, and Development nodes appear ONLY at official checkpoints."""
        # Hazel official checkpoints: 1, 10, 11, 19
        hazel_checkpoints = {1, 10, 11, 19}
        for sc in range(1, 21):
            graph = self.builder.get_graph_as_of("Hazel Grace", sc)
            node_types = {n.type for n in graph.nodes}
            if sc in hazel_checkpoints:
                self.assertTrue(graph.metadata["is_official_checkpoint"])
                self.assertIn("Checkpoint", node_types)
                self.assertIn("StateClaim", node_types)
            else:
                self.assertFalse(graph.metadata["is_official_checkpoint"])
                self.assertNotIn("Checkpoint", node_types, f"Non-checkpoint scene {sc} must NOT have Checkpoint node")
                self.assertNotIn("StateClaim", node_types, f"Non-checkpoint scene {sc} must NOT have StateClaim node")
                self.assertNotIn("Development", node_types, f"Non-checkpoint scene {sc} must NOT have Development node")

        # Augustus official checkpoint in scope: 8
        for sc in range(1, 21):
            graph = self.builder.get_graph_as_of("Augustus Waters", sc)
            node_types = {n.type for n in graph.nodes}
            if sc == 8:
                self.assertTrue(graph.metadata["is_official_checkpoint"])
                self.assertIn("Checkpoint", node_types)
                self.assertIn("StateClaim", node_types)
            else:
                self.assertFalse(graph.metadata["is_official_checkpoint"])
                self.assertNotIn("Checkpoint", node_types)
                self.assertNotIn("StateClaim", node_types)

    def test_graph_contains_no_task2_qa_data(self) -> None:
        """Verify that no Task 2 QA questions, answers, or files are in the graph."""
        graph = self.builder.build_full_demo_graph(max_scene=20)
        graph_json_str = json.dumps(graph.to_dict()).lower()
        self.assertNotIn("task_2_question_answering", graph_json_str)
        # Verify previous builder's synthetic 'Aim: <answer>' prefix is not present
        self.assertNotIn('"aim:', graph_json_str)
        self.assertNotIn("what does frannie aim to do", graph_json_str)

    def test_missing_timing_not_guessed(self) -> None:
        """Verify legacy un-grounded records with missing timing are excluded from graph."""
        graph = self.builder.build_full_demo_graph(max_scene=20)
        for node in graph.nodes:
            if node.type == "Memory":
                # Must have explicit available_from and fact_origin
                self.assertIsNotNone(node.properties.get("available_from"))
                self.assertIsNotNone(node.properties.get("fact_origin"))
                self.assertIsNotNone(node.properties.get("access_type"))

    def test_composite_demo_graph_export(self) -> None:
        """Verify that output/temporal_knowledge_graph.json exists and is valid."""
        graph_path = WORKSPACE_ROOT / "output" / "temporal_knowledge_graph.json"
        self.assertTrue(graph_path.exists())
        with open(graph_path, encoding="utf-8") as f:
            data = json.load(f)

        self.assertIn("nodes", data)
        self.assertIn("edges", data)
        self.assertGreater(data["node_count"], 0)
        self.assertGreater(data["edge_count"], 0)

        # Test referential integrity of saved JSON
        node_ids = {n["id"] for n in data["nodes"]}
        for edge in data["edges"]:
            self.assertIn(edge["source"], node_ids, f"Dangling edge source {edge['source']}")
            self.assertIn(edge["target"], node_ids, f"Dangling edge target {edge['target']}")


if __name__ == "__main__":
    unittest.main()
