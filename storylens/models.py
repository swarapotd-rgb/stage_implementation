"""
Data models and typed structures for StoryLens narrative state representations.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class TimingFlag:
    """Flags a record that has missing, null, or malformed timing."""
    record_type: str
    record_id: Optional[str]
    character: str
    reason: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MemoryRecord:
    """Represents a character's epistemic memory with strict provenance and timing."""
    source_file: str
    source_memory_id: Optional[str]
    source_role_id: Optional[str]
    memory_text: str
    access_type: Optional[str]  # witnessed, involved, told, inferred
    fact_origin: Optional[dict[str, Any]]  # {'scene_order': int, 'scene_id': str}
    available_from: dict[str, Any]  # {'scene_order': int, 'char_end': int}
    grounded_facts: list[str] = field(default_factory=list)
    importance: Optional[str] = None
    source_evidence_ids: list[str] = field(default_factory=list)
    source_episode_ids: list[str] = field(default_factory=list)
    source_fact_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PersonaPhaseRecord:
    """Represents active personality traits and constraints within a validity window."""
    source_file: str
    source_persona_phase_id: Optional[str]
    source_role_id: Optional[str]
    valid_from: dict[str, Any]  # {'scene_order': int, 'char_end': int}
    valid_until: Optional[dict[str, Any]]  # None if open-ended
    traits: list[str] = field(default_factory=list)
    behavioral_constraints: list[str] = field(default_factory=list)
    speaking_style: list[str] = field(default_factory=list)
    source_evidence_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RelationshipPhaseRecord:
    """Represents an active relationship stance toward another character in a window."""
    source_file: str
    source_relationship_phase_id: Optional[str]
    source_role_id: Optional[str]
    valid_from: dict[str, Any]  # {'scene_order': int, 'char_end': int}
    valid_until: Optional[dict[str, Any]]  # None if open-ended
    target: str
    polarity: str  # positive, negative, mixed, neutral
    description: str
    source_evidence_ids: list[str] = field(default_factory=list)
    source_state_ids: list[str] = field(default_factory=list)
    source_development_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CurrentStateClaim:
    """Represents a verified Task 1 current-state claim at an official checkpoint."""
    source_file: str
    source_checkpoint_id: str
    source_instance_id: Optional[str]
    source_state_id: Optional[str]
    claim: str
    evidence_scene_orders: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DevelopmentRecord:
    """Represents a verified Task 1 state transition between adjacent checkpoints."""
    source_file: str
    source_checkpoint_id: str
    source_instance_id: Optional[str]
    source_development_id: Optional[str]
    claim: str
    evidence_scene_orders: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CharacterCheckpointState:
    """
    Complete state snapshot for a character at a specified scene / checkpoint.
    """
    character: str
    scene_order: int
    is_official_checkpoint: bool
    checkpoint_id: Optional[str] = None
    checkpoint_sequence_index: Optional[int] = None
    screenplay_interval: Optional[dict[str, Any]] = None
    current_states: Optional[list[CurrentStateClaim]] = None
    developments: Optional[list[DevelopmentRecord]] = None
    cumulative_memories: list[MemoryRecord] = field(default_factory=list)
    active_persona_phases: list[PersonaPhaseRecord] = field(default_factory=list)
    active_relationship_phases: list[RelationshipPhaseRecord] = field(default_factory=list)
    timing_flags: list[TimingFlag] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "character": self.character,
            "scene_order": self.scene_order,
            "is_official_checkpoint": self.is_official_checkpoint,
            "checkpoint_id": self.checkpoint_id,
            "checkpoint_sequence_index": self.checkpoint_sequence_index,
            "screenplay_interval": self.screenplay_interval,
            "current_states": [c.to_dict() for c in self.current_states] if self.current_states is not None else None,
            "developments": [d.to_dict() for d in self.developments] if self.developments is not None else None,
            "cumulative_memories_count": len(self.cumulative_memories),
            "cumulative_memories": [m.to_dict() for m in self.cumulative_memories],
            "active_persona_phases": [p.to_dict() for p in self.active_persona_phases],
            "active_relationship_phases": [r.to_dict() for r in self.active_relationship_phases],
            "timing_flags": [f.to_dict() for f in self.timing_flags],
        }

