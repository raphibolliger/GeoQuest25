import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NgxMapboxGLModule } from 'ngx-mapbox-gl';
import { delay } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [CommonModule, NgxMapboxGLModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly #httpClient = inject(HttpClient);

  readonly #visited = this.#httpClient.get<GeoJSON.FeatureCollection>('./assets/visited-97af0229-7fa9-4ace-b011-b1594cc3e63e.geojson').subscribe((data) => {
    console.log(data);
    this.visitedData.set(data);
  });

  readonly #todo = this.#httpClient
    .get<GeoJSON.FeatureCollection>('./assets/todo-3d8ac21d-df14-47e8-b181-5df77ca808e6.geojson')
    .pipe(delay(7000))
    .subscribe((data) => {
      console.log(data);
      this.todoData.set(data);
    });

  readonly visitedData = signal<GeoJSON.FeatureCollection | undefined>(undefined);
  readonly todoData = signal<GeoJSON.FeatureCollection | undefined>(undefined);

  readonly selectedMunicipality = signal<string | undefined>(undefined);

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
    console.log($event.features?.[0].properties?.['name']);
    this.selectedMunicipality.set($event.features?.[0].properties?.['name']);
  }
}
