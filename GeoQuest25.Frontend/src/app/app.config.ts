import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient } from '@angular/common/http';
import { provideMapboxGL } from 'ngx-mapbox-gl';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideMapboxGL({
      accessToken: 'pk.eyJ1IjoicmFwaGlib2xsaWdlciIsImEiOiJjbG1hOXF6d3cwOGtmM2ZzZzVqbHdlYzdpIn0.1ig4AVATbPkclRMLN-B_WQ',
    }),
  ],
};
