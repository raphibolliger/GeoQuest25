import { ExpressionSpecification, LayerSpecification, LayoutSpecification, Map, PaintSpecification, RasterLayerSpecification, RasterSourceSpecification } from 'mapbox-gl';

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

export function applyWaterMapStyle(map: Map, baseLayers: LayerSpecification[], enabled: boolean): void {
  for (const layer of baseLayers) {
    const restyle = waterRestyle(layer);
    if (restyle && map.getLayer(layer.id)) {
      setPaintProperties(map, layer.id, restyledValues(restyle.paint, 'paint' in layer ? layer.paint : undefined, enabled));
      setLayoutProperties(map, layer.id, restyledValues(restyle.layout, 'layout' in layer ? layer.layout : undefined, enabled));
    }
  }
  toggleSwissWaterNetwork(map, baseLayers, enabled);
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

function toggleSwissWaterNetwork(map: Map, baseLayers: LayerSpecification[], enabled: boolean): void {
  if (enabled && !map.getLayer(swissWaterNetworkId)) {
    if (!map.getSource(swissWaterNetworkId)) {
      map.addSource(swissWaterNetworkId, swissWaterNetworkSource);
    }
    map.addLayer(swissWaterNetworkLayer, baseLayers.find((layer) => layer.type === 'symbol')?.id);
  }
  if (!enabled) {
    if (map.getLayer(swissWaterNetworkId)) {
      map.removeLayer(swissWaterNetworkId);
    }
    if (map.getSource(swissWaterNetworkId)) {
      map.removeSource(swissWaterNetworkId);
    }
  }
}
