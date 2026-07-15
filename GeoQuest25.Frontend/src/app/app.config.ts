import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient, withXhr } from '@angular/common/http';
import mapboxgl from 'mapbox-gl';
import { provideMapboxGL } from 'ngx-mapbox-gl';
import { routes } from './app.routes';

// load the map worker from a static copy instead of the inlined blob; the blob version
// gets mangled by the dev server (vite) and then fails to load the pmtiles tile
// provider plugin inside the worker
mapboxgl.workerUrl = new URL('assets/mapbox-gl-csp-worker.js', document.baseURI).href;

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(withXhr()),
    provideMapboxGL({
      accessToken: 'pk.eyJ1IjoicmFwaGlib2xsaWdlciIsImEiOiJjbG1hOXF6d3cwOGtmM2ZzZzVqbHdlYzdpIn0.1ig4AVATbPkclRMLN-B_WQ',
    }),
  ],
};
