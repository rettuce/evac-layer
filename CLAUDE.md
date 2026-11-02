# EVAC LAYER — conventions

- Language: TypeScript (Node 22, pnpm). Nuxt for the app in `app/`. Agents in `agents/`. JSON Schemas in `schema/`. Municipality knowledge files in `data/municipalities/`. Blender scripts in `demo/blender/` (Python, bpy).
- Commits and code comments may be English. Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Comments: keep only the "why" that code cannot express. No narration, no commented-out code.
- Secrets live in `.env` (gitignored). Never commit keys. The `ANTHROPIC_API_KEY` is read by scripts, not by the editor session.
- Motion rules for guidance screens: no blinking; one scale-in on appearance; brightness pulse at or below 1 Hz; pictograms appear → hold → disappear. Colors are the Cabinet Office 5 levels as given.
- Determinism: the same alert and the same municipality file produce the same screen.
- Every generated screen carries its sources (municipal PDF page, JMA bulletin id).
- License is AGPL-3.0 with a separate commercial license from IE3. Dependencies must be MIT / Apache-2.0 / BSD / ISC / CC0 (fonts: SIL OFL). Never add an AGPL or GPL dependency.
- Do not merge external pull requests without a CLA. During the hackathon, no external contributions.
