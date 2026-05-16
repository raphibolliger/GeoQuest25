# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent sub-projects, no shared tooling at the root:

- **`GeoQuest25.Frontend/`** — Angular 21 SPA that renders a Mapbox map of Swiss municipalities, colored by whether they've been visited or are still todo.
- **`GeoQuest25.Processing/`** — .NET 9 console app that ingests Swiss-boundary shape files plus the author's personal GPX activity exports and emits the GeoJSON assets consumed by the frontend.

The frontend is deployed to GitHub Pages on every push to `main` via `.github/workflows/deploy-github-pages.yml` (live at https://raphibolliger.github.io/GeoQuest25/).

## Frontend (`GeoQuest25.Frontend/`)

Commands (run from `GeoQuest25.Frontend/`):

- `npm start` — dev server at `http://localhost:4200`.
- `npm run build` — production build into `dist/geo-quest25/`. The GH Actions deploy adds `--base-href=/GeoQuest25/`.
- `npm test` — Karma + Jasmine unit tests.

Stack & conventions:

- **Angular 21 with zoneless change detection** (`provideZonelessChangeDetection()` in `app.config.ts`). Reactivity is built on signals — `signal`, `computed`, `linkedSignal`, `effect`, `resource`, `httpResource`, `toSignal`. Don't introduce `NgZone`-dependent patterns or `async` pipes for state; follow the existing signal-based pattern.
- **Strict TypeScript** plus `strictTemplates`, `strictInputAccessModifiers`, `noPropertyAccessFromIndexSignature`, etc. — assume strict everything.
- **Standalone components only.** There is no NgModule. The current app is essentially one component (`app.component.ts`) that wires Mapbox layers.
- **Mapbox via `ngx-mapbox-gl`.** Token is provided in `app.config.ts` via `provideMapboxGL`. The map renders two GeoJSON sources (`visited`, `todo`) loaded over HTTP from `src/assets/` and styled by reactive `FillPaint` expressions.
- **Styling:** Tailwind v4 (via `@tailwindcss/postcss`), SCSS for component styles. Prettier with an Angular HTML parser override.

### GeoJSON asset filenames are cache-busted with GUIDs

`src/assets/` contains exactly one `visited-<guid>.geojson` and one `todo-<guid>.geojson`. The filenames change every time the Processing app runs (it deletes the old pair and writes a new pair). The references in `app.component.ts` (the `httpResource` URLs near the bottom of the class) are rewritten by the Processing app as part of the same run.

If you regenerate assets manually, you must also update those two URLs in `app.component.ts`, or the frontend will 404 on load.

## Processing (`GeoQuest25.Processing/`)

Commands (run from `GeoQuest25.Processing/`):

- `dotnet run --project GeoQuest25.Processing` — runs the full pipeline.
- `dotnet build` — compile only.

What it does (`GeoQuest25.Processing/Program.cs`):

1. Reads `swissBOUNDARIES3D_1_5_TLM_HOHEITSGEBIET.shp` (Swiss municipalities, EPSG:2056 / CH1903+ LV95), reprojects to WGS84, and drops features whose `GEM_FLAECH == SEE_FLAECH` (lakes).
2. Reads two folders of `.gpx` files — "done" activities (filtered by activity-type keywords in the filename, e.g. "Outdoor Cycling") and "planned" activities (unfiltered).
3. For each municipality, checks in parallel whether any GPX track point falls inside its polygon. Splits into `visited` / `todo`; visited ones get a `firstVisit` date, todo ones get `planned=true` if any planned route touches them.
4. Hand-coded special cases merge two "Comunanza" shared-territory polygons into visited when either co-owning municipality has been visited.
5. Walks up from CWD looking for `GeoQuest25.Frontend`, deletes the existing `visited-*.geojson` and `todo-*.geojson` under `src/assets/`, writes new ones with fresh GUIDs, and rewrites the asset URLs in `src/app/app.component.ts`.

**The input paths are hardcoded to the author's machine** (`/Users/raphi/Downloads/...` for the shape file, iCloud paths for GPX folders). Anyone else running this needs to edit `Program.cs` first.

The `ShapeFileReader.TransformCoordinate` method applies a small empirically-derived offset (`0.0009755347103` lon, `0.001892481137` lat) after the projection transform to correct for a residual misalignment — don't "clean this up" without understanding why it's there.

## Cross-cutting notes

- This is a personal hobby project; there is no test coverage on the Processing side and the Frontend ships with the default scaffolded test setup.
- The Mapbox access token is committed in `app.config.ts`. It's a public-scope token for this app and is expected to be there.
