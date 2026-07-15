import { NgClass } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, linkedSignal, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ExpressionSpecification, FillLayerSpecification, Map, MapEventType, MapMouseEvent } from 'mapbox-gl';
import { ControlComponent, GeoJSONSourceComponent, LayerComponent, MapComponent, MarkerComponent, RasterDemSourceComponent, VectorSourceComponent } from 'ngx-mapbox-gl';
import { fromEvent } from 'rxjs';

const markerIcon =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <circle cx="12" cy="12" r="8" fill="#4285F4" stroke="white" stroke-width="3"/>
    </svg>
  `);

@Component({
  selector: 'app-root',
  imports: [NgClass, MapComponent, GeoJSONSourceComponent, LayerComponent, MarkerComponent, RasterDemSourceComponent, ControlComponent, VectorSourceComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.component.html',
})
export class AppComponent {
  // consts
  readonly markerIcon = markerIcon;

  // keyboard events
  readonly #keydown = toSignal(fromEvent<KeyboardEvent>(document, 'keydown'));

  // signals
  readonly linePaint = signal({ 'line-color': '#000000', 'line-width': 1 });
  readonly selectedMunicipality = signal<{ name: string; firstVisit: string | undefined } | undefined>(undefined);
  readonly showPosition = signal(false);
  readonly map = signal<Map | undefined>(undefined);
  readonly showTerrain = signal(false);
  readonly showPlanned = signal(false);
  readonly showTracks = signal(false);

  // the tracks file name ends with the sha256 hash of the routes secret; only the
  // "tracks-<guid>" prefix (rewritten by the processing pipeline) is known here, the hash
  // is derived from the ?routes=<secret> query param. the HEAD request verifies the file
  // actually exists, so a wrong secret behaves like no secret — no url, no button.
  // mapbox-gl detects the .pmtiles extension and loads the file via range requests,
  // so only the tiles in view are actually downloaded
  readonly #tracksFilePrefix = 'tracks-28036126-116d-486f-9667-f352af3b1cef';
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

  readonly visitedCount = computed(() => this.visitedData.value()?.features.length);
  readonly todoCount = computed(() => this.todoData.value()?.features.length);
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
  readonly visitedData = httpResource<GeoJSON.FeatureCollection>(() => './assets/visited-e7a09ba9-3a24-498b-9e37-6048f9ff4702.geojson');
  readonly todoData = httpResource<GeoJSON.FeatureCollection>(() => './assets/todo-75f8c884-dd62-450e-b5e0-6b718831d838.geojson');
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
    const showTerrain = this.showTerrain();
    const map = this.map();
    if (showTerrain) {
      map?.setTerrain({ source: 'mapbox-dem', exaggeration: 2.5 });
    } else {
      map?.setTerrain(null);
    }
  });

  // view actions
  onLoad(event: { type: MapEventType; target: Map }): void {
    this.map.set(event.target);
  }

  layerClick($event: MapMouseEvent): void {
    const properties = getProperties($event.features?.[0].properties);
    this.selectedMunicipality.update((prev) => (prev?.name === properties?.name ? undefined : properties));
  }

  toggleLocation(): void {
    this.showPosition.update((prev) => !prev);
  }
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
