import {
  MapProvider,
  MarkerTilingOptions,
  type GeoRectBounds,
  type MapConfig,
  type MapViewControllerInterface,
  withRasterHeaderTransform,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsViewController } from './AzureMapsViewController';
import { AzureMapsMapViewHolder } from './AzureMapsMapViewHolder';
import { toCameraPosition } from './MapCameraPosition';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';
import { AzureMapsMarkerController } from './marker/AzureMapsMarkerController';
import { AzureMapsMarkerOverlayRenderer } from './marker/AzureMapsMarkerOverlayRenderer';
import {
  AzureMapsCircleController,
  AzureMapsCircleRenderer,
  AzureMapsGroundImageController,
  AzureMapsGroundImageRenderer,
  AzureMapsPolygonController,
  AzureMapsPolygonRenderer,
  AzureMapsPolylineController,
  AzureMapsPolylineRenderer,
} from './vector/AzureMapsVectorControllers';
import { AzureMapsRasterLayerController, AzureMapsRasterLayerRenderer } from './raster/AzureMapsRasterLayer';

export interface AzureMapsConfig extends MapConfig {
  subscriptionKey?: string;
  style?: string;
  minZoom?: number;
  maxZoom?: number;
  /** Restricts panning so the camera center cannot leave this rectangle. */
  restrictBounds?: GeoRectBounds;
  markerTilingOptions?: MarkerTilingOptions;
}

// Sentinel used to silently cancel initialization when destroy() runs before ready.
const DESTROYED_BEFORE_READY = Symbol('DESTROYED_BEFORE_READY');

function toBoundingBox(bounds: GeoRectBounds | undefined): atlas.data.BoundingBox | undefined {
  if (!bounds?.southWest || !bounds.northEast) return undefined;
  return [
    bounds.southWest.longitude,
    bounds.southWest.latitude,
    bounds.northEast.longitude,
    bounds.northEast.latitude,
  ];
}

export class AzureMapsProvider extends MapProvider {
  private map: atlas.Map | null = null;

  async initialize(config: AzureMapsConfig): Promise<MapViewControllerInterface> {
    if (this.controller) return this.controller;

    const container =
      typeof config.container === 'string' ? document.getElementById(config.container) : config.container;
    if (!container) throw new Error('Container element not found');

    const subscriptionKey = config.subscriptionKey ?? config.apiKey;
    if (!subscriptionKey) throw new Error('An Azure Maps subscription key is required.');

    const initialCamera = config.initCameraPosition ? toCameraPosition(config.initCameraPosition) : null;
    const rasterTransformRequest = withRasterHeaderTransform<atlas.ResourceType>(
      config.options?.transformRequest,
    );

    const map = new atlas.Map(container, {
      authOptions: {
        authType: atlas.AuthenticationType.subscriptionKey,
        subscriptionKey,
      },
      style: config.style ?? 'road',
      center: initialCamera?.center ?? [0, 0],
      zoom: initialCamera?.zoom ?? ZoomAltitudeConverter.googleZoomToAzureZoom(10),
      bearing: initialCamera?.bearing ?? 0,
      pitch: initialCamera?.tilt ?? 0,
      minZoom: config.minZoom != null ? ZoomAltitudeConverter.googleZoomToAzureZoom(config.minZoom) : undefined,
      maxZoom: config.maxZoom != null ? ZoomAltitudeConverter.googleZoomToAzureZoom(config.maxZoom) : undefined,
      maxBounds: toBoundingBox(config.restrictBounds),
      showLogo: true,
      showFeedbackLink: false,
      ...(config.options as object | undefined),
      // RasterLayer の extraHeaders をタイル要求に載せる唯一の口。
      //
      // azure-maps は maplibre-gl と違い、**戻り値が undefined だと落ちる**
      // （返ってきたオブジェクトの `headers` を無条件に読む）。地図が起動しなくなるので、
      // 変換しない場合も必ず `{ url }` を返す。型が非 undefined なのは飾りではなかった。
      transformRequest: (url: string, resourceType: atlas.ResourceType) =>
        (rasterTransformRequest(url, resourceType) ?? { url }) as atlas.RequestParameters,
    });
    this.map = map;

    await new Promise<void>((resolve, reject) => {
      map.events.addOnce('ready', () => resolve());
      map.events.addOnce('error', e => reject(e instanceof Error ? e : new Error('Azure Maps failed to load.')));
    });

    // destroy() may have run while we awaited 'ready'.
    if (!this.map) throw DESTROYED_BEFORE_READY;

    const holder = new AzureMapsMapViewHolder(container, map);
    const tilingOptions = config.markerTilingOptions ?? MarkerTilingOptions.Default;

    const markerController = new AzureMapsMarkerController(map, new AzureMapsMarkerOverlayRenderer(holder), tilingOptions);
    const circleController = new AzureMapsCircleController(new AzureMapsCircleRenderer(holder));
    const polylineController = new AzureMapsPolylineController(new AzureMapsPolylineRenderer(holder));
    const polygonController = new AzureMapsPolygonController(new AzureMapsPolygonRenderer(holder));
    const groundImageController = new AzureMapsGroundImageController(new AzureMapsGroundImageRenderer(holder));
    const rasterLayerController = new AzureMapsRasterLayerController(new AzureMapsRasterLayerRenderer(holder));

    this.controller = new AzureMapsViewController(
      holder,
      markerController,
      circleController,
      polylineController,
      polygonController,
      groundImageController,
      rasterLayerController,
      config.initCameraPosition?.tilt ?? null,
    );
    return this.controller;
  }

  destroy(): void {
    if (this.controller) {
      this.controller.destroy();
      this.controller = null;
    } else if (this.map) {
      this.map.dispose();
    }
    this.map = null;
  }

  /** Returns true if the rejection was caused by an intentional destroy() call. */
  static isDestroyedBeforeReady(error: unknown): boolean {
    return error === DESTROYED_BEFORE_READY;
  }
}
