import { createGeoPoint, createInterpolatePoints, type GeoPoint, type GeoPointInterface } from '@mapconductor/js-sdk-core';
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
  if (points.length === 0) return [];
  const rendered = geodesic ? createInterpolatePoints([...points]) : points;
  let previousLongitude: number | null = null;
  return rendered.map(point => {
    let longitude = point.normalize().longitude;
    if (previousLongitude != null) {
      while (longitude - previousLongitude > 180) longitude -= 360;
      while (longitude - previousLongitude < -180) longitude += 360;
    }
    previousLongitude = longitude;
    return [longitude, point.latitude];
  });
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

/** Closed ring positions for a polygon ring (auto-closes if needed). */
export function ringToPositions(points: readonly GeoPoint[], geodesic: boolean): Position[] {
  if (points.length === 0) return [];
  const closed = samePoint(points[0], points[points.length - 1]) ? points : [...points, points[0]];
  return pathToPositions(closed, geodesic);
}
