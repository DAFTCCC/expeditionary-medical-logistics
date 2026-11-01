# Browser tests

Scripted end-to-end checks against a built copy of the app (Python + Playwright).

```bash
npm run build && npx vite preview --port 4173 &
pip install playwright && python -m playwright install chromium
mkdir -p out
python e2e/workflows.py        http://localhost:4173/expeditionary-medical-logistics/ out   # 25 steps
python e2e/field_readiness.py  http://localhost:4173/expeditionary-medical-logistics/ out   # 19 steps
```

`workflows.py` covers dashboard, hub scoping, inventory, every transaction and its refusals, equipment, labels, manual / keyboard-wedge / photo scanning, history, persistence and phone layout.
`field_readiness.py` covers offline reload and transacting offline, quarantine → witnessed disposal, missing reports, GS1 DataMatrix generate-and-decode, backup → start blank → setup → transact → restore.

Not covered by any automated test: a live camera, a physical handheld scanner, printing.
