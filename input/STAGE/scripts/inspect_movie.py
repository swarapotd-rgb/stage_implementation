import json
import csv
from pathlib import Path
from collections import defaultdict

movie_id = 'en3f51f126ac684887812de45cc7f2c35e'
base_dir = Path('STAGE/English') / movie_id

# 1. Info
with open(base_dir / 'info.json', encoding='utf-8') as f:
    info = json.load(f)
print("Title:", info.get('title'))
print("Counts:", info.get('counts'))

# 2. Role assets
with open(base_dir / 'task_3_role_assets.json', encoding='utf-8') as f:
    role_assets = json.load(f)
print("Roles count:", len(role_assets.get('roles', [])))
for i, r in enumerate(role_assets.get('roles', [])):
    name = r.get('canonical_name') or r.get('character_name')
    print(f"Role {i}: {name}, memories: {len(r.get('memories', []))}, persona_phases: {len(r.get('persona_phases', []))}, relationship_phases: {len(r.get('relationship_phases', []))}")

# 3. Task 1
with open(base_dir / 'task_1_reference_state_update.json', encoding='utf-8') as f:
    t1 = json.load(f)
print("Task 1 trajectories:", len(t1.get('trajectories', [])))
for traj in t1.get('trajectories', []):
    print("  Character:", traj.get('character'), "checkpoints:", len(traj.get('checkpoints', [])))

# 4. Task 2 QA
qa_count = 0
with open(base_dir / 'task_2_question_answering.csv', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    qa_list = list(reader)
    print("Task 2 QA count:", len(qa_list))
