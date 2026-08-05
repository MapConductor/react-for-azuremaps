import {
  BaseMapViewController,
  MapUISettingsDiagnostics,
  type MapUISettings,
  createGeoRectBounds,
  type CameraOptions,
  type CircleCapable,
  type CircleState,
  type GeoRectBounds,
  type GroundImageCapable,
  type GroundImageState,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type MarkerState,
  type OnCircleEventHandler,
  type OnGroundImageEventHandler,
  type OnMapInitializedHandler,
  type OnMarkerEventHandler,
  type OnPolygonEventHandler,
  type OnPolylineEventHandler,
  type PolygonCapable,
  type PolygonState,
  type PolylineCapable,
  type PolylineState,
  type RasterLayerCapable,
  type RasterLayerState,
  type VisibleRegion,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsMapViewHolder } from './AzureMapsMapViewHolder';
import type { AzureMapsMapDesignType } from './AzureMapsDesign';
import { toCameraPosition, toMapCameraPosition } from './MapCameraPosition';
import { positionFromEvent } from './helpers';
import { AzureMapsMarkerController } from './marker/AzureMapsMarkerController';
import {
  AzureMapsCircleController,
  AzureMapsGroundImageController,
  AzureMapsPolygonController,
  AzureMapsPolylineController,
} from './vector/AzureMapsVectorControllers';
import { AzureMapsRasterLayerController } from './raster/AzureMapsRasterLayer';

export class AzureMapsViewController
  extends BaseMapViewController
  implements
    MapViewControllerInterface,
    MarkerCapable,
    CircleCapable,
    PolylineCapable,
    PolygonCapable,
    GroundImageCapable,
    RasterLayerCapable
{
  private readonly map: atlas.Map;
  private initialized = false;
  private destroyed = false;
  private logicalTiltHint: number | null;

  constructor(
    readonly holder: AzureMapsMapViewHolder,
    private readonly markerController: AzureMapsMarkerController,
    private readonly circleController: AzureMapsCircleController,
    private readonly polylineController: AzureMapsPolylineController,
    private readonly polygonController: AzureMapsPolygonController,
    private readonly groundImageController: AzureMapsGroundImageController,
    private readonly rasterLayerController: AzureMapsRasterLayerController,
    logicalTiltHint: number | null = null,
  ) {
    super();
    this.map = holder.map;
    this.logicalTiltHint = logicalTiltHint;
    this.holder.setController(this);
    // Tiled markers render into a raster overlay driven by the raster controller.
    this.markerController.onRasterLayerUpdate = async state => {
      if (state) await this.rasterLayerController.composition([state]);
      else await this.rasterLayerController.clear();
    };
    this.setupEventListeners();
    // The provider only builds the controller after the map's 'ready' event, so
    // the map is usable now; announce readiness on the next microtask so a
    // listener attached right after construction still fires.
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.initialized = true;
      this.notifyMapInitialized();
    });
  }

  getMap(): atlas.Map {
    return this.map;
  }

  /**
   * Azure Maps groups its gestures under `setUserInteraction`. It has no switch
   * for pitch on its own: `dragRotateInteraction` rotates *and* pitches on a
   * right-button drag, and a two-finger drag pitches whenever touch input is on
   * at all, so a tilt block cannot be honoured.
   */
  applyUISettings(settings: MapUISettings): void {
    this.map.setUserInteraction({
      dragPanInteraction: settings.scrollGesture,
      scrollZoomInteraction: settings.zoomGesture,
      dblClickZoomInteraction: settings.zoomGesture,
      boxZoomInteraction: settings.zoomGesture,
      dragRotateInteraction: settings.rotateGesture,
      touchRotate: settings.rotateGesture,
      keyboardInteraction: settings.scrollGesture || settings.zoomGesture,
    });

    MapUISettingsDiagnostics.warnIfRequested(
      settings.tiltGesture, 'tilt', 'AzureMaps',
      'Azure Maps has no pitch switch of its own, so a two-finger drag can still tilt the map',
    );
  }

  /**
   * Switch the base map style in place. Azure Maps applies a new style name via
   * `setStyle` without recreating the map, so the camera and DOM-based markers
   * are preserved. Called by the view state's `mapDesignType` setter.
   */
  setMapDesignType(value: AzureMapsMapDesignType): void {
    this.map.setStyle({ style: value.style });
  }

  private setupEventListeners(): void {
    this.map.events.add('movestart', () => {
      const camera = this.getCameraPosition();
      if (camera) this.notifyCameraMoveStart(camera);
    });
    this.map.events.add('move', () => {
      const camera = this.getCameraPosition();
      if (camera) this.notifyCameraMove(camera);
    });
    this.map.events.add('moveend', () => {
      const camera = this.getCameraPosition();
      if (!camera) return;
      void this.notifyControllersCameraChanged(camera);
      this.notifyCameraMoveEnd(camera);
    });
    this.map.events.add('click', (e: atlas.MapMouseEvent) => {
      const point = positionFromEvent(e);
      if (!point) return;
      // Resolve vector-overlay clicks from the clicked coordinate rather than the
      // map SDK's own layer hit-testing. Azure only fires a layer's `click` event
      // when the pointer is over the rendered feature, so a page that also wants
      // to react to clicks *outside* a shape (e.g. polygon-click's "Outside")
      // never gets a map-background click for taps that land on empty map near a
      // shape. Geometric hit-testing (point-in-polygon, distance-to-segment,
      // distance-to-center) matches every other provider (Leaflet/HERE/Mapbox)
      // and lets the map-background click through whenever no shape is hit.
      //
      // Markers are canvas-drawn SymbolLayer features (non-tiled) or a raster
      // overlay (tiled) — neither has a DOM node to receive a click — so hit-test
      // both from the tapped coordinate.
      const markerEntity = this.markerController.find(point);
      if (markerEntity?.state.clickable) {
        this.markerController.dispatchClick(markerEntity.state);
        return;
      }
      const tiled = this.markerController.findTiled(point, this.map.getCamera().zoom ?? 0);
      if (tiled?.state.clickable) {
        this.markerController.dispatchClick(tiled.state);
        return;
      }

      const circleEntity = this.circleController.find(point);
      if (circleEntity) {
        this.circleController.dispatchClick({ state: circleEntity.state, clicked: point });
        return;
      }

      const polylineHit = this.polylineController.findWithClosestPoint(point);
      if (polylineHit) {
        this.polylineController.dispatchClick({
          state: polylineHit.entity.state,
          clicked: polylineHit.closestPoint,
        });
        return;
      }

      const polygonEntity = this.polygonController.find(point);
      if (polygonEntity) {
        this.polygonController.dispatchClick({ state: polygonEntity.state, clicked: point });
        return;
      }

      // Ground images are large background overlays, so test them last (lowest
      // priority) and only when interactive — otherwise a purely decorative
      // overlay would swallow every map-background click inside its bounds.
      const groundImageEntity = this.groundImageController.find(point);
      if (groundImageEntity?.state.onClick) {
        this.groundImageController.dispatchClick({ state: groundImageEntity.state, clicked: point });
        return;
      }

      this.notifyMapClick(point);
    });
    this.map.events.add('contextmenu', (e: atlas.MapMouseEvent) => {
      const point = positionFromEvent(e);
      if (point) this.notifyMapLongClick(point);
    });
  }

  override setMapInitializedListener(listener: OnMapInitializedHandler | null): void {
    super.setMapInitializedListener(listener);
    if (listener && this.initialized) this.notifyMapInitialized();
  }

  private async notifyControllersCameraChanged(camera: MapCameraPosition): Promise<void> {
    await Promise.all([
      this.markerController.onCameraChanged(camera),
      this.circleController.onCameraChanged(camera),
      this.polylineController.onCameraChanged(camera),
      this.polygonController.onCameraChanged(camera),
      this.groundImageController.onCameraChanged(camera),
      this.rasterLayerController.onCameraChanged(camera),
    ]);
  }

  // --- Camera ---

  moveCamera(position: MapCameraPosition): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    const cam = toCameraPosition(position);
    return new Promise(resolve => {
      this.map.events.addOnce('moveend', () => resolve(true));
      this.map.setCamera({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.tilt, type: 'jump' });
    });
  }

  animateCamera(position: MapCameraPosition, options?: CameraOptions): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    const cam = toCameraPosition(position);
    const duration = options?.duration || 500;
    return new Promise(resolve => {
      this.map.events.addOnce('moveend', () => resolve(true));
      this.map.setCamera({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.tilt, type: 'ease', duration });
    });
  }

  fitBounds(bounds: GeoRectBounds, options?: CameraOptions): Promise<boolean> {
    if (!bounds.southWest || !bounds.northEast) return Promise.resolve(false);
    const padding = options?.padding ?? options?.paddings;
    // Preserve current rotation/tilt so the fit is correct at any bearing/pitch
    // (setCamera with bounds otherwise frames it north-up, top-down).
    const cam = this.map.getCamera();
    return new Promise(resolve => {
      this.map.events.addOnce('moveend', () => resolve(true));
      this.map.setCamera({
        bounds: [
          bounds.southWest!.longitude,
          bounds.southWest!.latitude,
          bounds.northEast!.longitude,
          bounds.northEast!.latitude,
        ],
        bearing: cam.bearing,
        pitch: cam.pitch,
        ...(padding != null ? { padding } : {}),
        ...(options?.duration ? { type: 'ease', duration: options.duration } : { type: 'jump' }),
      });
    });
  }

  getCameraPosition(): MapCameraPosition | null {
    const camera = this.map.getCamera();
    const center = camera.center;
    if (!center) return null;
    const result = toMapCameraPosition({
      center,
      zoom: camera.zoom ?? 0,
      bearing: camera.bearing ?? 0,
      tilt: camera.pitch ?? 0,
      logicalTiltHint: this.logicalTiltHint,
    });
    const visibleRegion = this.getVisibleRegion();
    return visibleRegion ? result.copy({ visibleRegion }) : result;
  }

  getBounds(): GeoRectBounds | null {
    return this.getVisibleRegion()?.bounds ?? null;
  }

  private getVisibleRegion(): VisibleRegion | null {
    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;

    const nearLeft = this.holder.fromScreenOffsetSync({ x: 0, y: height });
    const nearRight = this.holder.fromScreenOffsetSync({ x: width, y: height });
    const farLeft = this.holder.fromScreenOffsetSync({ x: 0, y: 0 });
    const farRight = this.holder.fromScreenOffsetSync({ x: width, y: 0 });

    const bounds = createGeoRectBounds();
    bounds.extend(nearLeft);
    bounds.extend(nearRight);
    bounds.extend(farLeft);
    bounds.extend(farRight);

    return { bounds, nearLeft, nearRight, farLeft, farRight };
  }

  // --- Marker ---

  async compositionMarkers(data: MarkerState[]): Promise<void> { await this.markerController.composition(data); }
  async updateMarker(state: MarkerState): Promise<void> { await this.markerController.update(state); }
  hasMarker(state: MarkerState): boolean { return this.markerController.has(state); }
  setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void { this.markerController.setOnClickListener(listener); }
  setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragStart(listener); }
  setOnMarkerDrag(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDrag(listener); }
  setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnDragEnd(listener); }
  setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateStart(listener); }
  setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void { this.markerController.setOnAnimateEnd(listener); }
  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void { this.markerController.setMarkerAnimationOverlayHost(host); }

  // --- Circle ---

  async compositionCircles(data: CircleState[]): Promise<void> { await this.circleController.composition(data); }
  async updateCircle(state: CircleState): Promise<void> { await this.circleController.update(state); }
  hasCircle(state: CircleState): boolean { return this.circleController.has(state); }
  setOnCircleClickListener(listener: OnCircleEventHandler | null): void { this.circleController.setOnClickListener(listener); }

  // --- Polyline ---

  async compositionPolylines(data: PolylineState[]): Promise<void> { await this.polylineController.composition(data); }
  async updatePolyline(state: PolylineState): Promise<void> { await this.polylineController.update(state); }
  hasPolyline(state: PolylineState): boolean { return this.polylineController.has(state); }
  setOnPolylineClickListener(listener: OnPolylineEventHandler | null): void { this.polylineController.setOnClickListener(listener); }

  // --- Polygon ---

  async compositionPolygons(data: PolygonState[]): Promise<void> { await this.polygonController.composition(data); }
  async updatePolygon(state: PolygonState): Promise<void> { await this.polygonController.update(state); }
  hasPolygon(state: PolygonState): boolean { return this.polygonController.has(state); }
  setOnPolygonClickListener(listener: OnPolygonEventHandler | null): void { this.polygonController.setOnClickListener(listener); }

  // --- GroundImage ---

  async compositionGroundImages(data: GroundImageState[]): Promise<void> { await this.groundImageController.composition(data); }
  async updateGroundImage(state: GroundImageState): Promise<void> { await this.groundImageController.update(state); }
  hasGroundImage(state: GroundImageState): boolean { return this.groundImageController.has(state); }
  setOnGroundImageClickListener(listener: OnGroundImageEventHandler | null): void { this.groundImageController.setOnClickListener(listener); }

  // --- RasterLayer ---

  async compositionRasterLayers(data: RasterLayerState[]): Promise<void> { await this.rasterLayerController.composition(data); }
  async updateRasterLayer(state: RasterLayerState): Promise<void> { await this.rasterLayerController.update(state); }
  hasRasterLayer(state: RasterLayerState): boolean { return this.rasterLayerController.has(state); }

  // --- Lifecycle ---

  async clearOverlays(): Promise<void> {
    await Promise.all([
      this.markerController.clear(),
      this.circleController.clear(),
      this.polylineController.clear(),
      this.polygonController.clear(),
      this.groundImageController.clear(),
      this.rasterLayerController.clear(),
    ]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    void this.clearOverlays().finally(() => {
      this.markerController.destroy();
      this.map.dispose();
    });
  }
}
