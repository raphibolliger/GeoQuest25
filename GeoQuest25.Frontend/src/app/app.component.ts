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

  readonly #visited = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/visited-a7c0b7a2-a24f-4221-b812-a214b947cf32.geojson').subscribe((data) => {
    this.visitedData.set(data);
  });

  readonly #todo = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/todo-ee833760-441a-45de-a414-d9082df61a01.geojson').subscribe((data) => {
    this.todoData.set(data);
  });

  readonly visitedData = signal<GeoJSON.FeatureCollection | undefined>(undefined);
  readonly todoData = signal<GeoJSON.FeatureCollection | undefined>(undefined);

  readonly visitedCount = computed(() => this.visitedData()?.features.length);
  readonly todoCount = computed(() => this.todoData()?.features.length);

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
