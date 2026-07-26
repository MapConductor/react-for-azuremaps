import {
  createGeoPoint,
  MapViewHolderBase,
  type GeoPoint,
  type GeoPointInterface,
  type Offset,
} from '@mapconductor/js-sdk-core';
import type * as atlas from 'azure-maps-control';
import type { AzureMapsViewController } from './AzureMapsViewController';

/**
 * Web port of the MapConductor view holder for Azure Maps.
 *
 * Azure Maps projects between geographic positions and container pixels via
 * `map.positionsToPixels` / `map.pixelsToPositions`, which are already relative
 * to the map container — the same space MapConductor overlays (InfoBubble,
 * marker animation) live in.
 */
export class AzureMapsMapViewHolder extends MapViewHolderBase<HTMLElement, atlas.Map> {
  private _controller: AzureMapsViewController | null = null;

  constructor(
    readonly mapView: HTMLElement,
    readonly map: atlas.Map,
  ) {
    super();
  }

  getController(): AzureMapsViewController | null {
    return this._controller;
  }

  setController(controller: AzureMapsViewController): void {
    this._controller = controller;
  }

  toScreenOffset(position: GeoPointInterface): Offset {
    const [pixel] = this.map.positionsToPixels([[position.longitude, position.latitude]]);
    return { x: pixel[0], y: pixel[1] };
  }

  fromScreenOffsetSync(offset: Offset): GeoPoint {
    const [position] = this.map.pixelsToPositions([[offset.x, offset.y] as unknown as atlas.Pixel]);
    return createGeoPoint({ latitude: position[1], longitude: position[0] });
  }
}
