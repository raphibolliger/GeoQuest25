# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent sub-projects, no shared tooling at the root:

- **`GeoQuest25.Frontend/`** — Angular 21 SPA that renders a Mapbox map of Swiss municipalities, colored by whether they've been visited or are still todo.
- **`GeoQuest25.Processing/`** — .NET 9 console app that ingests Swiss-boundary shape files plus the author's personal GPX activity exports and emits the GeoJSON assets consumed by the frontend.

Deployment runs via `.github/workflows/run-processing.yml` ("Process and Deploy", on push to `main` or manual dispatch, live at https://raphibolliger.github.io/GeoQuest25/): the workflow runs the Processing pipeline on the runner, builds the frontend with the freshly generated assets and deploys to GitHub Pages. **The generated GeoJSON assets are never committed** — they are gitignored and only exist locally (after a local pipeline run) or inside a workflow run.

## Frontend (`GeoQuest25.Frontend/`)

Commands (run from `GeoQuest25.Frontend/`):

- `npm start` — dev server at `http://localhost:4200`.
- `npm run build` — production build into `dist/geo-quest25/`. The GH Actions deploy adds `--base-href=/GeoQuest25/`.
- `npm test` — Karma + Jasmine unit tests.

Stack & conventions:

- **Angular 21 with zoneless change detection** (`provideZonelessChangeDetection()` in `app.config.ts`). Reactivity is built on signals — `signal`, `computed`, `linkedSignal`, `effect`, `resource`, `httpResource`, `toSignal`. Don't introduce `NgZone`-dependent patterns or `async` pipes for state; follow the existing signal-based pattern.
- **Strict TypeScript** plus `strictTemplates`, `strictInputAccessModifiers`, `noPropertyAccessFromIndexSignature`, etc. — assume strict everything.
- **Standalone components only.** There is no NgModule. The current app is essentially one component (`app.component.ts`) that wires Mapbox layers.
- **Mapbox via `ngx-mapbox-gl`.** Token is provided in `app.config.ts` via `provideMapboxGL`. The map renders two GeoJSON sources (`visited`, `todo`) loaded over HTTP from `src/assets/` and styled by reactive `FillPaint` expressions, plus a `tracks` vector source (PMTiles, toggled off by default) that draws all done-activity GPX paths as lines. Mapbox GL JS (v3.21+) detects the `.pmtiles` extension natively and loads the file via HTTP range requests — no extra library needed.
- **`mapboxgl.workerUrl` is deliberately overridden in `app.config.ts`** to load the map worker from `assets/mapbox-gl-csp-worker.js` (copied from `node_modules` via the `assets` config in `angular.json`). Without this, the Vite dev server mangles the inlined worker blob and the PMTiles tile-provider plugin fails to load inside the worker (`__vite__injectQuery is not defined`) — tracks then silently don't render under `npm start`. Don't remove it.
- **Styling:** Tailwind v4 (via `@tailwindcss/postcss`), SCSS for component styles. Prettier with an Angular HTML parser override.

### GeoJSON assets are generated, gitignored and cache-busted with GUIDs

A pipeline run writes one `visited-<guid>.geojson`, one `todo-<guid>.geojson` and one `tracks-<guid>-<hash>.pmtiles` into `src/assets/` (deleting any previous ones) and rewrites the asset URLs in `app.component.ts` to match.

### The tracks are gated by a secret (capability URL)

The tracks filename ends with the SHA-256 hex hash of a secret (`Gpx:RoutesSecret` user secret locally, `GPX_ROUTES_SECRET` repo secret in CI). The frontend only knows the `tracks-<guid>` prefix; it derives the hash from the `?routes=<secret>` query param at runtime and probes the resulting URL (first bytes must match the `PMTiles` magic — a plain status check would be fooled by SPA-fallback responses). Only when the probe succeeds does the tracks toggle button appear. Without the secret the file URL cannot be constructed, and GitHub Pages does not list directory contents. Access with the secret: `https://raphibolliger.github.io/GeoQuest25/?routes=<secret>`.

A secret that passed the probe is persisted in `localStorage` (`routesSecret`), so subsequent visits work without the query param. The query param takes precedence over the stored value; if no candidate passes the probe (e.g. after a secret rotation), the stored value is removed again. The assets are **not checked in**; for local development you must run the Processing pipeline once to produce them, otherwise the map 404s on load. Note that a local pipeline run therefore always leaves `app.component.ts` modified (new GUIDs) — that change is committable noise, the workflow rewrites it anyway during deployment.

## Processing (`GeoQuest25.Processing/`)

Commands (run from `GeoQuest25.Processing/`):

- `dotnet run --project GeoQuest25.Processing` — runs the full pipeline.
- `dotnet build` — compile only.

What it does (`GeoQuest25.Processing/Program.cs`):

1. Reads `swissBOUNDARIES3D_1_5_TLM_HOHEITSGEBIET.shp` (Swiss municipalities, EPSG:2056 / CH1903+ LV95), reprojects to WGS84, and drops features whose `GEM_FLAECH == SEE_FLAECH` (lakes).
2. Downloads two folders of `.gpx` files from Dropbox — "done" activities (filtered by activity-type keywords in the filename, e.g. "Outdoor Cycling") and "planned" activities (unfiltered). All Dropbox downloads go through `DropboxDownloader.cs` (folder-zip download via `files/download_zip`, extracted flattened into temp directories).
3. For each municipality, checks in parallel whether any GPX track point falls inside its polygon. Splits into `visited` / `todo`; visited ones get a `firstVisit` date, todo ones get `planned=true` if any planned route touches them.
4. Hand-coded special cases merge two "Comunanza" shared-territory polygons into visited when either co-owning municipality has been visited.
5. Exports all done-activity tracks as vector tiles (`TrackExporter.cs`): pre-simplifies each track with Douglas-Peucker (~5 m tolerance, 5 decimal places), writes line-delimited GeoJSON to a temp file and shells out to **tippecanoe** to produce a `tracks-<guid>.pmtiles`. tippecanoe must be on PATH: `brew install tippecanoe` locally; the workflow builds it from source (cached).
6. Walks up from CWD looking for `GeoQuest25.Frontend`, deletes the existing generated assets under `src/assets/`, writes new ones with fresh GUIDs, and rewrites the asset URLs in `src/app/app.component.ts`.

The shape file (public swisstopo data that rarely changes) is checked into the repo under `GeoQuest25.Processing/shapefiles/` and resolved relative to the repo root, so it is available both locally and after checkout in CI.

### Running in CI

`.github/workflows/run-processing.yml` ("Process and Deploy", push to `main` or manual `workflow_dispatch`) runs the pipeline on a GitHub runner with the Dropbox credentials from the repo secrets `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and `DROPBOX_REFRESH_TOKEN`, then builds and deploys the frontend in the same job. Nothing is committed back to the repo.

### Dropbox configuration

The GPX folders come from Dropbox. On the author's machine the locally synced Dropbox folders (under `/Users/raphi/Library/CloudStorage/Dropbox-YARXGmbH/...`) are read directly — no download, no credentials needed; only when a folder is not on disk (i.e. in CI) is it downloaded via the Dropbox API. Authentication uses the Dropbox OAuth refresh-token flow (works unattended in CI, since Dropbox access tokens are short-lived). Configuration comes from **user secrets** locally (`UserSecretsId` is `geoquest25-processing`) and from **environment variables** (`Dropbox__AppKey` etc.) in GitHub Actions:

- `Dropbox:AppKey`, `Dropbox:AppSecret`, `Dropbox:RefreshToken` — required, from the Dropbox app in the developer portal.

The two Dropbox folder paths (done activities: `/Apps/HealthFitExporter`, planned activities: `/01 Privat/10 Projekte/06_GeoQuest/03 GpxTours`) are hardcoded in `Program.cs`.

Set locally via `dotnet user-secrets set "Dropbox:AppKey" "..."` (run from `GeoQuest25.Processing/GeoQuest25.Processing/`).

`ShapeFileReader.TransformCoordinate` converts LV95 → WGS84 using the official swisstopo approximation formulas ("Näherungslösung", polynomial, ~1 m accuracy across Switzerland, ~2.3 m at the very western edge near Geneva) — no ProjNET, no datum-shift parameters needed. If higher accuracy is ever required, the reference is the swisstopo REFRAME service (`geodesy.geo.admin.ch/reframe/lv95towgs84`).

## Cross-cutting notes

- This is a personal hobby project; there is no test coverage on the Processing side and the Frontend ships with the default scaffolded test setup.
- The Mapbox access token is committed in `app.config.ts`. It's a public-scope token for this app and is expected to be there.
