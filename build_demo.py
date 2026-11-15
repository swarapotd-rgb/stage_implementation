#!/usr/bin/env python3
"""
CLI script to build and export StoryLens demo checkpoints.

Usage:
    python build_demo.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add workspace root to sys.path
WORKSPACE_ROOT = Path(__file__).resolve().parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from storylens.loader import STAGELoader
from storylens.state_engine import StoryLensEngine


def main() -> None:
    raw_dir = WORKSPACE_ROOT / "input" / "STAGE" / "data" / "raw"
    output_path = WORKSPACE_ROOT / "output" / "demo_checkpoints.json"

    print("=================================================================")
    print(" StoryLens: Checkpoint Data Layer Builder")
    print("=================================================================")
    print(f"Loading raw STAGE data from: {raw_dir}")

    loader = STAGELoader(raw_data_dir=raw_dir)
    print(f"Loaded Movie: {loader.movie_metadata.get('title')}")
    print(f"Available primary grounded characters: {loader.get_available_characters()}")
    print(f"Legacy/un-grounded roles separated: {len(loader.legacy_roles)}")
    for lr in loader.legacy_roles:
        print(f"  - Excluded from primary state view: {lr['name']} ({lr['memories_count']} memories; {lr['reason_excluded'][:70]}...)")

    print("\nOfficial Task 1 Checkpoints by character:")
    for char in loader.get_available_characters():
        cps = loader.get_official_checkpoints(char)
        scoped = [c for c in cps if c <= 20]
        print(f"  - {char}: scenes {scoped} (demo scope <= 20) | full film: scenes {cps}")

    engine = StoryLensEngine(loader=loader)
    print(f"\nBuilding demo checkpoints (scope: scenes 1-20)...")
    engine.export_demo_json(output_path=output_path, max_scene=20)
    print(f"Successfully generated: {output_path}")

    # Build and export Temporal Knowledge Graph
    graph_output_path = WORKSPACE_ROOT / "output" / "temporal_knowledge_graph.json"
    print(f"Building temporal knowledge graph (scope: scenes 1-20)...")
    from storylens.graph import TemporalGraphBuilder
    graph_builder = TemporalGraphBuilder(loader=loader, engine=engine)
    graph_builder.export_graph_json(output_path=graph_output_path, max_scene=20)
    print(f"Successfully generated: {graph_output_path}")

    # Print summary
    demo_data = engine.build_demo_checkpoints(max_scene=20)
    print("\n--- Summary of Generated Checkpoints ---")
    for cp in demo_data["checkpoints"]:
        char = cp["character"]
        sc = cp["scene_order"]
        cp_id = cp["checkpoint_id"]
        interval = cp["screenplay_interval"]
        cs_count = len(cp["current_states"]) if cp["current_states"] else 0
        dev_count = len(cp["developments"]) if cp["developments"] else 0
        mem_count = cp["cumulative_memories_count"]
        pp_count = len(cp["active_persona_phases"])
        rp_count = len(cp["active_relationship_phases"])
        print(
            f"Scene {sc:02d} | {char:<15} | Checkpoint ID: {cp_id} | "
            f"Interval: ({interval['start_scene_order_exclusive']}, {interval['end_scene_order_inclusive']}] | "
            f"States: {cs_count} | Devs: {dev_count} | Memories: {mem_count} | "
            f"Persona: {pp_count} | Rels: {rp_count}"
        )

    print("\n[OK] Checkpoint data build complete. Zero Task 2 QA data was loaded.")


if __name__ == "__main__":
    main()

