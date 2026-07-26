import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  Settings,
  createDefaultIcon,
  createRasterLayerState,
  type GeoPoint,
  type MarkerEntity,
  type MarkerState,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsMarkerOverlayRenderer } from './AzureMapsMarkerOverlayRenderer';
import { positionFromEvent } from '../helpers';

const TILE_PROTOCOL = 'mc-local-tile';

// 1x1 transparent PNG used when a tile has no content or the route is gone.
const EMPTY_TILE = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 11, 73, 68, 65, 84, 8, 215, 99, 96, 0, 2, 0, 0, 5, 0, 1, 226, 38, 5, 155,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

let tileProtocolRegistered = false;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseLocalTileUrl(urlString: string): { routeId: string; x: number; y: number; z: number } | null {
  const url = new URL(urlString);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 && parts.length !== 5) return null;
  const offset = parts.length === 5 ? 1 : 0;
  const z = Number(parts[1 + offset]);
  const x = Number(parts[2 + offset]);
  const y = Number(parts[3 + offset].replace(/\.png$/, ''));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { routeId: url.hostname, x, y, z };
}

/**
 * Route `mc-local-tile://` tile requests to MapConductor's in-process tile
 * server. Mirrors the Mapbox provider's `mapboxgl.addProtocol` registration —
 * Azure Maps exposes the same `atlas.addProtocol` hook (both are Mapbox-GL
 * derived), so tiled markers render as a raster overlay without a service worker.
 */
function registerTileProtocol(): void {
  if (tileProtocolRegistered) return;
  atlas.addProtocol(TILE_PROTOCOL, async (params: { url: string }) => {
    const parsed = parseLocalTileUrl(params.url);
    if (!parsed) return { data: toArrayBuffer(EMPTY_TILE) };
    const bytes = await LocalTileServer.startServer().handleFetch(parsed.routeId, {
      x: parsed.x,
      y: parsed.y,
      z: parsed.z,
    });
    return { data: toArrayBuffer(bytes ?? EMPTY_TILE) };
  });
  tileProtocolRegistered = true;
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

/**
 * Azure Maps marker controller.
 *
 * Small marker sets render as canvas `SymbolLayer` features (see
 * {@link AzureMapsMarkerOverlayRenderer}). Large sets are tiled: rendered off-DOM
 * into a raster overlay (see {@link MarkerTileRenderer}) served through a custom
 * tile protocol, so tens of thousands of markers stay performant. Because symbols
 * are canvas-drawn (no per-marker DOM node), clicks are resolved from the tapped
 * coordinate via {@link find} and drags are synthesized from map pointer events —
 * mirroring the HERE/Mapbox providers.
 */
export class AzureMapsMarkerController extends AbstractMarkerController<atlas.Shape> {
  declare readonly renderer: AzureMapsMarkerOverlayRenderer;

  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
  private tileGeneration = 0;

  // Synthesized-drag state: the marker pressed with the pointer, and whether the
  // pointer has moved far enough to become a drag (vs a plain click).
  private dragCandidate: MarkerEntity<atlas.Shape> | null = null;
  private dragging = false;

  /** Wired by AzureMapsViewController to drive the tiled-marker raster overlay. */
  onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null = null;

  constructor(
    private readonly map: atlas.Map,
    renderer: AzureMapsMarkerOverlayRenderer,
    private readonly tilingOptions: MarkerTilingOptions = MarkerTilingOptions.Default,
  ) {
    super({
      markerManager: MarkerManager.defaultManager<atlas.Shape>(null, tilingOptions.minMarkerCount),
      renderer,
    });
    this.setupDragHandling();
  }

  override async update(state: MarkerState): Promise<void> {
    // While a drag is active the shape position is driven directly by the pointer;
    // re-applying every MarkerState emission would fight it.
    if (this.isDragging(state)) return;
    await super.update(state);
  }

  /** Nearest tiled (raster) marker to a clicked point, or null. */
  findTiled(position: GeoPoint, zoom: number): MarkerEntity<atlas.Shape> | null {
    const found = this.tileRenderer?.findNearest(position, MARKER_HIT_RADIUS_MOUSE_PX, zoom);
    return found ? this.markerManager.getEntity(found.id) : null;
  }

  /**
   * Top-most non-tiled marker whose on-screen icon rectangle contains the tapped
   * point (falling back to the nearest within the tap tolerance). Replaces the
   * per-marker DOM click that HtmlMarker provided. Mirrors HERE's `find`.
   */
  override find(position: GeoPoint): MarkerEntity<atlas.Shape> | null {
    const [touch] = this.map.positionsToPixels([[position.longitude, position.latitude]]);
    const tol = Settings.Default.tapTolerance;
    let onIcon: MarkerEntity<atlas.Shape> | null = null;
    let onIconY = -Infinity;
    let near: MarkerEntity<atlas.Shape> | null = null;
    let nearDistSq = Infinity;
    for (const entity of this.markerManager.allEntities()) {
      if (entity.marker == null) continue; // tiled markers are hit-tested via findTiled
      const [mp] = this.map.positionsToPixels([[
        entity.state.position.longitude,
        entity.state.position.latitude,
      ]]);
      const icon = entity.state.icon?.toBitmapIcon() ?? createDefaultIcon().toBitmapIcon();
      const dx = touch[0] - mp[0];
      const dy = touch[1] - mp[1];
      const left = -icon.anchor.x * icon.size.width;
      const right = (1 - icon.anchor.x) * icon.size.width;
      const top = -icon.anchor.y * icon.size.height;
      const bottom = (1 - icon.anchor.y) * icon.size.height;
      if (dx >= left && dx <= right && dy >= top && dy <= bottom) {
        if (mp[1] > onIconY) {
          onIconY = mp[1];
          onIcon = entity;
        }
      } else if (dx >= left - tol && dx <= right + tol && dy >= top - tol && dy <= bottom + tol) {
        const distSq = dx * dx + dy * dy;
        if (distSq < nearDistSq) {
          nearDistSq = distSq;
          near = entity;
        }
      }
    }
    return onIcon ?? near;
  }

  /**
   * Synthesizes marker drag from map pointer events: SymbolLayer features have no
   * DOM node and no native drag, so press a draggable marker to disable map pan
   * and follow the pointer, promoting to a drag only once it actually moves (so a
   * press-release with no movement stays a click).
   */
  private setupDragHandling(): void {
    this.map.events.add('mousedown', (e: atlas.MapMouseEvent) => {
      const point = positionFromEvent(e);
      if (!point) return;
      const entity = this.find(point);
      if (!entity?.state.draggable) return;
      this.dragCandidate = entity;
      this.dragging = false;
      // Suppress map panning while the pointer may be dragging a marker.
      this.map.setUserInteraction({ dragPanInteraction: false });
    });
    this.map.events.add('mousemove', (e: atlas.MapMouseEvent) => {
      const entity = this.dragCandidate;
      if (!entity) return;
      const point = positionFromEvent(e);
      if (!point) return;
      if (!this.dragging) {
        this.dragging = true;
        this.setDraggingState(entity.state, true);
        this.dispatchDragStart(entity.state);
      }
      entity.state.setPosition(point);
      this.renderer.setMarkerPosition(entity, point);
      this.dispatchDrag(entity.state);
    });
    this.map.events.add('mouseup', () => {
      const entity = this.dragCandidate;
      this.map.setUserInteraction({ dragPanInteraction: true });
      this.dragCandidate = null;
      if (!entity || !this.dragging) return;
      this.dragging = false;
      this.setDraggingState(entity.state, false);
      this.dispatchDragEnd(entity.state);
      void super.update(entity.state);
    });
  }

  protected override shouldTile(state: MarkerState, totalCount: number): boolean {
    return (
      this.tilingOptions.enabled &&
      totalCount >= this.tilingOptions.minMarkerCount &&
      !state.draggable &&
      state.getAnimation() == null
    );
  }

  protected override async onTiledMarkersChanged(): Promise<void> {
    await this.syncTiledOverlay();
  }

  private async syncTiledOverlay(): Promise<void> {
    const generation = ++this.tileGeneration;
    const tiledStates = this.markerManager
      .allEntities()
      .filter(entity => entity.marker === null)
      .map(entity => entity.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    this.tileRouteId ??= `mc-azure-tile-${generateId()}`;
    const server = LocalTileServer.startServer();
    const renderer = new MarkerTileRenderer<MarkerState>(tiledStates, {
      tileSize: 256,
      iconScaleCallback: this.tilingOptions.iconScaleCallback ?? undefined,
    });
    this.tileRenderer = renderer;
    this.tileVersion++;
    server.register(this.tileRouteId, renderer);

    registerTileProtocol();
    await renderer.preloadIcons();
    const template = `${TILE_PROTOCOL}://${this.tileRouteId}/256/${this.tileVersion}/{z}/{x}/{y}.png`;

    // A newer sync (or clear()/destroy()) ran while we awaited icon preloading;
    // applying this stale result would resurrect a removed overlay or clobber a
    // newer one.
    if (generation !== this.tileGeneration) return;

    await this.onRasterLayerUpdate?.(createRasterLayerState({
      id: 'mc-marker-tiles',
      source: RasterLayerSource.UrlTemplate({ template, tileSize: 256 }),
    }));
  }

  private async removeTileOverlay(): Promise<void> {
    this.tileGeneration++;
    if (!this.tileRouteId) return;
    LocalTileServer.startServer().unregister(this.tileRouteId);
    this.tileRenderer = null;
    this.tileRouteId = null;
    await this.onRasterLayerUpdate?.(null);
  }

  override async clear(): Promise<void> {
    await super.clear();
    await this.removeTileOverlay();
  }

  override destroy(): void {
    void this.removeTileOverlay();
    super.destroy();
  }
}
