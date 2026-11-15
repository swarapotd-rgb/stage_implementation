# STAGE Demo Preprocessing Pipeline — Person 1 Deliverable

This directory contains the demoable preprocessing pipeline for the **STAGE** benchmark paper (*"STAGE: Evolving Stories"*, [arXiv:2601.08510](https://arxiv.org/abs/2601.08510)).

As Person 1 on this one-night demo project, our goal is **not** to train models, evaluate benchmarks, or reconstruct 151 movies. Instead, our sole job is to establish a working pipeline that ingests real, released STAGE annotations for **ONE movie** and outputs a clean, scene-level JSON demo file with characters, events, and dynamic character states (goals, beliefs, knowledge, relationships).

---

## 1. Exact Repository & Version Information

* **GitHub Repository:** [`roytian1992/STAGE_v0`](https://github.com/roytian1992/STAGE_v0)
* **Exact Git Commit Hash:** `809ea665783879da77f4f30bf7f5be771525f514`
* **Branch:** `main`
* **Paper Reference:** *STAGE: Evolving Stories* ([arXiv:2601.08510](https://arxiv.org/abs/2601.08510))

---

## 2. Selected Movie

* **Selected Movie:** **The Fault in Our Stars (film)** (2014)
* **Movie ID:** `en3f51f126ac684887812de45cc7f2c35e`
* **Slot ID:** `en-18`
* **Genres:** Romance, Drama, Youth
* **Total Screenplay Scenes:** 107
* **Demo Scenes Extracted:** 20 scenes (Scenes 1–20)
* **Verification:** Confirmed present in STAGE's `english_movie_info.csv` (Row 110) with complete task assets released in directory `STAGE/English/en3f51f126ac684887812de45cc7f2c35e/`.

---

## 3. Dataset & Annotation Artifacts Reused

All data was extracted directly from the official STAGE release artifacts for `en3f51f126ac684887812de45cc7f2c35e`:

| Artifact File | Description & Reused Fields |
|---|---|
| `info.json` | Movie metadata, screen count (107 scenes), genre taxonomy, benchmark protocol |
| `task_3_role_assets.json` (2.2 MB) | **Core Source**: 803 memories, `grounded_facts`, `persona_phases` (traits & behavioral constraints), `relationship_phases` (target, polarity, description), and `persona_cards` |
| `task_1_reference_state_update.json` (75 KB) | Focal trajectory checkpoints for Hazel Grace and Augustus Waters, reference claims with `evidence_scene_orders` |
| `task_1_autoregressive_state_update.json` (17 KB) | Autoregressive state update specifications |
| `task_2_question_answering.csv` (24 KB) | 32 narrative reasoning questions, scene sluglines (`INT/EXT`), and grounded scene evidence |
| `english_movie_info.csv` | Official movie metadata record |

---

## 4. Pipeline Architecture & Directory Structure

```text
STAGE/
├── data/
│   ├── raw/                               # Raw STAGE artifacts for The Fault in Our Stars
│   │   ├── info.json
│   │   ├── movie_metadata.json
│   │   ├── task_1_autoregressive_state_update.json
│   │   ├── task_1_reference_state_update.json
│   │   ├── task_2_question_answering.csv
│   │   ├── task_3_multi_turn.json
│   │   ├── task_3_role_assets.json
│   │   └── task_3_single_turn.json
│   └── processed/
│       └── movie.json                     # Clean scene-level dataset (Scenes 1–20)
├── processed/
│   └── movie.json                         # Mirrored at root for immediate inspection
├── scripts/
│   ├── build_demo_dataset.py              # Single automated preprocessing script
│   └── inspect_movie.py                   # Diagnostic script
└── README_DEMO.md                         # This deliverable document
```

---

## 5. How the Data Was Mapped to Scene-Level Schema

The prompt requested the following target structure:
```json
{
  "movie": "Movie Name",
  "scenes": [
    {
      "scene_id": 1,
      "characters": [...],
      "events": [...],
      "character_states": {
        "Character A": {
          "goal": [...],
          "belief": [...],
          "knowledge": [...],
          "relationships": [...]
        }
      }
    }
  ]
}
```

The fields are derived directly from STAGE:

1. **`scene_id` & `scene_title`:** Screenplay scene orders (1–20) and location sluglines extracted from Task 2 QA annotations (e.g. `INT. DOCTOR'S OFFICE / EXAM ROOM - DAY`, `INT. CHURCH BASEMENT - DAY`, `EXT. OUTSIDE THE CHURCH - LATER`).
2. **`characters`:** Physical participants in each scene, resolved from character memory origins (`fact_origin.scene_order`), grounded facts, and Task 2 QA evidence.
3. **`events`:** Extracted from STAGE `grounded_facts` inside character memory units and narrative evidence descriptions from Task 2 QA.
4. **`character_states`:**
   * **`goal`:** Behavioral constraints from active `persona_phases`, operational rules, and intentional aims extracted from Task 2 QA (`"what does [character] aim to do"`).
   * **`belief`:** Character traits and internal attitudes from active `persona_phases` plus Task 1 `current_state` claims with evidence grounded in the current scene.
   * **`knowledge`:** The character's epistemic memories (`memory_text`, `access_type`, `importance`) acquired in or originating from that scene.
   * **`relationships`:** Dynamic `relationship_phases` valid at that scene with `target`, `polarity`, and `description`, sorted to prioritize interactions with characters present in the scene.

---

## 6. How to Reproduce

Run the reproduction script with standard Python 3 (no third-party dependencies required):

```bash
python scripts/build_demo_dataset.py
```

The script will:
1. Copy raw STAGE assets for `en3f51f126ac684887812de45cc7f2c35e` into `data/raw/`.
2. Parse Task 1, Task 2, and Task 3 artifacts deterministically.
3. Generate `data/processed/movie.json` and `processed/movie.json`.

---

## 7. Example Extracted Scenes

### Example 1: Scene 1 (`INT. DOCTOR'S OFFICE / EXAM ROOM - DAY`)
* **Characters:** `["Frannie Lancaster", "Hazel Grace"]`
* **Events:**
  * `"The doctor asserts that Hazel is depressed despite her repeated denials."`
  * `"A medical appointment where Hazel's condition is discussed by her mother and the doctor."`
  * `"Hazel sits on an exam table while the doctor and her mother discuss her condition."`
* **Character States:**
  * **`Frannie Lancaster` (Hazel's Mother):**
    * **Goal:** `["Support and protect Hazel while encouraging her to engage socially and attend support group."]`
    * **Belief:** `["Frannie believes Hazel is emotionally withdrawn and needs external social interaction beyond doctors and reading."]`
    * **Knowledge:** `["I remember standing there, telling the doctor how she eats so little and never goes out, how she just sits and reads that same book over and over—my voice felt tight, like I was trying to hold something together just by speaking it into place."]`
    * **Relationships:** `[{"target": "Hazel Grace", "polarity": "positive", "description": "Loving, protective mother dedicated to managing Hazel's care and emotional wellbeing."}]`
  * **`Hazel Grace`:**
    * **Goal:** `["Hazel Grace engages in repetitive reading behavior, indicating a need for control or comfort in familiarity.", "Hazel Grace relies on supplemental oxygen, indicating a physical limitation due to her medical condition."]`
    * **Belief:** `["Hazel Grace defines her emotional state as a consequence of mortality rather than illness, distinguishing it from clinical depression.", "Hazel Grace resists being labeled as depressed, attributing her emotional state to the reality of her illness rather than mental health.", "Hazel positions herself as an outsider to moments of youthful joy, reinforcing her sense of emotional isolation.", "Hazel is officially diagnosed as depressed by medical authority"]`
    * **Knowledge:** `["I heard the doctor say I'm depressed, even though I kept saying I'm not, and it felt like no one was listening to me.", "I was there in the living room with my mom and the doctor, sitting through another appointment where they talked about my condition while I just wanted to go back to my book."]`
    * **Relationships:** `[{"target": "the doctor", "polarity": "mixed", "description": "Hazel resists the doctor's diagnostic authority and uses sarcasm to deflect medical authority while remaining in a position of obligation."}]`

---

### Example 2: Scene 8 (`INT. CHURCH HALLWAY / STAIRS - SAME`)
* **Characters:** `["Augustus Waters", "Hazel Grace"]`
* **Events:**
  * `"Hazel chooses to take the stairs instead of the elevator after encountering a very sick child."`
  * `"After bumping into each other, Gus and Hazel exchange brief, polite apologies."`
* **Character States:**
  * **`Augustus Waters`:**
    * **Goal:** `["Connect authentically with Hazel through humor, charm, and shared perspective."]`
    * **Belief:** `["Augustus Waters is perceived as strikingly attractive, eliciting a moment of speechless mutual awareness from Hazel upon their first encounter.", "Augustus Waters has made initial eye contact with Hazel, creating mutual awareness after a physical collision."]`
    * **Knowledge:** `["After we collided, I said 'My bad. No, it's...' and she apologized too, so I know we both meant to be polite in that awkward moment."]`
    * **Relationships:** `[{"target": "Hazel Grace", "polarity": "positive", "description": "Augustus Waters has made initial eye contact with Hazel, creating mutual awareness after a physical collision."}]`
  * **`Hazel Grace`:**
    * **Goal:** `["Hazel requires physical assistance and uses an oxygen tank when moving, indicating physical limitation due to illness."]`
    * **Belief:** `["Hazel Grace exhibits skepticism toward making friends, as shown by her nonverbal dismissal of her mother's suggestion."]`
    * **Knowledge:** `["I decided to take the stairs instead of the elevator after seeing that very sick child."]`
    * **Relationships:** `[{"target": "the doctor", "polarity": "mixed", "description": "Hazel resists the doctor's diagnostic authority..."}, {"target": "Young Couple", "polarity": "mixed", "description": "Hazel observes the couple's interaction with detached curiosity but does not engage."}]`

---

### Example 3: Scene 10 (`EXT. OUTSIDE THE CHURCH - LATER`)
* **Characters:** `["Augustus Waters", "Frannie Lancaster", "Hazel Grace"]`
* **Events:**
  * `"A gathering of cancer patients in a church basement for sharing experiences and emotional support."`
  * `"Isaac reveals he will undergo another surgery soon and will likely become blind as a result."`
* **Character States:**
  * **`Hazel Grace`:**
    * **Goal:** `["Aim: Confront him about his hypocrisy", "Hazel Grace reacts to her reflection with visible emotional distress and surprise", "Hazel Grace is initially self-conscious under prolonged attention."]`
    * **Belief:** `["Hazel positions herself as a philosophical challenger to existential fear, moving from observer to active participant.", "Hazel Grace experiences self-disgust or discomfort when seeing her reflection", "Hazel Grace has a preoccupation with mortality and the impermanence of human legacy."]`
    * **Knowledge:** `["I sat in the Circle of Sick, surrounded by others who, like me, were just trying to get through another day."]`
    * **Relationships:** `[{"target": "Augustus Waters", "polarity": "mixed", "description": "Hazel challenges Augustus's fear of oblivion with a philosophical counter-argument; Augustus maintains an intense, unbroken gaze toward Hazel, prompting mutual eye contact and a contest of wills."}]`
  * **`Augustus Waters`:**
    * **Goal:** `["Augustus Waters uses a prosthetic leg due to osteosarcoma."]`
    * **Belief:** `["Augustus Waters is perceived as strikingly attractive, eliciting a moment of speechless mutual awareness from Hazel upon their first encounter.", "Augustus Waters has survived osteosarcoma and lost a leg to the disease."]`
    * **Knowledge:** `["I was in the church basement with the others, part of this cancer support group where we all come together to share our experiences and offer each other emotional support."]`
    * **Relationships:** `[{"target": "Hazel Grace", "polarity": "mixed", "description": "Hazel challenges Augustus's fear of oblivion with a philosophical counter-argument; Augustus maintains an intense, unbroken gaze toward Hazel, prompting mutual eye contact and a contest of wills."}]`
