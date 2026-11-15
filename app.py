#!/usr/bin/env python3
"""
StoryLens Local Demo Server

Serves the interactive checkpoint state interface and provides API endpoints
for querying character states using the StoryLens engine.

Usage:
    python app.py [--port 8000]
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Set workspace root
WORKSPACE_ROOT = Path(__file__).resolve().parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from storylens.loader import STAGELoader
from storylens.state_engine import StoryLensEngine

RAW_DATA_DIR = WORKSPACE_ROOT / "input" / "STAGE" / "data" / "raw"
OUTPUT_DIR = WORKSPACE_ROOT / "output"
UI_DIR = WORKSPACE_ROOT / "ui"

# Initialize loader and engine once
print("Initializing StoryLens data engine...")
loader = STAGELoader(raw_data_dir=RAW_DATA_DIR)
engine = StoryLensEngine(loader=loader)
print("Data engine ready.")


class StoryLensRequestHandler(SimpleHTTPRequestHandler):
    """HTTP Request Handler for StoryLens web app and API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WORKSPACE_ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        # 1. API: /api/checkpoints
        if path == "/api/checkpoints":
            self._handle_api_checkpoints()
            return

        # 2. API: /api/state?character=...&scene=...
        if path == "/api/state":
            self._handle_api_state(query)
            return

        # 3. API: /api/graph?character=...&scene=...
        if path == "/api/graph":
            self._handle_api_graph(query)
            return

        # 4. Static frontend routing
        if path in ("/", "/index.html"):
            self._serve_file(UI_DIR / "index.html", "text/html")
            return
        elif path in ("/style.css", "/ui/style.css"):
            self._serve_file(UI_DIR / "style.css", "text/css")
            return
        elif path in ("/app.js", "/ui/app.js"):
            self._serve_file(UI_DIR / "app.js", "application/javascript")
            return
        elif path == "/output/demo_checkpoints.json":
            self._serve_file(OUTPUT_DIR / "demo_checkpoints.json", "application/json")
            return
        elif path == "/output/temporal_knowledge_graph.json":
            self._serve_file(OUTPUT_DIR / "temporal_knowledge_graph.json", "application/json")
            return

        # Fallback to standard handler
        super().do_GET()

    def _handle_api_checkpoints(self) -> None:
        """Return the pre-generated demo checkpoints JSON."""
        json_file = OUTPUT_DIR / "demo_checkpoints.json"
        if not json_file.exists():
            engine.export_demo_json(json_file, max_scene=20)

        with open(json_file, "rb") as f:
            data = f.read()

        self._send_json_bytes(data)

    def _handle_api_state(self, query: dict[str, list[str]]) -> None:
        """Compute state on-the-fly using StoryLensEngine."""
        character = query.get("character", ["Hazel Grace"])[0]
        try:
            scene_order = int(query.get("scene", ["1"])[0])
        except ValueError:
            scene_order = 1

        state = engine.get_state(character=character, scene_order=scene_order)
        json_bytes = json.dumps(state.to_dict(), ensure_ascii=False).encode("utf-8")
        self._send_json_bytes(json_bytes)

    def _handle_api_graph(self, query: dict[str, list[str]]) -> None:
        """Compute temporal knowledge graph on-the-fly using StoryLensEngine."""
        character = query.get("character", ["Hazel Grace"])[0]
        try:
            scene_order = int(query.get("scene", ["1"])[0])
        except ValueError:
            scene_order = 1

        graph = engine.get_graph_as_of(character=character, scene_order=scene_order)
        json_bytes = json.dumps(graph.to_dict(), ensure_ascii=False).encode("utf-8")
        self._send_json_bytes(json_bytes)

    def _send_json_bytes(self, json_bytes: bytes) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(json_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(json_bytes)

    def _serve_file(self, file_path: Path, content_type: str) -> None:
        if not file_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, f"File not found: {file_path.name}")
            return

        with open(file_path, "rb") as f:
            content = f.read()

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format: str, *args) -> None:
        # Keep server output clean
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")


def run_server(port: int = 8000) -> None:
    server_address = ("127.0.0.1", port)
    httpd = ThreadingHTTPServer(server_address, StoryLensRequestHandler)
    print("\n==================================================================")
    print(" StoryLens Demo Interface Running Locally")
    print("==================================================================")
    print(f" Web UI:  http://localhost:{port}")
    print(f" API:     http://localhost:{port}/api/checkpoints")
    print(f" State:   http://localhost:{port}/api/state?character=Hazel%20Grace&scene=10")
    print(" Press Ctrl+C to stop the server.")
    print("==================================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()
        print("Server stopped.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StoryLens Local Demo Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    args = parser.parse_args()
    run_server(port=args.port)

