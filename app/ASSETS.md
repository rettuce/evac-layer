# Assets and dependencies (app/)

| Asset | Source | License |
|---|---|---|
| Noto Sans JP (400, 700) | `@fontsource/noto-sans-jp` 5.3.1 — https://fontsource.org/fonts/noto-sans-jp | SIL OFL 1.1 |
| Noto Sans (400, 700) | `@fontsource/noto-sans` 5.3.0 — https://fontsource.org/fonts/noto-sans | SIL OFL 1.1 |
| Noto Sans SC (400, 700) | `@fontsource/noto-sans-sc` 5.3.1 — https://fontsource.org/fonts/noto-sans-sc | SIL OFL 1.1 |
| Noto Sans TC (400, 700) | `@fontsource/noto-sans-tc` 5.3.1 — https://fontsource.org/fonts/noto-sans-tc | SIL OFL 1.1 |
| Noto Sans KR (400, 700) | `@fontsource/noto-sans-kr` 5.3.1 — https://fontsource.org/fonts/noto-sans-kr | SIL OFL 1.1 |
| Noto Sans Thai (400, 700) | `@fontsource/noto-sans-thai` 5.3.0 — https://fontsource.org/fonts/noto-sans-thai (Thai subset about 9 KB per weight; Vietnamese, Filipino and Indonesian use the Latin and Vietnamese subsets of Noto Sans) | SIL OFL 1.1 |
| Nuxt 4.6.3 | https://github.com/nuxt/nuxt | MIT |
| puppeteer-core 25.16.0 (dev, `scripts/shot.mjs`) | https://github.com/puppeteer/puppeteer | Apache-2.0 |
| Material Symbols Outlined, opsz 48 (`tsunami` `flood` `landslide` `cyclone` `directions_run` `my_location`) | `app/public/picto/*.svg` from https://github.com/google/material-design-icons `symbols/web/<name>/materialsymbolsoutlined/<name>_48px.svg` (commit 10ecc14). Modified: `fill="currentColor"` added, fixed width/height removed. License text: `app/public/picto/LICENSE-material-symbols.txt` | Apache-2.0 |
| `arrow_forward` (redrawn after the Material shape so it keeps the stroke 64 at signage size), `storm_surge` `earthquake` `go_higher` `emergency_evacuation_site` `evacuation_shelter` `safe_here` `heavy_rain` | `app/public/picto/*.svg`, drawn for this repository (viewBox 960, stroke 64, flat caps; earthquake stroke 59) | this repository |

Fonts are bundled through the npm packages and served by the app itself, so screens render with no network access.
An unknown pictogram ID falls back to its ID in a box and is flagged with `data-pictogram-missing`.
