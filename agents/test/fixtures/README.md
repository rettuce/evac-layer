# test fixtures

- `municipality-17204-min.json`: a reduced municipality file. Shelter rows are real records from the GSI designated emergency evacuation site CSV for 輪島市 (国土地理院「指定緊急避難場所データ」, PDL1.0). Hazard/PDF entries are omitted on purpose.
- `writer-tsunami-advisory.json`: hand-written test text in the Writer output shape, not model output and not an official message.
- `site-wajima-test.json`: a test screen location; the coordinates are illustrative.
- `writer-tsunami-advisory-distance.json` / `-long.json`: deliberately broken variants (distance repeated in the direction cell; action text over budget) to drive the revision loop.
- `replay-05210-koyoshi-20261021.json`: the nine real 子吉川 flood forecast bulletins (VXKO55, 2026-10-21 11:45 → 10-22 06:20) for 由利本荘市, as parsed alert JSON from the recorded JMA long feed. Headline text is verbatim; nothing is edited or invented.
- `jma/`: unmodified JMA bulletins (official samples and recorded feed) that the tests read when no raw data is configured. Source and terms in [`jma/README.md`](jma/README.md).
- `gsi-shelters/`: the two unmodified GSI shelter CSVs for 輪島市 (PDL1.0). Source in [`gsi-shelters/README.md`](gsi-shelters/README.md).
