import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient } from '@angular/common/http';
import { NgxMapboxGLModule } from 'ngx-mapbox-gl';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    importProvidersFrom([
      NgxMapboxGLModule.withConfig({
        accessToken: 'pk.eyJ1IjoicmFwaGlib2xsaWdlciIsImEiOiJjbG1hOXF6d3cwOGtmM2ZzZzVqbHdlYzdpIn0.1ig4AVATbPkclRMLN-B_WQ', // Optional, can also be set per map (accessToken input of mgl-map)
      }),
    ]),
  ],
};
