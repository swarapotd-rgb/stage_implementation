"""
Integration tests for the StoryLens Demo Server request handler and API endpoints.

Uses an in-memory MockSocket to test the full HTTP request handling, routing,
header generation, and API responses cleanly without socket permission restrictions.
"""

from __future__ import annotations

import io
import json
import unittest
from pathlib import Path

from app import StoryLensRequestHandler

WORKSPACE_ROOT = Path(__file__).resolve().parents[1]


class DummyServer:
    """Mock server container for SimpleHTTPRequestHandler."""
    pass


class MockSocket:
    """In-memory socket stream for testing BaseHTTPRequestHandler."""

    def __init__(self, request_bytes: bytes) -> None:
        self.rfile = io.BytesIO(request_bytes)
        self.wfile = io.BytesIO()

    def makefile(self, mode: str, *args, **kwargs) -> io.BytesIO:
        if "b" in mode:
            if "r" in mode:
                return self.rfile
            return self.wfile
        raise ValueError(f"Unsupported mode: {mode}")

    def sendall(self, b: bytes) -> None:
        self.wfile.write(b)


def run_request(path: str) -> tuple[int, dict[str, str], str]:
    """Execute a simulated HTTP GET request against StoryLensRequestHandler."""
    request_bytes = f"GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n".encode("utf-8")
    sock = MockSocket(request_bytes)
    StoryLensRequestHandler(sock, ("127.0.0.1", 8000), DummyServer())
    raw_response = sock.wfile.getvalue().decode("utf-8", errors="replace")

    headers_part, _, body = raw_response.partition("\r\n\r\n")
    header_lines = headers_part.split("\r\n")
    status_line = header_lines[0]
    status_code = int(status_line.split()[1])

    headers: dict[str, str] = {}
    for line in header_lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()

    return status_code, headers, body


class TestDemoServerAndAPI(unittest.TestCase):
    def test_ui_index_serves_html(self) -> None:
        """Verify root URL serves the HTML interface."""
        status, headers, body = run_request("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers.get("content-type", ""))
        self.assertIn("<title>StoryLens: Checkpoint State Viewer</title>", body)
        self.assertIn("Cumulative Epistemic Memories", body)

    def test_ui_assets_serve_correct_content_types(self) -> None:
        """Verify CSS and JS static files serve with proper content-type headers."""
        status_css, headers_css, body_css = run_request("/style.css")
        self.assertEqual(status_css, 200)
        self.assertIn("text/css", headers_css.get("content-type", ""))
        self.assertIn(".checkpoint-pill", body_css)

        status_js, headers_js, body_js = run_request("/app.js")
        self.assertEqual(status_js, 200)
        self.assertIn("javascript", headers_js.get("content-type", ""))
        self.assertIn("OFFICIAL_CHECKPOINTS", body_js)

    def test_api_checkpoints_returns_valid_data(self) -> None:
        """Verify /api/checkpoints endpoint returns the 5 official demo checkpoints."""
        status, headers, body = run_request("/api/checkpoints")
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers.get("content-type", ""))

        data = json.loads(body)
        self.assertEqual(data["total_demo_checkpoints"], 5)
        checkpoints = data["checkpoints"]
        self.assertEqual(len(checkpoints), 5)

        # Verify scenes
        scenes = [cp["scene_order"] for cp in checkpoints]
        self.assertEqual(scenes, [1, 8, 10, 11, 19])

    def test_api_state_official_checkpoint(self) -> None:
        """Verify /api/state returns official Task 1 data at official checkpoints."""
        status, headers, body = run_request("/api/state?character=Hazel%20Grace&scene=10")
        self.assertEqual(status, 200)
        state = json.loads(body)

        self.assertTrue(state["is_official_checkpoint"])
        self.assertEqual(state["checkpoint_id"], "checkpoint-25b06ccde76a38d46462")
        self.assertEqual(len(state["current_states"]), 8)
        self.assertEqual(len(state["developments"]), 1)
        self.assertEqual(state["cumulative_memories_count"], 41)

        # Strict spoiler-safe check on all returned memories
        for mem in state["cumulative_memories"]:
            self.assertLessEqual(mem["available_from"]["scene_order"], 10)

    def test_api_state_non_checkpoint_scene(self) -> None:
        """Verify /api/state returns is_official_checkpoint=False with null states for non-checkpoints."""
        status, headers, body = run_request("/api/state?character=Hazel%20Grace&scene=5")
        self.assertEqual(status, 200)
        state = json.loads(body)

        self.assertFalse(state["is_official_checkpoint"])
        self.assertIsNone(state["checkpoint_id"])
        self.assertIsNone(state["current_states"])
        self.assertIsNone(state["developments"])

        # Memories should still be cumulative up to scene 5
        self.assertGreater(state["cumulative_memories_count"], 0)
        for mem in state["cumulative_memories"]:
            self.assertLessEqual(mem["available_from"]["scene_order"], 5)

    def test_api_graph_endpoint(self) -> None:
        """Verify /api/graph returns a valid as-of temporal knowledge graph."""
        status, headers, body = run_request("/api/graph?character=Hazel%20Grace&scene=10")
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers.get("content-type", ""))
        graph = json.loads(body)

        self.assertIn("metadata", graph)
        self.assertIn("nodes", graph)
        self.assertIn("edges", graph)
        self.assertEqual(graph["metadata"]["as_of_scene"], 10)
        self.assertTrue(graph["metadata"]["is_official_checkpoint"])
        self.assertGreater(graph["node_count"], 0)
        self.assertGreater(graph["edge_count"], 0)

        # Confirm Task 1 claim nodes exist at official checkpoint
        node_types = {n["type"] for n in graph["nodes"]}
        self.assertIn("Checkpoint", node_types)
        self.assertIn("StateClaim", node_types)
        self.assertIn("Development", node_types)

    def test_api_graph_non_checkpoint_scene(self) -> None:
        """Verify /api/graph returns non-checkpoint graph with zero interpolated claims."""
        status, headers, body = run_request("/api/graph?character=Hazel%20Grace&scene=5")
        self.assertEqual(status, 200)
        graph = json.loads(body)

        self.assertFalse(graph["metadata"]["is_official_checkpoint"])
        node_types = {n["type"] for n in graph["nodes"]}
        self.assertNotIn("Checkpoint", node_types)
        self.assertNotIn("StateClaim", node_types)
        self.assertNotIn("Development", node_types)

        # Confirm memories are strictly <= scene 5
        for node in graph["nodes"]:
            if node["type"] == "Memory":
                avail = node["properties"]["available_from"]["scene_order"]
                self.assertLessEqual(avail, 5)

    def test_api_graph_updates_across_scenes(self) -> None:
        """Confirm changing scene updates the graph nodes/edges and maintains knowledge boundary."""
        prev_node_count = 0
        for sc in [1, 8, 10, 11, 19]:
            status, headers, body = run_request(f"/api/graph?character=Hazel%20Grace&scene={sc}")
            self.assertEqual(status, 200)
            graph = json.loads(body)

            self.assertEqual(graph["metadata"]["as_of_scene"], sc)
            self.assertGreater(graph["node_count"], prev_node_count)
            prev_node_count = graph["node_count"]

            # Verify no future memory
            for node in graph["nodes"]:
                if node["type"] == "Memory":
                    avail = node["properties"]["available_from"]["scene_order"]
                    self.assertLessEqual(avail, sc, f"Memory available at scene {avail} > queried scene {sc}")

    def test_ui_html_contains_graph_panel_elements(self) -> None:
        """Verify HTML contains visual graph panel, canvas, inspector, and layer filters."""
        status, headers, body = run_request("/")
        self.assertEqual(status, 200)
        self.assertIn('id="graph-panel"', body)
        self.assertIn('id="graph-svg"', body)
        self.assertIn('id="graph-inspector"', body)
        self.assertIn('data-layer="checkpoint"', body)
        self.assertIn('data-layer="memories"', body)
        self.assertIn('id="graph-non-checkpoint-notice"', body)


if __name__ == "__main__":
    unittest.main()
