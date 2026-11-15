# StoryLens: STAGE Paper Implementation Demo

A StoryLens capstone prototype implementing character epistemic state tracking and temporal narrative knowledge graphs based on the released annotations from the **STAGE research paper** (*State Tracking and Agent Generation Evaluation in Screenplays*, [arXiv:2601.08510](https://arxiv.org/abs/2601.08510)).

---

## 🎯 Overview & Scope

This project implements a verified data layer, query engine, and interactive visualization dashboard for tracking narrative state and knowledge boundaries over *The Fault in Our Stars* (Scenes 1–20 demo scope).

### Implemented Features
- **Task 1: Autoregressive State Update**: Checkpoint state claims and interval narrative developments across sequence checkpoints.
- **Task 3: Character Role Assets**: Dynamic persona phase traits and interpersonal relationship phases with temporal validity intervals (`valid_from` to `valid_until`).
- **Epistemic Memory Tracking**: Cumulative character memories with source provenance (`fact_origin.scene_order`), character access time (`available_from.scene_order`), and access mode (`witnessed`, `involved`, `told`, `inferred`).
- **Temporal Story Knowledge Graph**: Deterministic, typed narrative graph modeling characters, scenes, checkpoints, state claims, developments, persona/relationship phases, and grounded facts with temporal bounds (`as_of_scene`).
- **Interactive Visual Interface**: Pure HTML5/CSS/SVG dashboard featuring multi-tier graph layout, click-to-inspect node panel, layer filtering, and side-by-side epistemic memory/state viewer.

### Out of Scope / Excluded
- Raw screenplay extraction (the screenplay text is excluded from the released STAGE dataset).
- Task 2 Question Answering evaluation.
- In-script generative role-playing, book–film comparison, or Navarasa emotion detection.

---

## 🏗️ Architecture

```
StoryLens_STAGE_demo/
├── storylens/              # Core data engine and graph builder
│   ├── __init__.py
│   ├── loader.py           # Loads raw STAGE JSON/CSV annotations
│   ├── state_engine.py     # Checkpoint state computation and temporal filtering
│   └── graph.py            # Temporal Knowledge Graph builder (nodes & edges)
├── ui/                     # Interactive dashboard
│   ├── index.html          # Semantic HTML5 layout
│   ├── style.css           # Cinematic archival design system
│   ├── app.js              # Client application & SVG graph renderer
│   └── demo_data.js        # Standalone preloaded checkpoint & graph dataset
├── output/                 # Exported artifacts
│   ├── demo_checkpoints.json
│   └── temporal_knowledge_graph.json
├── tests/                  # Test suite
│   ├── test_storylens.py   # Loader, state engine, and API tests
│   └── test_graph.py       # Graph semantics, temporal filtering, and schema tests
├── input/STAGE/            # Official STAGE benchmark annotation release
├── references/             # STAGE benchmark paper (arXiv:2601.08510)
├── app.py                  # Lightweight Python HTTP server & REST API
├── build_demo.py           # Dataset build and validation script
└── .gitignore
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- No heavy external dependencies or database required (pure standard library).

### 1. Run Tests
Ensure all unit and integration tests pass:
```bash
python -m unittest discover tests
```

### 2. Launch Local Server
Start the lightweight Python API and static server:
```bash
python app.py --port 8000
```
Open your browser at `http://localhost:8000`.

### 3. Static / Offline Mode
The dashboard can also be viewed directly without a Python server by opening `ui/index.html` in any modern web browser.

---

## 📊 REST API Endpoints

- `GET /api/checkpoints` — List all official Task 1 checkpoints.
- `GET /api/state?character={name}&scene={order}` — Retrieve character state, interval developments, cumulative memories, and active persona/relationship phases as of the target scene.
- `GET /api/graph?character={name}&scene={order}` — Retrieve the as-of temporal story knowledge graph (nodes, edges, metadata).

---

## 📜 Citation

If you use this benchmark data or work, please cite the STAGE paper:

```bibtex
@article{stage2026,
  title={STAGE: State Tracking and Agent Generation Evaluation in Screenplays},
  journal={arXiv preprint arXiv:2601.08510},
  year={2026}
}
```
