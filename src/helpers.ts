import {
  buildUnwrappedPolygonRings,
  buildUnwrappedPolylinePath,
  createGeoPoint,
  type GeoPoint,
  type GeoPointInterface,
  type PolygonState,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';

/** Azure Maps positions are [longitude, latitude] tuples. */
export type Position = [number, number];

/** Id of the marker `SymbolLayer` (see AzureMapsMarkerOverlayRenderer). */
export const MARKER_SYMBOL_LAYER_ID = 'mc-marker-symbols-layer';

/**
 * Add vector-overlay layers just below the marker layer so markers always draw
 * on top of shapes (as DOM HtmlMarkers used to). If the marker layer does not
 * exist yet, the layers are simply added on top.
 */
export function addLayersBelowMarkers(
  map: atlas.Map,
  layers: atlas.layer.Layer | atlas.layer.Layer[],
): void {
  const hasMarkerLayer = map.layers
    .getLayers()
    .some(layer => typeof layer.getId === 'function' && layer.getId() === MARKER_SYMBOL_LAYER_ID);
  map.layers.add(layers, hasMarkerLayer ? MARKER_SYMBOL_LAYER_ID : undefined);
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
