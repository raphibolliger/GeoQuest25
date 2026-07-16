import { registerLocaleData } from '@angular/common';
import localeDeCh from '@angular/common/locales/de-CH';
import { ApplicationConfig, LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient, withXhr } from '@angular/common/http';
import mapboxgl from 'mapbox-gl';
import { provideMapboxGL } from 'ngx-mapbox-gl';
import { routes } from './app.routes';

// swiss german locale so the DatePipe renders dates like "19. April 2025"
registerLocaleData(localeDeCh);

// load the map worker from a static copy instead of the inlined blob; the blob version
// gets mangled by the dev server (vite) and then fails to load the pmtiles tile
// provider plugin inside the worker
mapboxgl.workerUrl = new URL('assets/mapbox-gl-csp-worker.js', document.baseURI).href;

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    { provide: LOCALE_ID, useValue: 'de-CH' },
    provideRouter(routes),
    provideHttpClient(withXhr()),
    provideMapboxGL({
      accessToken: 'pk.eyJ1IjoicmFwaGlib2xsaWdlciIsImEiOiJjbG1hOXF6d3cwOGtmM2ZzZzVqbHdlYzdpIn0.1ig4AVATbPkclRMLN-B_WQ',
    }),
  ],
};
