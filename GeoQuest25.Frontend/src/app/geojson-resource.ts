import { resource, ResourceRef, Signal, signal } from '@angular/core';

export type GeoJsonResourceRef = ResourceRef<GeoJSON.FeatureCollection | undefined> & {
  readonly loadedBytes: Signal<number>;
  readonly totalBytes: number;
};

export function geoJsonResource(url: string, totalBytes: number): GeoJsonResourceRef {
  const loadedBytes = signal(0);
  const geoJson = resource({
    loader: async ({ abortSignal }) => {
      loadedBytes.set(0);
      const response = await fetch(url, { signal: abortSignal });
      if (!response.ok || !response.body) {
        throw new Error(`Loading ${url} failed with status ${response.status}`);
      }
      const countedBody = response.body.pipeThrough(
        new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
          transform: (chunk, controller) => {
            loadedBytes.update((loaded) => loaded + chunk.byteLength);
            controller.enqueue(chunk);
          },
        }),
      );
      return (await new Response(countedBody).json()) as GeoJSON.FeatureCollection;
    },
  });
  return Object.assign(geoJson, { loadedBytes: loadedBytes.asReadonly(), totalBytes });
}
