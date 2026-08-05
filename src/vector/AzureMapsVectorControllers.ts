import {
  AbstractCircleOverlayRenderer,
  AbstractGroundImageOverlayRenderer,
  AbstractPolygonOverlayRenderer,
  AbstractPolylineOverlayRenderer,
  circleToRing,
  CircleController,
  CircleManager,
  GroundImageController,
  GroundImageManager,
  PolygonController,
  PolygonManager,
  PolylineController,
  PolylineManager,
  type CircleEntity,
  type CircleState,
  type GroundImageEntity,
  type GroundImageState,
  type PolygonEntity,
  type PolygonState,
  type PolylineEntity,
  type PolylineState,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsMapViewHolder } from '../AzureMapsMapViewHolder';
import { addLayersBelowMarkers, closeRingPositions, pathToPositions, polygonRingsToPositions } from '../helpers';

/**
 * A rendered vector overlay on Azure Maps: a DataSource (or none, for image
 * overlays), the layers drawing it, and a cleanup that removes them. Clicks are
 * resolved geometrically from the tapped coordinate in AzureMapsViewController
 * (point-in-polygon / distance-to-segment / distance-to-center / bounds
 * containment) rather than via Azure's per-layer hit-testing, so these overlays
 * attach no event handlers of their own.
 */
interface VectorHandle {
  cleanup: () => void;
  // Shape overlays (circle/polyline/polygon) keep their DataSource and layers so
  // property updates mutate them in place (source.setShapes / layer.setOptions)
  // instead of removing and re-adding them. Recreating on every update visibly
  // flickers the shape while a marker is dragged (each drag frame triggers an
  // update). Absent for overlays that have no such source (e.g. ground images).
  source?: atlas.source.DataSource;
  fill?: atlas.layer.PolygonLayer;
  stroke?: atlas.layer.LineLayer;
  // Ground images are drawn with an ImageLayer (no DataSource). Kept so a
  // reposition updates the layer's coordinates in place instead of removing and
  // re-adding it, which blanks the image for a frame (flicker) on every drag.
  imageLayer?: atlas.layer.ImageLayer;
}

// ---------- Circle ----------

export class AzureMapsCircleRenderer extends AbstractCircleOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
  async createCircle(state: CircleState): Promise<VectorHandle> {
    const map = this.holder.map;
    const source = new atlas.source.DataSource();
    map.sources.add(source);
    // Circle polygon from the shared core geometry (circleToRing), replacing
    // Azure's subType:'Circle' extension so the shape definition (geodesic vs
    // planar) is unified across providers. The ring is unwrapped around the
    // center longitude; Azure accepts out-of-range longitudes, so an
    // antimeridian-crossing circle stays continuous without splitting.
    const ring = closeRingPositions(
      circleToRing(state.center, state.radiusMeters, state.geodesic),
    );
    source.add(new atlas.data.Feature(new atlas.data.Polygon([ring])));
    const fill = new atlas.layer.PolygonLayer(source, undefined, { fillColor: state.fillColor, fillOpacity: 1 });
    const stroke = new atlas.layer.LineLayer(source, undefined, { strokeColor: state.strokeColor, strokeWidth: state.strokeWidth });
    addLayersBelowMarkers(map, [fill, stroke]);
    // Clicks are resolved geometrically from the tapped coordinate in
    // AzureMapsViewController (see its map 'click' handler), not via Azure's
    // per-layer hit-testing, so no layer click handler is attached here.
    return {
      source,
      fill,
      stroke,
      cleanup: () => {
        map.layers.remove([fill, stroke]);
        map.sources.remove(source);
      },
    };
  }

  async updateCircleProperties({ circle, current }: {
    circle: VectorHandle;
    current: CircleEntity<VectorHandle>;
    prev: CircleEntity<VectorHandle>;
  }): Promise<VectorHandle | null> {
    // Update geometry and style in place; recreating would flicker the circle
    // while its radius handle is dragged.
    if (!circle.source || !circle.fill || !circle.stroke) {
      circle.cleanup();
      return this.createCircle(current.state);
    }
    const state = current.state;
    const ring = closeRingPositions(
      circleToRing(state.center, state.radiusMeters, state.geodesic),
    );
    circle.source.setShapes([new atlas.data.Feature(new atlas.data.Polygon([ring]))]);
    circle.fill.setOptions({ fillColor: state.fillColor, fillOpacity: 1 });
    circle.stroke.setOptions({ strokeColor: state.strokeColor, strokeWidth: state.strokeWidth });
    return circle;
  }

  async removeCircle(entity: CircleEntity<VectorHandle>): Promise<void> {
    entity.circle.cleanup();
  }
}

export class AzureMapsCircleController extends CircleController<VectorHandle> {
  constructor(renderer: AzureMapsCircleRenderer) {
    super({ circleManager: new CircleManager(), renderer });
  }
}

// ---------- Polyline ----------

export class AzureMapsPolylineRenderer extends AbstractPolylineOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
  async createPolyline(state: PolylineState): Promise<VectorHandle> {
    const map = this.holder.map;
    const source = new atlas.source.DataSource();
    map.sources.add(source);
    source.add(new atlas.data.Feature(new atlas.data.LineString(pathToPositions(state.points, state.geodesic))));
    const line = new atlas.layer.LineLayer(source, undefined, {
      strokeColor: state.strokeColor,
      strokeWidth: state.strokeWidth,
      lineJoin: 'round',
      lineCap: 'round',
    });
    addLayersBelowMarkers(map, line);
    // Clicks are resolved geometrically from the tapped coordinate in
    // AzureMapsViewController (distance-to-segment), not via Azure's per-layer
    // hit-testing, so no layer click handler is attached here.
    return {
      source,
      stroke: line,
      cleanup: () => {
        map.layers.remove(line);
        map.sources.remove(source);
      },
    };
  }

  async updatePolylineProperties({ polyline, current }: {
    polyline: VectorHandle;
    current: PolylineEntity<VectorHandle>;
    prev: PolylineEntity<VectorHandle>;
  }): Promise<VectorHandle | null> {
    // Update geometry and style in place; recreating would flicker the line
    // while a waypoint marker is dragged.
    if (!polyline.source || !polyline.stroke) {
      polyline.cleanup();
      return this.createPolyline(current.state);
    }
    const state = current.state;
    polyline.source.setShapes([
      new atlas.data.Feature(new atlas.data.LineString(pathToPositions(state.points, state.geodesic))),
    ]);
    polyline.stroke.setOptions({ strokeColor: state.strokeColor, strokeWidth: state.strokeWidth });
    return polyline;
  }

  async removePolyline(entity: PolylineEntity<VectorHandle>): Promise<void> {
    entity.polyline.cleanup();
  }
}

export class AzureMapsPolylineController extends PolylineController<VectorHandle> {
  constructor(renderer: AzureMapsPolylineRenderer) {
    super({ polylineManager: new PolylineManager(), renderer });
  }
}

// ---------- Polygon ----------

function polygonRings(state: PolygonState): [number, number][][] {
  // Core pipeline: densify each ring (geodesic great-circle or straight-in-
  // lat/lng linear interpolation, matching the Android renderers) and unwrap
  // the longitudes into the outer ring's world copy.
  return polygonRingsToPositions(state);
}

export class AzureMapsPolygonRenderer extends AbstractPolygonOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
  async createPolygon(state: PolygonState): Promise<VectorHandle> {
    const map = this.holder.map;
    const source = new atlas.source.DataSource();
    map.sources.add(source);
    source.add(new atlas.data.Feature(new atlas.data.Polygon(polygonRings(state))));
    const fill = new atlas.layer.PolygonLayer(source, undefined, { fillColor: state.fillColor, fillOpacity: 1 });
    const stroke = new atlas.layer.LineLayer(source, undefined, { strokeColor: state.strokeColor, strokeWidth: state.strokeWidth });
    addLayersBelowMarkers(map, [fill, stroke]);
    // Clicks are resolved geometrically from the tapped coordinate in
    // AzureMapsViewController (point-in-polygon), not via Azure's per-layer
    // hit-testing, so no layer click handler is attached here.
    return {
      source,
      fill,
      stroke,
      cleanup: () => {
        map.layers.remove([fill, stroke]);
        map.sources.remove(source);
      },
    };
  }

  async updatePolygonProperties({ polygon, current }: {
    polygon: VectorHandle;
    current: PolygonEntity<VectorHandle>;
    prev: PolygonEntity<VectorHandle>;
  }): Promise<VectorHandle | null> {
    // Update geometry and style in place; recreating the source and layers
    // makes the polygon flicker on every drag frame (the reported bug on
    // /azuremaps/polygon-hole while dragging a vertex marker).
    if (!polygon.source || !polygon.fill || !polygon.stroke) {
      polygon.cleanup();
      return this.createPolygon(current.state);
    }
    const state = current.state;
    polygon.source.setShapes([new atlas.data.Feature(new atlas.data.Polygon(polygonRings(state)))]);
    polygon.fill.setOptions({ fillColor: state.fillColor, fillOpacity: 1 });
    polygon.stroke.setOptions({ strokeColor: state.strokeColor, strokeWidth: state.strokeWidth });
    return polygon;
  }

  async removePolygon(entity: PolygonEntity<VectorHandle>): Promise<void> {
    entity.polygon.cleanup();
  }
}

export class AzureMapsPolygonController extends PolygonController<VectorHandle> {
  constructor(renderer: AzureMapsPolygonRenderer) {
    super({ polygonManager: new PolygonManager(), renderer });
  }
}

// ---------- GroundImage ----------

export class AzureMapsGroundImageRenderer extends AbstractGroundImageOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
  // Azure ImageLayer coordinates order: [top-left, top-right, bottom-right, bottom-left].
  private imageCoordinates(state: GroundImageState): [number, number][] | null {
    const { southWest, northEast } = state.bounds;
    if (!southWest || !northEast) return null;
    return [
      [southWest.longitude, northEast.latitude],
      [northEast.longitude, northEast.latitude],
      [northEast.longitude, southWest.latitude],
      [southWest.longitude, southWest.latitude],
    ];
  }

  async createGroundImage(state: GroundImageState): Promise<VectorHandle | null> {
    const coordinates = this.imageCoordinates(state);
    if (!coordinates) return null;
    const map = this.holder.map;
    const layer = new atlas.layer.ImageLayer({
      url: state.imageUrl,
      coordinates,
      opacity: state.opacity,
    });
    addLayersBelowMarkers(map, layer);
    // Clicks are resolved geometrically from the tapped coordinate in
    // AzureMapsViewController (bounds containment), not via Azure's per-layer
    // hit-testing, so no layer click handler is attached here.
    return {
      imageLayer: layer,
      cleanup: () => {
        map.layers.remove(layer);
      },
    };
  }

  async updateGroundImageProperties({ groundImage, current, prev }: {
    groundImage: VectorHandle;
    current: GroundImageEntity<VectorHandle>;
    prev: GroundImageEntity<VectorHandle>;
  }): Promise<VectorHandle | null> {
    const state = current.state;
    const coordinates = this.imageCoordinates(state);
    if (!coordinates || !groundImage.imageLayer) {
      groundImage.cleanup();
      return this.createGroundImage(state);
    }
    // Reposition/opacity in place; recreating the ImageLayer blanks the image
    // for a frame, flickering it on every corner-marker drag. Only re-set the
    // url when it actually changed — passing it re-fetches the image.
    const urlChanged = prev.state.imageUrl !== state.imageUrl;
    groundImage.imageLayer.setOptions({
      ...(urlChanged ? { url: state.imageUrl } : {}),
      coordinates,
      opacity: state.opacity,
    });
    return groundImage;
  }

  async removeGroundImage(entity: GroundImageEntity<VectorHandle>): Promise<void> {
    entity.groundImage.cleanup();
  }
}

export class AzureMapsGroundImageController extends GroundImageController<VectorHandle> {
  constructor(renderer: AzureMapsGroundImageRenderer) {
    super({ groundImageManager: new GroundImageManager(), renderer });
  }
}
