import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NgxMapboxGLModule } from 'ngx-mapbox-gl';

@Component({
  selector: 'app-root',
  imports: [CommonModule, NgxMapboxGLModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly #httpClient = inject(HttpClient);

  #geoJsonSub = this.#httpClient.get<GeoJSON.FeatureCollection>('/assets/switzerland-municipalities-234523.geojson').subscribe((data) => {
    console.log(data);
    this.geoJson.set(data);
  });

  geoJson = signal<GeoJSON.FeatureCollection | undefined>(undefined);

  paint = signal<mapboxgl.FillPaint>({
    'fill-color': '#088',
    'fill-opacity': 0.8,
  });
}
