import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, linkedSignal, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ExpressionSpecification, FillLayerSpecification, Map, MapEventType, MapMouseEvent } from 'mapbox-gl';
import {
  AttributionControlDirective,
  ControlComponent,
  GeoJSONSourceComponent,
  LayerComponent,
  MapComponent,
  MarkerComponent,
  RasterDemSourceComponent,
  VectorSourceComponent,
} from 'ngx-mapbox-gl';
import { fromEvent } from 'rxjs';
import { geoJsonResource } from './geojson-resource';

const markerIcon =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <circle cx="12" cy="12" r="8" fill="#4285F4" stroke="white" stroke-width="3"/>
    </svg>
  `);

const routesSecretLongPressMs = 4000;
const bytesPerMegabyte = 1_000_000;
const terrainDemTiles = ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'];
const terrainDemAttribution = '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>';
const smartphoneCameraDiagonalFovDegrees = 84;
const mapboxMaxVerticalFovDegrees = 60;

type LoadingState = 'pending' | 'active' | 'done' | 'failed';

interface LoadingStep {
  label: string;
  state: LoadingState;
  progress?: { loadedMegabytes: number; totalMegabytes: number; percent: number };
}

@Component({
  selector: 'app-root',
  imports: [
    NgClass,
    DatePipe,
    DecimalPipe,
    MapComponent,
    GeoJSONSourceComponent,
    LayerComponent,
    MarkerComponent,
    RasterDemSourceComponent,
    ControlComponent,
    AttributionControlDirective,
    VectorSourceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.component.html',
})
export class AppComponent {
  // consts
  readonly markerIcon = markerIcon;
  readonly terrainDemTiles = terrainDemTiles;
  readonly terrainDemAttribution = terrainDemAttribution;

  // keyboard events
  readonly #keydown = toSignal(fromEvent<KeyboardEvent>(document, 'keydown'));

  // signals
  readonly linePaint = signal({ 'line-color': '#000000', 'line-width': 1 });
  readonly selectedMunicipality = signal<{ name: string; firstVisit: string | undefined } | undefined>(undefined);
  readonly showPosition = signal(false);
  readonly map = signal<Map | undefined>(undefined);
  readonly mapCanvasSize = signal({ width: 0, height: 0 });
  readonly showTerrain = signal(false);
  readonly showPlanned = signal(false);
  readonly showTracks = signal(false);
  readonly showRoutesSecretDialog = signal(false);
  readonly routesSecretRejected = signal(false);
  readonly municipalitiesDrawn = signal(false);

  #plannedLongPressTimer: ReturnType<typeof setTimeout> | undefined;
  #plannedLongPressFired = false;
  #defaultVerticalFovDegrees = 0;

  // the tracks file name ends with the sha256 hash of the routes secret; only the
  // "tracks-<guid>" prefix (rewritten by the processing pipeline) is known here, the hash
  // is derived from the ?routes=<secret> query param. the HEAD request verifies the file
  // actually exists, so a wrong secret behaves like no secret — no url, no button.
  // mapbox-gl detects the .pmtiles extension and loads the file via range requests,
  // so only the tiles in view are actually downloaded
  readonly #tracksFilePrefix = 'tracks-c4b2b953-36d6-4d7c-b435-311689164336';
  readonly #tracksUrlResource = resource({
    loader: async () => {
      // a secret from the query param wins; a previously proven secret is remembered in
      // localStorage so later visits work without the param
      const secretFromUrl = new URLSearchParams(window.location.search).get('routes');
      const storedSecret = localStorage.getItem('routesSecret');
      const candidates = [...new Set([secretFromUrl, storedSecret])].filter((secret): secret is string => secret !== null);

      for (const secret of candidates) {
        const url = await this.#probeTracksUrl(secret);
        if (url) {
          localStorage.setItem('routesSecret', secret);
          return url;
        }
      }

      // no candidate resolves to an existing file (e.g. the secret was rotated) — forget it
      localStorage.removeItem('routesSecret');
      return undefined;
    },
  });
  readonly tracksUrl = computed(() => this.#tracksUrlResource.value());

  async #probeTracksUrl(secret: string): Promise<string | undefined> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const url = new URL(`assets/${this.#tracksFilePrefix}-${hash}.pmtiles`, document.baseURI).href;
    // fetch the first bytes and verify the pmtiles magic — a plain status check is not
    // enough because dev servers answer unknown paths with the index.html (SPA fallback)
    const response = await fetch(url, { headers: { Range: 'bytes=0-6' } });
    if (!response.ok) return undefined;
    const magic = new TextDecoder().decode((await response.bytes()).slice(0, 7));
    return magic === 'PMTiles' ? url : undefined;
  }
  readonly tracksPaint = { 'line-color': '#FFD500', 'line-width': 2.5, 'line-opacity': 0.85 };
  readonly plannedRoutesPaint = { 'line-color': '#FF0000', 'line-width': 2.5, 'line-opacity': 0.9 };

  // linked signals
  readonly mapStyleSelection = linkedSignal<KeyboardEvent | undefined, 'light' | 'streets' | 'satellite'>({
    source: this.#keydown,
    computation: (keydown, previous) => {
      if (keydown?.ctrlKey) {
        if (keydown.key === '1') {
          return 'light';
        } else if (keydown.key === '2') {
          return 'streets';
        } else if (keydown.key === '3') {
          return 'satellite';
        }
      }
      return previous?.value ?? 'streets';
    },
  });

  readonly showTransparent = linkedSignal<KeyboardEvent | undefined, boolean>({
    source: this.#keydown,
    computation: (keydown, previous) => {
      // if ctrl + h is pressed, toggle the hideTodo signal
      if (keydown?.ctrlKey && keydown.key === 'h') {
        return !previous?.value;
      }
      return previous?.value ?? false;
    },
  });

  // computed
  readonly mapStyle = computed(() => {
    switch (this.mapStyleSelection()) {
      case 'streets':
        return 'mapbox://styles/mapbox/outdoors-v12';
      case 'satellite':
        return 'mapbox://styles/mapbox/satellite-streets-v12';
      default:
        return 'mapbox://styles/mapbox/light-v11';
    }
  });

  readonly visitedGeoJson = computed(() => (this.visitedData.hasValue() ? this.visitedData.value() : undefined));
  readonly todoGeoJson = computed(() => (this.todoData.hasValue() ? this.todoData.value() : undefined));
  readonly plannedRoutesGeoJson = computed(() => (this.plannedRoutesData.hasValue() ? this.plannedRoutesData.value() : undefined));

  readonly municipalitiesLoadingState = computed<LoadingState>(() => {
    if (this.visitedData.error() || this.todoData.error()) {
      return 'failed';
    }
    return this.visitedGeoJson() && this.todoGeoJson() ? 'done' : 'active';
  });
  readonly municipalitiesLoadingProgress = computed(() => {
    const totalBytes = this.visitedData.totalBytes + this.todoData.totalBytes;
    const loadedBytes = Math.min(this.visitedData.loadedBytes() + this.todoData.loadedBytes(), totalBytes);
    return {
      loadedMegabytes: loadedBytes / bytesPerMegabyte,
      totalMegabytes: totalBytes / bytesPerMegabyte,
      percent: Math.floor((loadedBytes / totalBytes) * 100),
    };
  });
  readonly loadingSteps = computed<LoadingStep[]>(() => {
    const baseMapLoaded = this.map() !== undefined;
    const municipalitiesState = this.municipalitiesLoadingState();
    const drawingState = this.municipalitiesDrawn() ? 'done' : baseMapLoaded && municipalitiesState === 'done' ? 'active' : 'pending';
    return [
      { label: 'App', state: 'done' },
      { label: 'Base map', state: baseMapLoaded ? 'done' : 'active' },
      {
        label: 'Municipalities',
        state: municipalitiesState,
        progress: municipalitiesState === 'active' ? this.municipalitiesLoadingProgress() : undefined,
      },
      { label: 'Drawing', state: drawingState },
    ];
  });
  readonly loadingFailed = computed(() => this.municipalitiesLoadingState() === 'failed');

  readonly visitedCount = computed(() => this.visitedGeoJson()?.features.length);
  readonly todoCount = computed(() => this.todoGeoJson()?.features.length);
  readonly totalCount = computed(() => (this.visitedCount() ?? 0) + (this.todoCount() ?? 0));
  readonly visitedPaint = computed<FillLayerSpecification['paint']>(() => {
    const showTransparent = this.showTransparent();
    const fillExpression: ExpressionSpecification = ['case', ['==', ['get', 'name'], this.selectedMunicipality()?.name ?? ''], '#FFFF00', '#0000FF'];
    return { 'fill-color': fillExpression, 'fill-opacity': showTransparent ? 0.2 : 0.5 };
  });
  readonly todoPaint = computed<FillLayerSpecification['paint']>(() => {
    const showTransparent = this.showTransparent();
    const fillExpression: ExpressionSpecification = [
      'case',
      // set to red if selected
      ['==', ['get', 'name'], this.selectedMunicipality()?.name ?? ''],
      '#FF0000',
      // set to green if planned
      this.showPlanned() ? ['==', ['get', 'planned'], true] : false,
      '#00FF00',
      // fallback to white or transparent if not visited and not planned
      showTransparent ? 'transparent' : '#FFFFFF',
    ];
    return { 'fill-color': fillExpression, 'fill-opacity': showTransparent ? 0.2 : 0.5 };
  });

  // resources
  readonly visitedData = geoJsonResource('./assets/visited-83476a9a-53d9-4f47-a812-6d3243a84693.geojson', 22611872);
  readonly todoData = geoJsonResource('./assets/todo-09b3b6e5-81d0-4f7c-8a96-e8f31f6c609e.geojson', 2091531);
  readonly plannedRoutesData = httpResource<GeoJSON.FeatureCollection>(() => './assets/planned-69f183f6-2598-421a-81bc-32ef8a04d75c.geojson');
  readonly geoPermissionStatus = resource({ loader: () => navigator.permissions.query({ name: 'geolocation' }) });
  readonly position = resource({
    params: () => ({ showPosition: this.showPosition() }),
    loader: ({ params }) => {
      if (params.showPosition) {
        return new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (position) => resolve(position),
            (error) => {
              switch (error.code) {
                case error.PERMISSION_DENIED:
                  reject(new Error('User denied the request for Geolocation.'));
                  break;
                case error.POSITION_UNAVAILABLE:
                  reject(new Error('Location information is unavailable.'));
                  break;
                case error.TIMEOUT:
                  reject(new Error('The request to get user location timed out.'));
                  break;
                default:
                  reject(new Error('An unknown error occurred.'));
                  break;
              }
            },
            { timeout: 5000 },
          );
        });
      } else {
        return Promise.resolve(undefined);
      }
    },
  });

  // effects
  readonly terrainEffect = effect(() => {
    const map = this.map();
    if (map) {
      applyTerrain(map, this.showTerrain());
    }
  });
  readonly fieldOfViewEffect = effect(() => {
    const map = this.map();
    const { width, height } = this.mapCanvasSize();
    if (map && width > 0 && height > 0) {
      map.transform.fov = this.showTerrain() ? smartphoneCameraVerticalFovDegrees(width, height) : this.#defaultVerticalFovDegrees;
      map.triggerRepaint();
    }
  });

  // view actions
  onLoad(event: { type: MapEventType; target: Map }): void {
    const map = event.target;
    this.#defaultVerticalFovDegrees = map.transform.fov;
    map.on('style.load', () => applyTerrain(map, this.showTerrain()));
    this.mapCanvasSize.set(canvasSize(map));
    this.map.set(map);
  }

  onResize(): void {
    const map = this.map();
    if (map) {
      this.mapCanvasSize.set(canvasSize(map));
    }
  }

  onIdle(): void {
    const map = this.map();
    if (map?.getSource('visited') && map.getSource('todo')) {
      this.municipalitiesDrawn.set(true);
    }
  }

  retryLoading(): void {
    if (this.visitedData.error()) {
      this.visitedData.reload();
    }
    if (this.todoData.error()) {
      this.todoData.reload();
    }
  }

  layerClick($event: MapMouseEvent): void {
    const properties = getProperties($event.features?.[0].properties);
    this.selectedMunicipality.update((prev) => (prev?.name === properties?.name ? undefined : properties));
  }

  toggleLocation(): void {
    this.showPosition.update((prev) => !prev);
  }

  startPlannedLongPress(): void {
    this.#plannedLongPressFired = false;
    clearTimeout(this.#plannedLongPressTimer);
    this.#plannedLongPressTimer = setTimeout(() => {
      this.#plannedLongPressFired = true;
      this.routesSecretRejected.set(false);
      this.showRoutesSecretDialog.set(true);
    }, routesSecretLongPressMs);
  }

  cancelPlannedLongPress(): void {
    clearTimeout(this.#plannedLongPressTimer);
  }

  togglePlanned(): void {
    if (this.#plannedLongPressFired) {
      this.#plannedLongPressFired = false;
      return;
    }
    this.showPlanned.update((prev) => !prev);
  }

  async submitRoutesSecret(event: Event, secret: string): Promise<void> {
    event.preventDefault();
    const trimmedSecret = secret.trim();
    const url = trimmedSecret ? await this.#probeTracksUrl(trimmedSecret).catch(() => undefined) : undefined;
    if (!url) {
      this.routesSecretRejected.set(true);
      return;
    }
    localStorage.setItem('routesSecret', trimmedSecret);
    this.#tracksUrlResource.set(url);
    this.showTracks.set(true);
    this.showRoutesSecretDialog.set(false);
  }
}

function applyTerrain(map: Map, showTerrain: boolean): void {
  map.setTerrain(showTerrain ? { source: 'terrain-dem', exaggeration: 1 } : null);
}

function canvasSize(map: Map): { width: number; height: number } {
  const canvas = map.getCanvas();
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

function smartphoneCameraVerticalFovDegrees(width: number, height: number): number {
  const halfDiagonalTan = Math.tan((smartphoneCameraDiagonalFovDegrees * Math.PI) / 360);
  const halfVerticalTan = (halfDiagonalTan * height) / Math.hypot(width, height);
  return Math.min((Math.atan(halfVerticalTan) * 360) / Math.PI, mapboxMaxVerticalFovDegrees);
}

function getProperties(properties: unknown): { name: string; firstVisit: string | undefined } | undefined {
  if (properties && typeof properties === 'object') {
    if ('name' in properties && typeof properties.name === 'string') {
      const firstVisit = 'firstVisit' in properties && typeof properties.firstVisit === 'string' ? properties.firstVisit : undefined;
      return { name: properties.name, firstVisit };
    }
  }
  return undefined;
}
