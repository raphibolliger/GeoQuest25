import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideMapboxGL } from 'ngx-mapbox-gl';
import { routes } from './app.routes';

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
