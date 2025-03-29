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

  readonly #visited = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/visited-bc3751f0-4d25-4c4d-9c64-f7841cea9edc.geojson').subscribe((data) => {
    this.visitedData.set(data);
  });

  readonly #todo = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/todo-69b86f67-a369-4a51-8bcc-5bebd4d336fe.geojson').subscribe((data) => {
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
