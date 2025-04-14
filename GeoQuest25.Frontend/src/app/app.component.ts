import { CommonModule } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgxMapboxGLModule } from 'ngx-mapbox-gl';
import { fromEvent } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [CommonModule, NgxMapboxGLModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly mapStyleSelection = signal<'light' | 'streets' | 'satellite'>('light');
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

  // keyboard events
  readonly keydown = toSignal(fromEvent<KeyboardEvent>(document, 'keydown'));

  readonly keydownEffect = effect(() => {
    const key = this.keydown();
    if (key?.ctrlKey) {
      if (key.key === '1') {
        this.mapStyleSelection.set('light');
      } else if (key.key === '2') {
        this.mapStyleSelection.set('streets');
      } else if (key.key === '3') {
        this.mapStyleSelection.set('satellite');
      } else if (key.key === 'h') {
        this.hideTodo.update((prev) => !prev);
      }
    }
  });

  readonly visitedData = httpResource<GeoJSON.FeatureCollection>('./assets/visited-60ed980b-687f-43af-8fb5-473c4752de54.geojson');
  readonly todoData = httpResource<GeoJSON.FeatureCollection>('./assets/todo-d1ccddea-472a-4126-8461-73512b7a5735.geojson');

  readonly visitedCount = computed(() => this.visitedData.value()?.features.length);
  readonly todoCount = computed(() => this.todoData.value()?.features.length);
  readonly totalCount = computed(() => (this.visitedCount() ?? 0) + (this.todoCount() ?? 0));

  readonly hideTodo = signal(false);
  readonly selectedMunicipality = signal<{ name: string; firstVisit: string | undefined } | undefined>(undefined);

  linePaint = signal<mapboxgl.LinePaint>({ 'line-color': '#000000', 'line-width': 1 });
  visitedPaint = signal<mapboxgl.FillPaint>({ 'fill-color': '#0000FF', 'fill-opacity': 0.5 });
  todoPaint = signal<mapboxgl.FillPaint>({ 'fill-color': '#FFFFFF', 'fill-opacity': 0.5 });

  layerClick($event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] | undefined } & mapboxgl.EventData): void {
    const name = $event.features?.[0].properties?.['name'];
    const firstVisit = $event.features?.[0].properties?.['firstVisit'];
    if (firstVisit) {
      this.selectedMunicipality.set({ name, firstVisit });
    } else {
      this.selectedMunicipality.set({ name, firstVisit: undefined });
    }
  }

  readonly markerIcon =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <circle cx="12" cy="12" r="8" fill="#4285F4" stroke="white" stroke-width="3"/>
    </svg>
  `);

  geoPermissionStatus = resource({ loader: () => navigator.permissions.query({ name: 'geolocation' }) });

  showPosition = signal(false);

  position = resource({
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

  toggleLocation(): void {
    this.showPosition.update((prev) => !prev);
  }
}
