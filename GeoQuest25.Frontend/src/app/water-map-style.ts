import {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  LayoutSpecification,
  LineLayerSpecification,
  Map,
  PaintSpecification,
  RasterLayerSpecification,
  RasterSourceSpecification,
  SourceSpecification,
  SymbolLayerSpecification,
} from 'mapbox-gl';

interface LayerRestyle {
  paint?: Partial<PaintSpecification>;
  layout?: Partial<LayoutSpecification>;
}

const waterFillColor = '#5aa2f0';
const waterwayColor = '#1d6fe0';
const waterLabelColor = '#1a5bb8';
const fadedRoadColor = '#8f8f8f';
const fadedPlaceLabelColor = '#6b6b6b';

const hiddenSourceLayers = ['poi_label', 'airport_label', 'transit_stop_label'];
const waterLabelLayerIds = ['waterway-label', 'water-line-label', 'water-point-label'];

const naturalEarthRiversId = 'natural-earth-rivers';
const naturalEarthRiverLabelsId = 'natural-earth-river-labels';
const naturalEarthRiversFadeOutStartZoom = 7.5;
const naturalEarthRiversFadeOutEndZoom = 8.5;
const naturalEarthZoomHead = 1;
const naturalEarthRiverLabelsSimplification = 8;
const fallbackWaterLabelFont = ['DIN Pro Italic', 'Arial Unicode MS Regular'];
const naturalEarthRiversSource: GeoJSONSourceSpecification = {
  type: 'geojson',
  data: new URL('rivers-europe.geojson', document.baseURI).href,
  attribution: '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
};
const naturalEarthRiversLayer: LineLayerSpecification = {
  id: naturalEarthRiversId,
  type: 'line',
  source: naturalEarthRiversId,
  maxzoom: naturalEarthRiversFadeOutEndZoom,
  filter: shownFromNaturalEarthZoom('min_zoom'),
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': waterwayColor,
    'line-width': ['interpolate', ['linear'], ['zoom'], 3, byRiverSize(1.4, 1, 0.7, 0.5), 6, byRiverSize(2.4, 1.8, 1.3, 0.9), 8, byRiverSize(3.5, 2.6, 2, 1.5)],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], naturalEarthRiversFadeOutStartZoom, 1, naturalEarthRiversFadeOutEndZoom, 0],
  },
};

const swissWaterNetworkId = 'swisstopo-water-network';
const swissWaterNetworkSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-gewaessernetz/default/current/3857/{z}/{x}/{y}.png'],
  tileSize: 256,
  bounds: [5.95, 45.81, 10.5, 47.81],
  maxzoom: 18,
  attribution: '<a href="https://www.swisstopo.admin.ch/">© swisstopo</a>',
};
const swissWaterNetworkLayer: RasterLayerSpecification = {
  id: swissWaterNetworkId,
  type: 'raster',
  source: swissWaterNetworkId,
  minzoom: 11,
  paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 0.75] },
};

const overlaySources: Record<string, SourceSpecification> = {
  [naturalEarthRiversId]: naturalEarthRiversSource,
  [naturalEarthRiverLabelsId]: { ...naturalEarthRiversSource, tolerance: naturalEarthRiverLabelsSimplification },
  [swissWaterNetworkId]: swissWaterNetworkSource,
};

export function applyWaterMapStyle(map: Map, baseLayers: LayerSpecification[], enabled: boolean): void {
  for (const layer of baseLayers) {
    const restyle = waterRestyle(layer);
    if (restyle && map.getLayer(layer.id)) {
      setPaintProperties(map, layer.id, restyledValues(restyle.paint, 'paint' in layer ? layer.paint : undefined, enabled));
      setLayoutProperties(map, layer.id, restyledValues(restyle.layout, 'layout' in layer ? layer.layout : undefined, enabled));
    }
  }
  toggleOverlays(map, baseLayers, enabled);
}

function waterRestyle(layer: LayerSpecification): LayerRestyle | undefined {
  const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : undefined;
  if (sourceLayer === 'water' && layer.type === 'fill') {
    return { paint: { 'fill-color': waterFillColor } };
  }
  if (sourceLayer === 'waterway' && layer.type === 'line') {
    return { paint: { 'line-color': waterwayColor, 'line-width': waterwayWidth() } };
  }
  if (waterLabelLayerIds.includes(layer.id)) {
    return { paint: { 'text-color': waterLabelColor } };
  }
  if (sourceLayer && hiddenSourceLayers.includes(sourceLayer)) {
    return { layout: { visibility: 'none' } };
  }
  if (sourceLayer === 'road' && layer.type === 'line') {
    return { paint: { 'line-color': fadedRoadColor, 'line-opacity': 0.55 } };
  }
  if (sourceLayer === 'road' && layer.type === 'symbol') {
    return { paint: { 'text-opacity': 0.5, 'icon-opacity': 0.4 } };
  }
  if (sourceLayer === 'place_label') {
    return { paint: { 'text-color': fadedPlaceLabelColor } };
  }
  return undefined;
}

function waterwayWidth(): ExpressionSpecification {
  const byClass = (river: number, stream: number, other: number): ExpressionSpecification => ['match', ['get', 'class'], ['river', 'canal'], river, 'stream', stream, other];
  return ['interpolate', ['exponential', 1.4], ['zoom'], 8, byClass(1.2, 0.4, 0.3), 12, byClass(3, 1.4, 0.9), 15, byClass(6, 2.5, 1.6), 18, byClass(12, 4, 2.5)];
}

function shownFromNaturalEarthZoom(zoomProperty: 'min_zoom' | 'min_label'): ExpressionSpecification {
  return ['>=', ['zoom'], ['-', ['get', zoomProperty], naturalEarthZoomHead]];
}

function byRiverSize(largest: number, large: number, medium: number, small: number): ExpressionSpecification {
  return ['step', ['get', 'min_zoom'], largest, 4.5, large, 5.5, medium, 6.5, small];
}

function naturalEarthRiverLabelsLayer(baseLayers: LayerSpecification[]): SymbolLayerSpecification {
  const baseWaterLabel = baseLayers.find((layer) => layer.id === 'water-line-label');
  const font = baseWaterLabel?.type === 'symbol' ? baseWaterLabel.layout?.['text-font'] : undefined;
  return {
    id: naturalEarthRiverLabelsId,
    type: 'symbol',
    source: naturalEarthRiverLabelsId,
    maxzoom: naturalEarthRiversFadeOutStartZoom,
    filter: ['all', ['!=', ['get', 'name'], ''], shownFromNaturalEarthZoom('min_label')],
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'name'],
      'text-font': font ?? fallbackWaterLabelFont,
      'text-size': 12,
      'text-letter-spacing': 0.1,
      'text-max-angle': 45,
    },
    paint: { 'text-color': waterLabelColor, 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  };
}

function restyledValues<T extends object>(restyled: Partial<T> | undefined, base: Partial<T> | undefined, enabled: boolean): Partial<T> {
  const names = Object.keys(restyled ?? {}) as (keyof T)[];
  return Object.fromEntries(names.map((name) => [name, enabled ? restyled?.[name] : base?.[name]])) as Partial<T>;
}

function setPaintProperties(map: Map, layerId: string, paint: Partial<PaintSpecification>): void {
  for (const name of Object.keys(paint) as (keyof PaintSpecification)[]) {
    map.setPaintProperty(layerId, name, paint[name]);
  }
}

function setLayoutProperties(map: Map, layerId: string, layout: Partial<LayoutSpecification>): void {
  for (const name of Object.keys(layout) as (keyof LayoutSpecification)[]) {
    map.setLayoutProperty(layerId, name, layout[name]);
  }
}

function toggleOverlays(map: Map, baseLayers: LayerSpecification[], enabled: boolean): void {
  const firstSymbolLayerId = baseLayers.find((layer) => layer.type === 'symbol')?.id;
  const firstPlaceLabelLayerId = baseLayers.find((layer) => 'source-layer' in layer && layer['source-layer'] === 'place_label')?.id ?? firstSymbolLayerId;
  const overlays: [LineLayerSpecification | RasterLayerSpecification | SymbolLayerSpecification, string | undefined][] = [
    [naturalEarthRiversLayer, firstSymbolLayerId],
    [swissWaterNetworkLayer, firstSymbolLayerId],
    [naturalEarthRiverLabelsLayer(baseLayers), firstPlaceLabelLayerId],
  ];
  for (const [layer, beforeLayerId] of overlays) {
    if (enabled && !map.getLayer(layer.id)) {
      if (!map.getSource(layer.source)) {
        map.addSource(layer.source, overlaySources[layer.source]);
      }
      map.addLayer(layer, beforeLayerId);
    }
    if (!enabled && map.getLayer(layer.id)) {
      map.removeLayer(layer.id);
    }
  }
  if (!enabled) {
    for (const sourceId of Object.keys(overlaySources)) {
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    }
  }
}
