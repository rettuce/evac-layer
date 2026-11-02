# test fixtures

- `municipality-17204-min.json`: a reduced municipality file. Shelter rows are real records from the GSI designated emergency evacuation site CSV for 輪島市 (国土地理院「指定緊急避難場所データ」, PDL1.0). Hazard/PDF entries are omitted on purpose.
- `writer-tsunami-advisory.json`: hand-written test text in the Writer output shape, not model output and not an official message.
- `site-wajima-test.json`: a test screen location; the coordinates are illustrative.
- `writer-tsunami-advisory-distance.json` / `-long.json`: deliberately broken variants (distance repeated in the direction cell; action text over budget) to drive the revision loop.
