# STAGE: Evolving Stories — Demo Package (The Fault in Our Stars)

This repository package has been pruned and prepared for a lightweight, standalone **one-night demo** of the STAGE benchmark ([arXiv:2601.08510](https://arxiv.org/abs/2601.08510), [`roytian1992/STAGE_v0`](https://github.com/roytian1992/STAGE_v0)).

All unused benchmark evaluators and 150 other movies have been removed to create a compact, zero-bloat (~2.8 MB) distribution focused exclusively on **The Fault in Our Stars** (`en3f51f126ac684887812de45cc7f2c35e`).

For complete pipeline documentation, schema mappings, and example scenes, see [`README_DEMO.md`](file:///c:/Users/siasi/Downloads/STAGE/README_DEMO.md).

## Quick Start: View or Regenerate Demo Data

* **Clean Demo Output:** Open [`processed/movie.json`](file:///c:/Users/siasi/Downloads/STAGE/processed/movie.json) or [`data/processed/movie.json`](file:///c:/Users/siasi/Downloads/STAGE/data/processed/movie.json) to view Scenes 1–20.
* **Reproduce from Raw Assets:**
  ```bash
  python scripts/build_demo_dataset.py
  ```

## Package Layout

```text
STAGE/
├── data/
│   ├── raw/                        # Official STAGE raw assets for The Fault in Our Stars
│   │   ├── info.json
│   │   ├── movie_metadata.json
│   │   ├── task_1_autoregressive_state_update.json
│   │   ├── task_1_reference_state_update.json
│   │   ├── task_2_question_answering.csv
│   │   ├── task_3_multi_turn.json
│   │   ├── task_3_role_assets.json
│   │   └── task_3_single_turn.json
│   └── processed/
│       └── movie.json              # Clean scene-level dataset (Scenes 1–20)
├── processed/
│   └── movie.json                  # Root mirror for immediate viewing
├── scripts/
│   ├── build_demo_dataset.py       # Standalone preprocessing script
│   └── inspect_movie.py            # Movie inspection script
├── english_movie_info.csv          # Metadata reference
├── README.md                       # This file
└── README_DEMO.md                  # Comprehensive Person 1 deliverable documentation
```

## Counts

| Asset | Count |
|---|---:|
| Movies | 151 |
| Task I focal trajectories | 434 |
| Task I checkpoints | 2,925 |
| Task II questions | 5,010 |
| Task III role assets | 727 |
| Task III single-turn instances | 5,425 |
| Task III multi-turn episodes | 866 |
| Task III multi-turn turns | 2,598 |

Counts and SHA-256 checksums are recorded in `manifest.json`. Prediction and
evaluation entry points, bilingual prompts, schemas, example configs, and the
reference environment are provided under `evaluation/`; see `EVALUATION.md`.

## Rights

Screenplay rights remain with their respective holders. This repository does
not include full screenplay text.
