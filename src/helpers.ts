import {
  buildUnwrappedPolygonRings,
  buildUnwrappedPolylinePath,
  createGeoPoint,
  type GeoPoint,
  type GeoPointInterface,
  overlayStackBeforeId,
  type OverlayKind,
  type OverlayStackKey,
  type PolygonState,
  POLYGON_TILE_LAYER_ID,
  POLYLINE_TILE_LAYER_ID,
  CIRCLE_TILE_LAYER_ID,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';

/** Azure Maps positions are [longitude, latitude] tuples. */
export type Position = [number, number];

/** Id of the marker `SymbolLayer` (see AzureMapsMarkerOverlayRenderer). */
export const MARKER_SYMBOL_LAYER_ID = 'mc-marker-symbols-layer';

// Stacking keys of the layers this SDK added, per map, by layer id.
const stackKeys = new WeakMap<object, Map<string, OverlayStackKey>>();
const stackSequences = new WeakMap<object, number>();

const MARKER_TILES_STATE_ID = 'mc-marker-tiles';

function stackKeyOf(map: atlas.Map, layerId: string): OverlayStackKey | null {
  if (layerId === MARKER_SYMBOL_LAYER_ID) return { kind: 'marker', sub: 1 };
  return stackKeys.get(map)?.get(layerId) ?? null;
}

/**
 * Adds an overlay's layers at its place in the shared stack (js-sdk-core OVERLAY_STACK_ORDER):
 * raster < ground image < polygon < circle < polyline < marker, zIndex within the band, and
 * equal zIndexes in the order they were handed over. The layers of one overlay (fill, stroke)
 * stay together in the order given.
 *
 * Every overlay used to go "just below the marker layer", so the order between kinds was the
 * order they were added in; rasters went on top of everything, markers included.
 */
export function addStackedLayers(
  map: atlas.Map,
  layers: atlas.layer.Layer | atlas.layer.Layer[],
  kind: OverlayKind,
  zIndex: number | null | undefined = 0,
): void {
  const list = Array.isArray(layers) ? layers : [layers];
  let keys = stackKeys.get(map);
  if (!keys) {
    keys = new Map();
    stackKeys.set(map, keys);
  }
  const sequence = (stackSequences.get(map) ?? 0) + 1;
  stackSequences.set(map, sequence);
  list.forEach((layer, sub) => keys!.set(layer.getId(), { kind, zIndex: zIndex ?? 0, sequence, sub }));
  const order = map.layers
    .getLayers()
    .map((layer) => (typeof layer.getId === 'function' ? layer.getId() : ''));
  const beforeId = overlayStackBeforeId(order, (id) => stackKeyOf(map, id), keys.get(list[0].getId())!);
  map.layers.add(list, beforeId);
}

/**
 * Marker tiles are mounted as a raster but belong with the markers; polygon tiles with the
 * polygons, circle tiles with the circles, polyline tiles with the polylines.
 */
export function rasterStackKind(stateId: string): OverlayKind {
  if (stateId === MARKER_TILES_STATE_ID) return 'marker';
  if (stateId === POLYGON_TILE_LAYER_ID) return 'polygon';
  if (stateId === CIRCLE_TILE_LAYER_ID) return 'circle';
  if (stateId === POLYLINE_TILE_LAYER_ID) return 'polyline';
  return 'rasterLayer';
}

/** Forget the keys of layers that were removed. */
export function forgetStackedLayers(map: atlas.Map, layers: atlas.layer.Layer | atlas.layer.Layer[]): void {
  const keys = stackKeys.get(map);
  if (!keys) return;
  for (const layer of Array.isArray(layers) ? layers : [layers]) keys.delete(layer.getId());
}

export function toPosition(point: GeoPointInterface): Position {
  return [point.longitude, point.latitude];
}

export function fromPosition(position: atlas.data.Position): GeoPoint {
  return createGeoPoint({ latitude: position[1], longitude: position[0] });
}

/** Geographic location of a map mouse/touch event, or null when unavailable. */
export function positionFromEvent(event: { position?: atlas.data.Position }): GeoPoint | null {
  const p = event.position;
  if (!p) return null;
  return createGeoPoint({ latitude: p[1], longitude: p[0] });
}

/**
 * Convert a path to Azure positions, optionally interpolating a geodesic curve.
 * Geographic interpolation normalizes longitude to [-180, 180]; Azure accepts
 * unwrapped longitudes, so keep adjacent points in the same world copy to avoid
 * drawing a segment the long way around the map when it crosses the antimeridian.
 * Mirrors the Leaflet/OpenLayers vector renderers.
 */
export function pathToPositions(points: readonly GeoPoint[], geodesic: boolean): Position[] {
  // Core pipeline for both modes: densification (great-circle when geodesic,
  // linear lat/lng otherwise — Android's straight-line semantics) + longitude
  // unwrap.
  return buildUnwrappedPolylinePath([...points], geodesic).map(toPosition);
}

/**
 * Closed rings ([outer, ...holes]) for a polygon, densified via the shared core
 * pipeline and unwrapped into the outer ring's world copy.
 */
export function polygonRingsToPositions(state: PolygonState): Position[][] {
  const { outerRings, holeRings } = buildUnwrappedPolygonRings(
    state.points,
    state.holes,
    state.geodesic,
  );
  return [...outerRings, ...holeRings].map(closeRingPositions);
}

/** Closed positions for an (open) ring of points. */
export function closeRingPositions(ring: readonly GeoPoint[]): Position[] {
  const positions = ring.map(toPosition);
  if (positions.length === 0) return positions;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) positions.push(first);
  return positions;
}
