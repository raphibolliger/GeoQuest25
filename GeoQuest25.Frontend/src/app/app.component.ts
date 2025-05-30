import { CommonModule } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, linkedSignal, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Expression } from 'mapbox-gl';
import { NgxMapboxGLModule } from 'ngx-mapbox-gl';
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
  imports: [CommonModule, NgxMapboxGLModule],
  templateUrl: './app.component.html',
})
export class AppComponent {
  // consts
  readonly markerIcon = markerIcon;

  // keyboard events
  readonly #keydown = toSignal(fromEvent<KeyboardEvent>(document, 'keydown'));

  // signals
  readonly linePaint = signal<mapboxgl.LinePaint>({ 'line-color': '#000000', 'line-width': 1 });
  readonly selectedMunicipality = signal<{ name: string; firstVisit: string | undefined } | undefined>(undefined);
  readonly showPosition = signal(false);

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
      return previous?.value ?? 'light';
    },
  });

  readonly #showTransparent = linkedSignal<KeyboardEvent | undefined, boolean>({
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
  readonly visitedPaint = computed<mapboxgl.FillPaint>(() => {
    const showTransparent = this.#showTransparent();
    const fillExpression: Expression = ['case', ['==', ['get', 'name'], this.selectedMunicipality()?.name ?? ''], '#FFFF00', '#0000FF'];
    return { 'fill-color': fillExpression, 'fill-opacity': showTransparent ? 0.2 : 0.5 };
  });
  readonly todoPaint = computed<mapboxgl.FillPaint>(() => {
    const showTransparent = this.#showTransparent();
    const fillExpression: Expression = [
      'case',
      // set to red if selected
      ['==', ['get', 'name'], this.selectedMunicipality()?.name ?? ''],
      '#FF0000',
      // set to green if planned
      ['==', ['get', 'planned'], true],
      '#00FF00',
      // fallback to white or transparent if not visited and not planned
      showTransparent ? 'transparent' : '#FFFFFF',
    ];
    return { 'fill-color': fillExpression, 'fill-opacity': showTransparent ? 0.2 : 0.5 };
  });

  // resources
  readonly visitedData = httpResource<GeoJSON.FeatureCollection>('./assets/visited-fa450e44-bb1c-4e76-8ecd-b6583f0c2271.geojson');
  readonly todoData = httpResource<GeoJSON.FeatureCollection>('./assets/todo-b4d40cba-e19d-4f90-b237-39b11eecc632.geojson');
  readonly geoPermissionStatus = resource({ loader: () => navigator.permissions.query({ name: 'geolocation' }) });
  readonly position = resource({
    request: () => this.showPosition(),
    loader: (request) => {
      if (request.request) {
        return new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (position) => resolve(position),
            (error) => reject(error)
          );
        });
      } else {
        return Promise.resolve(undefined);
      }
    },
  });

  // view actions
  layerClick($event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] | undefined } & mapboxgl.EventData): void {
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
