import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { NgxMapboxGLModule } from 'ngx-mapbox-gl';

@Component({
  selector: 'app-root',
  imports: [CommonModule, NgxMapboxGLModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly #httpClient = inject(HttpClient);

  readonly mapStyleSelection = signal<'map' | 'sattelite'>('map');
  readonly mapStyle = computed(() => {
    switch (this.mapStyleSelection()) {
      case 'sattelite':
        return 'mapbox://styles/mapbox/satellite-streets-v12';
      default:
        return 'mapbox://styles/mapbox/streets-v12';
    }
  });

  readonly #visited = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/visited-ab519dc5-397e-4210-a775-b63df7102976.geojson').subscribe((data) => {
    this.visitedData.set(data);
  });

  // readonly todoDataNew = httpResource();

  readonly #todo = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/todo-5a169f8a-637c-43aa-8291-37fbc6e0aeb6.geojson').subscribe((data) => {
    this.todoData.set(data);
  });

  readonly visitedData = signal<GeoJSON.FeatureCollection | undefined>(undefined);
  readonly todoData = signal<GeoJSON.FeatureCollection | undefined>(undefined);

  readonly visitedCount = computed(() => this.visitedData()?.features.length);
  readonly todoCount = computed(() => this.todoData()?.features.length);
  readonly totalCount = computed(() => (this.visitedCount() ?? 0) + (this.todoCount() ?? 0));

  readonly selectedMunicipality = signal<{ name: string; firstVisit: string | undefined } | undefined>(undefined);

  linePaint = signal<mapboxgl.LinePaint>({
    'line-color': '#000000',
    'line-width': 1,
  });

  visitedPaint = signal<mapboxgl.FillPaint>({
    'fill-color': '#0000FF',
    'fill-opacity': 0.5,
  });

  todoPaint = signal<mapboxgl.FillPaint>({
    'fill-color': '#FFFFFF',
    'fill-opacity': 0.5,
  });

  layerClick(
    $event: mapboxgl.MapMouseEvent & {
      features?: mapboxgl.MapboxGeoJSONFeature[] | undefined;
    } & mapboxgl.EventData
  ): void {
    const name = $event.features?.[0].properties?.['name'];
    const firstVisit = $event.features?.[0].properties?.['firstVisit'];
    if (firstVisit) {
      this.selectedMunicipality.set({ name, firstVisit });
    } else {
      this.selectedMunicipality.set({ name, firstVisit: undefined });
    }
  }
}
