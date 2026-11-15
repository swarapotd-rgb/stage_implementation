"""
Temporal Knowledge Graph representation for StoryLens.

Constructs and queries connected story elements (Story, Scenes, Characters,
Memories, Facts, Checkpoints, State Claims, Developments, Persona Phases,
Relationship Phases) strictly bounded by story time and epistemic availability.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from storylens.loader import STAGELoader
from storylens.models import CharacterCheckpointState
from storylens.state_engine import StoryLensEngine


@dataclass
class GraphNode:
    """Represents a discrete narrative element in the temporal knowledge graph."""
    id: str
    type: str  # Story, Scene, Character, Memory, Fact, StateClaim, Development, PersonaPhase, RelationshipPhase, Checkpoint, Entity
    label: str
    properties: dict[str, Any] = field(default_factory=dict)
    source_file: Optional[str] = None
    source_record_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "label": self.label,
            "properties": self.properties,
            "source_file": self.source_file,
            "source_record_id": self.source_record_id,
        }


@dataclass
class GraphEdge:
    """Represents a typed, directed, provenance-bearing relationship between two graph nodes."""
    id: str
    source: str
    target: str
    type: str  # e.g., CONTAINS_SCENE, FOLLOWS_SCENE, APPEARS_IN, HAS_MEMORY, GROUNDED_IN_FACT, AVAILABLE_FROM_SCENE, EVENT_OCCURRED_IN_SCENE, etc.
    properties: dict[str, Any] = field(default_factory=dict)
    source_file: Optional[str] = None
    source_record_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "properties": self.properties,
            "source_file": self.source_file,
            "source_record_id": self.source_record_id,
        }


@dataclass
class TemporalGraph:
    """A self-contained graph structure containing verified nodes and edges."""
    metadata: dict[str, Any]
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        return len(self.edges)

    def to_dict(self) -> dict[str, Any]:
        return {
            "metadata": self.metadata,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
        }

    def validate_referential_integrity(self) -> list[str]:
        """Verify that every edge points to nodes that exist in this graph."""
        node_ids = {n.id for n in self.nodes}
        errors: list[str] = []
        for edge in self.edges:
            if edge.source not in node_ids:
                errors.append(f"Dangling edge '{edge.id}': source '{edge.source}' not found in nodes.")
            if edge.target not in node_ids:
                errors.append(f"Dangling edge '{edge.id}': target '{edge.target}' not found in nodes.")
        return errors


class TemporalGraphBuilder:
    """
    Builds temporal knowledge graphs from STAGE annotations and executes as-of queries.
    Reuses StoryLensEngine to guarantee state-level consistency.
    """

    def __init__(self, loader: STAGELoader, engine: Optional[StoryLensEngine] = None) -> None:
        self.loader = loader
        self.engine = engine or StoryLensEngine(loader=loader)

    @staticmethod
    def _char_node_id(character_name: str) -> str:
        """Generate a canonical node ID for a character."""
        norm = STAGELoader._normalize_character_name(character_name)
        slug = norm.lower().replace(" ", "_")
        return f"character:{slug}"

    @staticmethod
    def _entity_node_id(entity_name: str) -> str:
        """Generate a canonical node ID for an entity or target."""
        norm = STAGELoader._normalize_character_name(entity_name)
        if norm in ("Hazel Grace", "Augustus Waters"):
            return TemporalGraphBuilder._char_node_id(norm)
        slug = entity_name.lower().replace(" ", "_").replace("'", "").replace(".", "")
        return f"entity:{slug}"

    @staticmethod
    def _scene_node_id(scene_order: int) -> str:
        return f"scene:{scene_order}"

    def get_graph_as_of(self, character: str, scene_order: int, max_scope: int = 20) -> TemporalGraph:
        """
        Construct the temporal knowledge graph for a character as of a specific scene.

        Strict Temporal Rules Enforced:
        1. Only scenes 1..min(scene_order, max_scope) are visible.
        2. Memories are included ONLY if available_from.scene_order <= scene_order.
        3. Persona and relationship phases are included ONLY if active at scene_order.
        4. Task 1 Checkpoint, State claims, and Developments are included ONLY if scene_order
           is an official Task 1 checkpoint for this character.
        5. Zero Task 2 QA data is included.
        6. Missing timing is flagged and excluded from valid nodes.
        7. Referential integrity is strictly guaranteed.
        """
        norm_char = STAGELoader._normalize_character_name(character)
        effective_scene = min(scene_order, max_scope)

        # 1. Fetch exact verified character state snapshot from the engine
        state: CharacterCheckpointState = self.engine.get_state(norm_char, effective_scene)

        nodes_by_id: dict[str, GraphNode] = {}
        edges: list[GraphEdge] = []
        edge_id_counter = 1

        def add_node(node: GraphNode) -> None:
            if node.id not in nodes_by_id:
                nodes_by_id[node.id] = node

        def add_edge(source_id: str, target_id: str, edge_type: str, props: Optional[dict[str, Any]] = None,
                     src_file: Optional[str] = None, src_rec: Optional[str] = None) -> None:
            nonlocal edge_id_counter
            edge_id = f"edge:{edge_id_counter}"
            edge_id_counter += 1
            edges.append(
                GraphEdge(
                    id=edge_id,
                    source=source_id,
                    target=target_id,
                    type=edge_type,
                    properties=props or {},
                    source_file=src_file,
                    source_record_id=src_rec,
                )
            )

        # --- A. Story Node ---
        story_id = f"story:{self.loader.movie_metadata.get('movie_id', 'the_fault_in_our_stars')}"
        add_node(
            GraphNode(
                id=story_id,
                type="Story",
                label=self.loader.movie_metadata.get("title", "The Fault in Our Stars (film)"),
                properties={
                    "movie_id": self.loader.movie_metadata.get("movie_id"),
                    "release_year": self.loader.movie_metadata.get("release_year"),
                    "total_scenes": int(self.loader.movie_metadata.get("num_scenes", 107)),
                    "genres": self.loader.movie_info.get("genres", []),
                },
                source_file="data/raw/info.json",
                source_record_id=self.loader.movie_metadata.get("movie_id"),
            )
        )

        # --- B. Scene Nodes (1 .. effective_scene) & Temporal Sequence Edges ---
        for sc in range(1, effective_scene + 1):
            sc_id = self._scene_node_id(sc)
            add_node(
                GraphNode(
                    id=sc_id,
                    type="Scene",
                    label=f"Scene {sc}",
                    properties={"scene_order": sc},
                    source_file="data/raw/info.json",
                    source_record_id=f"scene_{sc}",
                )
            )
            # Story contains Scene
            add_edge(story_id, sc_id, "CONTAINS_SCENE", src_file="data/raw/info.json")

            # Sequential scene progression: Scene(s) follows Scene(s-1)
            if sc > 1:
                prev_sc_id = self._scene_node_id(sc - 1)
                add_edge(sc_id, prev_sc_id, "FOLLOWS_SCENE", props={"scene_order": sc, "previous_scene_order": sc - 1})

        # --- C. Focal Character Node ---
        focal_char_id = self._char_node_id(norm_char)
        role = self.loader.primary_roles.get(norm_char, {})
        add_node(
            GraphNode(
                id=focal_char_id,
                type="Character",
                label=norm_char,
                properties={"canonical_name": norm_char, "role_id": role.get("role_id")},
                source_file="data/raw/task_3_role_assets.json",
                source_record_id=role.get("role_id"),
            )
        )

        # Track character appearances in scenes
        # Physical presence is supported when character witnesses or participates in an event in that scene
        scenes_present: set[int] = set()

        # --- D. Epistemic Memories & Grounded Facts ---
        for mem in state.cumulative_memories:
            mem_node_id = f"memory:{mem.source_memory_id}"
            origin_scene = mem.fact_origin.get("scene_order") if mem.fact_origin else None
            avail_scene = mem.available_from.get("scene_order")

            # Record appearance if witnessed or involved
            if mem.access_type in ("witnessed", "involved") and origin_scene and origin_scene <= effective_scene:
                scenes_present.add(origin_scene)
            if avail_scene and avail_scene <= effective_scene and mem.access_type in ("witnessed", "involved"):
                scenes_present.add(avail_scene)

            add_node(
                GraphNode(
                    id=mem_node_id,
                    type="Memory",
                    label=f"Memory: {mem.memory_text[:45]}...",
                    properties={
                        "memory_text": mem.memory_text,
                        "access_type": mem.access_type,
                        "fact_origin": mem.fact_origin,
                        "available_from": mem.available_from,
                        "importance": mem.importance,
                    },
                    source_file=mem.source_file,
                    source_record_id=mem.source_memory_id,
                )
            )

            # Character HAS_MEMORY Memory
            add_edge(focal_char_id, mem_node_id, "HAS_MEMORY", src_file=mem.source_file, src_rec=mem.source_memory_id)

            # Memory AVAILABLE_FROM_SCENE Scene
            if avail_scene and avail_scene <= effective_scene:
                add_edge(mem_node_id, self._scene_node_id(avail_scene), "AVAILABLE_FROM_SCENE",
                         props={"char_end": mem.available_from.get("char_end")},
                         src_file=mem.source_file, src_rec=mem.source_memory_id)

            # Memory EVENT_OCCURRED_IN_SCENE Scene
            if origin_scene and origin_scene <= effective_scene:
                add_edge(mem_node_id, self._scene_node_id(origin_scene), "EVENT_OCCURRED_IN_SCENE",
                         props={"scene_id": mem.fact_origin.get("scene_id")},
                         src_file=mem.source_file, src_rec=mem.source_memory_id)

            # Grounded Facts
            for idx, fact_str in enumerate(mem.grounded_facts):
                fact_node_id = f"fact:{mem.source_memory_id}:{idx}"
                add_node(
                    GraphNode(
                        id=fact_node_id,
                        type="Fact",
                        label=f"Fact: {fact_str[:40]}...",
                        properties={
                            "fact_text": fact_str,
                            "fact_origin": mem.fact_origin,
                            "access_type": mem.access_type,
                        },
                        source_file=mem.source_file,
                        source_record_id=mem.source_memory_id,
                    )
                )
                # Memory GROUNDED_IN_FACT Fact
                add_edge(mem_node_id, fact_node_id, "GROUNDED_IN_FACT", src_file=mem.source_file, src_rec=mem.source_memory_id)

                # Fact EVENT_OCCURRED_IN_SCENE Scene
                if origin_scene and origin_scene <= effective_scene:
                    add_edge(fact_node_id, self._scene_node_id(origin_scene), "EVENT_OCCURRED_IN_SCENE",
                             src_file=mem.source_file, src_rec=mem.source_memory_id)

        # Add APPEARS_IN edges for supported presence
        for sc in sorted(scenes_present):
            if sc <= effective_scene:
                add_edge(focal_char_id, self._scene_node_id(sc), "APPEARS_IN",
                         props={"evidence": "derived from witnessed/involved memories"})

        # --- E. Active Persona Phases ---
        for phase in state.active_persona_phases:
            phase_node_id = f"persona_phase:{phase.source_persona_phase_id}"
            add_node(
                GraphNode(
                    id=phase_node_id,
                    type="PersonaPhase",
                    label=f"Persona Phase ({phase.source_persona_phase_id})",
                    properties={
                        "valid_from": phase.valid_from,
                        "valid_until": phase.valid_until,
                        "traits": phase.traits,
                        "behavioral_constraints": phase.behavioral_constraints,
                        "speaking_style": phase.speaking_style,
                    },
                    source_file=phase.source_file,
                    source_record_id=phase.source_persona_phase_id,
                )
            )
            # Character HAS_PERSONA_PHASE PersonaPhase
            add_edge(focal_char_id, phase_node_id, "HAS_PERSONA_PHASE",
                     src_file=phase.source_file, src_rec=phase.source_persona_phase_id)

            # PersonaPhase APPLIES_TO_SCENE Current Scene
            add_edge(phase_node_id, self._scene_node_id(effective_scene), "APPLIES_TO_SCENE",
                     props={"valid_from_scene": phase.valid_from.get("scene_order"),
                            "valid_until_scene": phase.valid_until.get("scene_order") if phase.valid_until else None},
                     src_file=phase.source_file, src_rec=phase.source_persona_phase_id)

        # --- F. Active Relationship Phases ---
        for rphase in state.active_relationship_phases:
            rphase_node_id = f"rel_phase:{rphase.source_relationship_phase_id}"
            add_node(
                GraphNode(
                    id=rphase_node_id,
                    type="RelationshipPhase",
                    label=f"Relationship &rarr; {rphase.target} ({rphase.polarity})",
                    properties={
                        "target": rphase.target,
                        "polarity": rphase.polarity,
                        "description": rphase.description,
                        "valid_from": rphase.valid_from,
                        "valid_until": rphase.valid_until,
                    },
                    source_file=rphase.source_file,
                    source_record_id=rphase.source_relationship_phase_id,
                )
            )

            # Character HAS_RELATIONSHIP_PHASE RelationshipPhase
            add_edge(focal_char_id, rphase_node_id, "HAS_RELATIONSHIP_PHASE",
                     src_file=rphase.source_file, src_rec=rphase.source_relationship_phase_id)

            # RelationshipPhase APPLIES_TO_SCENE Current Scene
            add_edge(rphase_node_id, self._scene_node_id(effective_scene), "APPLIES_TO_SCENE",
                     src_file=rphase.source_file, src_rec=rphase.source_relationship_phase_id)

            # Target Entity/Character Node
            target_id = self._entity_node_id(rphase.target)
            is_char = target_id.startswith("character:")
            add_node(
                GraphNode(
                    id=target_id,
                    type="Character" if is_char else "Entity",
                    label=rphase.target,
                    properties={"name": rphase.target},
                    source_file=rphase.source_file,
                    source_record_id=rphase.source_relationship_phase_id,
                )
            )
            # RelationshipPhase RELATIONSHIP_WITH Target
            add_edge(rphase_node_id, target_id, "RELATIONSHIP_WITH",
                     props={"polarity": rphase.polarity},
                     src_file=rphase.source_file, src_rec=rphase.source_relationship_phase_id)

        # --- G. Task 1 Checkpoint, Current States & Developments ---
        # Strictly included ONLY when this scene is an official checkpoint
        if state.is_official_checkpoint and state.checkpoint_id:
            cp_node_id = f"checkpoint:{state.checkpoint_id}"
            add_node(
                GraphNode(
                    id=cp_node_id,
                    type="Checkpoint",
                    label=f"Checkpoint {state.checkpoint_sequence_index} (Scene {effective_scene})",
                    properties={
                        "checkpoint_id": state.checkpoint_id,
                        "sequence_index": state.checkpoint_sequence_index,
                        "screenplay_interval": state.screenplay_interval,
                        "scene_order": effective_scene,
                        "character": norm_char,
                    },
                    source_file="data/raw/task_1_reference_state_update.json",
                    source_record_id=state.checkpoint_id,
                )
            )

            # Checkpoint CHECKPOINT_RECORDED_FOR Character
            add_edge(cp_node_id, focal_char_id, "CHECKPOINT_RECORDED_FOR",
                     src_file="data/raw/task_1_reference_state_update.json", src_rec=state.checkpoint_id)

            # Checkpoint CHECKPOINT_ANCHORED_AT Scene
            add_edge(cp_node_id, self._scene_node_id(effective_scene), "CHECKPOINT_ANCHORED_AT",
                     src_file="data/raw/task_1_reference_state_update.json", src_rec=state.checkpoint_id)

            # Current State Claims
            for cs in (state.current_states or []):
                claim_node_id = f"claim:{cs.source_state_id or cs.source_checkpoint_id}"
                add_node(
                    GraphNode(
                        id=claim_node_id,
                        type="StateClaim",
                        label=f"State Claim: {cs.claim[:40]}...",
                        properties={
                            "claim": cs.claim,
                            "evidence_scene_orders": cs.evidence_scene_orders,
                            "checkpoint_id": cs.source_checkpoint_id,
                        },
                        source_file=cs.source_file,
                        source_record_id=cs.source_state_id,
                    )
                )

                # Checkpoint EVALUATES_STATE_CLAIM StateClaim
                add_edge(cp_node_id, claim_node_id, "EVALUATES_STATE_CLAIM",
                         src_file=cs.source_file, src_rec=cs.source_state_id)

                # StateClaim SUPPORTED_BY_SCENE Scene
                for ev_scene in cs.evidence_scene_orders:
                    if ev_scene <= effective_scene:
                        add_edge(claim_node_id, self._scene_node_id(ev_scene), "SUPPORTED_BY_SCENE",
                                 src_file=cs.source_file, src_rec=cs.source_state_id)

            # Developments
            for dev in (state.developments or []):
                dev_node_id = f"development:{dev.source_development_id or dev.source_checkpoint_id}"
                add_node(
                    GraphNode(
                        id=dev_node_id,
                        type="Development",
                        label=f"Development: {dev.claim[:40]}...",
                        properties={
                            "claim": dev.claim,
                            "evidence_scene_orders": dev.evidence_scene_orders,
                            "checkpoint_id": dev.source_checkpoint_id,
                        },
                        source_file=dev.source_file,
                        source_record_id=dev.source_development_id,
                    )
                )

                # Checkpoint RECORDS_DEVELOPMENT Development
                add_edge(cp_node_id, dev_node_id, "RECORDS_DEVELOPMENT",
                         src_file=dev.source_file, src_rec=dev.source_development_id)

                # Development SUPPORTED_BY_SCENE Scene
                for ev_scene in dev.evidence_scene_orders:
                    if ev_scene <= effective_scene:
                        add_edge(dev_node_id, self._scene_node_id(ev_scene), "SUPPORTED_BY_SCENE",
                                 src_file=dev.source_file, src_rec=dev.source_development_id)

        # Assemble graph
        metadata = {
            "query_character": norm_char,
            "as_of_scene": effective_scene,
            "is_official_checkpoint": state.is_official_checkpoint,
            "checkpoint_id": state.checkpoint_id,
            "benchmark": "STAGE (arXiv:2601.08510)",
            "spoiler_safety": f"Strictly bounded to information available on or before Scene {effective_scene}",
            "temporal_constraints": {
                "max_scene_visible": effective_scene,
                "memories_available_cutoff": effective_scene,
                "task1_state_included": state.is_official_checkpoint,
            },
        }

        graph = TemporalGraph(
            metadata=metadata,
            nodes=list(nodes_by_id.values()),
            edges=edges,
        )

        # Verify referential integrity
        integrity_errors = graph.validate_referential_integrity()
        if integrity_errors:
            raise ValueError(f"Referential integrity failure in temporal graph: {integrity_errors}")

        return graph

    def build_full_demo_graph(self, max_scene: int = 20) -> TemporalGraph:
        """
        Build a composite demo graph covering all official checkpoints and scenes up to max_scene.
        """
        nodes_by_id: dict[str, GraphNode] = {}
        edges_by_id: dict[str, GraphEdge] = {}

        # Merge subgraphs for all official checkpoints within scope
        for char in self.loader.get_available_characters():
            for sc in self.loader.get_official_checkpoints(char):
                if sc <= max_scene:
                    subgraph = self.get_graph_as_of(char, sc, max_scope=max_scene)
                    for n in subgraph.nodes:
                        nodes_by_id[n.id] = n
                    for e in subgraph.edges:
                        # Edge key can be source + type + target
                        key = f"{e.source}|{e.type}|{e.target}"
                        edges_by_id[key] = e

        metadata = {
            "movie": self.loader.movie_metadata.get("title", "The Fault in Our Stars (film)"),
            "movie_id": self.loader.movie_metadata.get("movie_id"),
            "demo_scene_scope": max_scene,
            "description": "Composite temporal knowledge graph across Scenes 1-20 official checkpoints.",
            "benchmark": "STAGE (arXiv:2601.08510)",
        }

        full_graph = TemporalGraph(
            metadata=metadata,
            nodes=list(nodes_by_id.values()),
            edges=list(edges_by_id.values()),
        )

        integrity_errors = full_graph.validate_referential_integrity()
        if integrity_errors:
            raise ValueError(f"Referential integrity failure in composite graph: {integrity_errors}")

        return full_graph

    def export_graph_json(self, output_path: Path | str, max_scene: int = 20) -> None:
        """Export composite temporal knowledge graph to JSON."""
        out_file = Path(output_path)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        graph = self.build_full_demo_graph(max_scene=max_scene)
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(graph.to_dict(), f, indent=2, ensure_ascii=False)
