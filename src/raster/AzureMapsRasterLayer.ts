import {
  RasterLayerController,
  RasterLayerManager,
  TileScheme,
  type MapCameraPosition,
  type RasterLayerAddParams,
  type RasterLayerChangeParams,
  type RasterLayerEntity,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsMapViewHolder } from '../AzureMapsMapViewHolder';

function tileLayerOptions(state: RasterLayerState): atlas.TileLayerOptions | null {
  const { source } = state;
  const base = { opacity: state.opacity };
  switch (source.type) {
    case 'UrlTemplate':
      return {
        ...base,
        tileUrl: source.template,
        tileSize: source.tileSize ?? 256,
        minSourceZoom: source.minZoom ?? undefined,
        maxSourceZoom: source.maxZoom ?? undefined,
        isTMS: source.scheme === TileScheme.TMS,
      };
    case 'TileJson':
      // Azure's TileLayer accepts a TileJSON resource URL directly as tileUrl.
      return { ...base, tileUrl: source.url };
    case 'ArcGisService':
      return { ...base, tileUrl: `${source.serviceUrl.replace(/\/+$/, '')}/tile/{z}/{y}/{x}` };
    default:
      return null;
  }
}

export class AzureMapsRasterLayerRenderer {
  constructor(readonly holder: AzureMapsMapViewHolder) {}

  async onAdd(data: RasterLayerAddParams[]): Promise<(atlas.layer.TileLayer | null)[]> {
    return data.map(({ state }) => (state.visible ? this.create(state) : null));
  }

  async onChange(data: RasterLayerChangeParams<atlas.layer.TileLayer>[]): Promise<(atlas.layer.TileLayer | null)[]> {
    return data.map(({ current, prev }) => {
      this.remove(prev.layer);
      return current.state.visible ? this.create(current.state) : null;
    });
  }

  async onRemove(data: RasterLayerEntity<atlas.layer.TileLayer>[]): Promise<void> {
    for (const entity of data) this.remove(entity.layer);
  }

  async onCameraChanged(_camera: MapCameraPosition): Promise<void> {}
  async onPostProcess(): Promise<void> {}

  private create(state: RasterLayerState): atlas.layer.TileLayer | null {
    const options = tileLayerOptions(state);
    if (!options) return null;
    const layer = new atlas.layer.TileLayer(options);
    // Insert raster tiles beneath interactive overlays where possible: place it
    // before the first existing non-base layer so markers/vectors stay on top.
    this.holder.map.layers.add(layer);
    return layer;
  }

  private remove(layer: atlas.layer.TileLayer): void {
    try {
      this.holder.map.layers.remove(layer);
    } catch {
      // Layer may already be gone if the map/style was torn down.
    }
  }
}

export class AzureMapsRasterLayerController extends RasterLayerController<atlas.layer.TileLayer> {
  constructor(renderer: AzureMapsRasterLayerRenderer) {
    super({ rasterLayerManager: new RasterLayerManager(), renderer });
  }

  async composition(data: RasterLayerState[]): Promise<void> {
    await this.add(data);
    for (const state of data) {
      if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
    }
  }

  override async update(state: RasterLayerState): Promise<void> {
    await super.update(state);
    if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
  }
}
