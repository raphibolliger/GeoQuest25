import { CommonModule } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Expression } from 'mapbox-gl';
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

  readonly visitedData = httpResource<GeoJSON.FeatureCollection>('./assets/visited-ffefd3a5-a055-491e-a4f5-4abbaf8b8ccd.geojson');
  readonly todoData = httpResource<GeoJSON.FeatureCollection>('./assets/todo-3e37e91d-674e-4eac-8780-d9538ba5e05e.geojson');

  readonly visitedCount = computed(() => this.visitedData.value()?.features.length);
  readonly todoCount = computed(() => this.todoData.value()?.features.length);
  readonly totalCount = computed(() => (this.visitedCount() ?? 0) + (this.todoCount() ?? 0));

  readonly hideTodo = signal(false);
  readonly selectedMunicipality = signal<{ name: string; firstVisit: string | undefined } | undefined>(undefined);

  linePaint = signal<mapboxgl.LinePaint>({ 'line-color': '#000000', 'line-width': 1 });

  visitedPaint = computed<mapboxgl.FillPaint>(() => {
    const hideTodo = this.hideTodo();
    const fillExpression: Expression = ['case', ['==', ['get', 'name'], this.selectedMunicipality()?.name ?? ''], '#FFFF00', '#0000FF'];
    return { 'fill-color': fillExpression, 'fill-opacity': hideTodo ? 0.2 : 0.5 };
  });

  todoPaint = computed<mapboxgl.FillPaint>(() => {
    const hideTodo = this.hideTodo();
    const fillExpression: Expression = ['case', ['==', ['get', 'name'], this.selectedMunicipality()?.name ?? ''], '#FF0000', hideTodo ? 'transparent' : '#FFFFFF'];
    return { 'fill-color': fillExpression, 'fill-opacity': hideTodo ? 0.2 : 0.5 };
  });

  layerClick($event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] | undefined } & mapboxgl.EventData): void {
    const properties = $event.features?.[0].properties;
    const name = properties?.['name'];
    const firstVisit = properties?.['firstVisit'];
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
