"""
StoryLens: Spoiler-Safe Narrative State Tracking Engine.

Tracks what each character knows, believes, wants, and how relationships evolve,
strictly bounded by story checkpoints using verified STAGE benchmark assets.
"""

from storylens.loader import STAGELoader
from storylens.state_engine import StoryLensEngine
from storylens.graph import TemporalGraph, TemporalGraphBuilder, GraphNode, GraphEdge

__all__ = [
    "STAGELoader",
    "StoryLensEngine",
    "TemporalGraph",
    "TemporalGraphBuilder",
    "GraphNode",
    "GraphEdge",
]
__version__ = "0.2.0"
