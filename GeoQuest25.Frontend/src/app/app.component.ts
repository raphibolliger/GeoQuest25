import { CommonModule } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, signal } from '@angular/core';
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
  readonly mapStyleSelection = signal<'light' | 'streets' | 'sattelite'>('light');
  readonly mapStyle = computed(() => {
    switch (this.mapStyleSelection()) {
      case 'streets':
        return 'mapbox://styles/mapbox/outdoors-v12';
      case 'sattelite':
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
        this.mapStyleSelection.set('sattelite');
      } else if (key.key === 'h') {
        this.hideTodo.update((prev) => !prev);
      }
    }
  });

  readonly visitedData = httpResource<GeoJSON.FeatureCollection>('./assets/visited-ab519dc5-397e-4210-a775-b63df7102976.geojson');
  readonly todoData = httpResource<GeoJSON.FeatureCollection>('./assets/todo-5a169f8a-637c-43aa-8291-37fbc6e0aeb6.geojson');

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
}
