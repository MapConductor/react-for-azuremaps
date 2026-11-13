import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MARKER_HIT_RADIUS_TOUCH_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  createDefaultIcon,
  tilePixelRatio,
  createRasterLayerState,
  type GeoPoint,
  type MarkerEntity,
  type MarkerState,
  type RasterLayerState,
  markerHitShape,
  pickMarkerHit,
  preferMarkerHit,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsMarkerOverlayRenderer } from './AzureMapsMarkerOverlayRenderer';
import { AzureMapsMarkerEventController } from './AzureMapsMarkerEventController';
import { localTileUrlTemplate, MAPCONDUCTOR_TILE_PROTOCOL, parseLocalTileUrl } from './localTileUrl';

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

/**
 * Route `mc-local-tile://` tile requests to MapConductor's in-process tile
 * server. Mirrors the Mapbox provider's `mapboxgl.addProtocol` registration —
 * Azure Maps exposes the same `atlas.addProtocol` hook (both are Mapbox-GL
 * derived), so tiled markers render as a raster overlay without a service worker.
 */
function registerTileProtocol(): void {
  if (tileProtocolRegistered) return;
  atlas.addProtocol(MAPCONDUCTOR_TILE_PROTOCOL, async (params: { url: string }) => {
    const parsed = parseLocalTileUrl(params.url);
    if (!parsed) return { data: toArrayBuffer(EMPTY_TILE) };
    // An empty spot comes back as a transparent tile; a render that failed
    // throws, which the protocol reads as a load to retry. Answering a
    // failure with a transparent tile would cache a hole instead.
    const bytes = await LocalTileServer.startServer().fetchTileOrThrow(parsed.routeId, {
      x: parsed.x,
      y: parsed.y,
      z: parsed.z,
      pixelRatio: parsed.pixelRatio,
    });
    return { data: toArrayBuffer(bytes) };
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
 * coordinate via {@link find}. Drags go through js-sdk-core's
 * `DefaultMarkerEventController` (see {@link AzureMapsMarkerEventController}),
 * as on the GL providers: a press that does not pass the drag threshold is a tap.
 */
export class AzureMapsMarkerController extends AbstractMarkerController<atlas.Shape> {
  declare readonly renderer: AzureMapsMarkerOverlayRenderer;

  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
  /** Device pixels per CSS pixel the current tiles are drawn at. */
  private tilePixelRatio = 1;
  private tileGeneration = 0;

  /** The marker held by the pointer, from press to release (`MarkerEventHost`). */
  private selected: MarkerEntity<atlas.Shape> | null = null;
  private readonly eventController: AzureMapsMarkerEventController;

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
    this.eventController = new AzureMapsMarkerEventController(this, map);
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
    return this.findWithZoom(position, this.map.getCamera().zoom ?? 0, 'mouse');
  }

  /**
   * {@link find} with the pointer's slop: none for a mouse,
   * `MARKER_HIT_RADIUS_TOUCH_PX` for a finger (`MarkerEventHost.findWithZoom`).
   *
   * @internal ドライバー実装点。
   */
  findWithZoom(
    position: GeoPoint,
    zoom: number,
    pointerType: 'touch' | 'mouse',
  ): MarkerEntity<atlas.Shape> | null {
    const tolerance =
      pointerType === 'touch' ? MARKER_HIT_RADIUS_TOUCH_PX : MARKER_HIT_RADIUS_MOUSE_PX;
    const [touch] = this.map.positionsToPixels([[position.longitude, position.latitude]]);
    // 選び方はコアの pickMarkerHit（android / iOS の MarkerHitTest.pickIndex）と同じ。指の下に
    // アイコン（ラベル込み）が描かれているマーカーを、アンカーの近い別のマーカーより優先する。
    const regular = pickMarkerHit(
      { x: touch[0], y: touch[1] },
      this.markerManager.allEntities().filter(entity => entity.marker != null), // tiled markers below
      entity => {
        const [mp] = this.map.positionsToPixels([[
          entity.state.position.longitude,
          entity.state.position.latitude,
        ]]);
        // The pin as drawn, not its square bitmap (a default pin is ~31 px
        // wide in a 48 px square).
        const icon = entity.state.icon?.toBitmapIcon() ?? createDefaultIcon().toBitmapIcon();
        return { anchorScreen: { x: mp[0], y: mp[1] }, ...markerHitShape(icon) };
      },
      // The pointer's slop, as for tiled markers below — none for a mouse.
      // `Settings.Default.tapTolerance` (48) is a map-wide tap slop and made a
      // 48 px icon answer clicks 48 px outside it.
      tolerance,
    );
    if (regular?.exact) return regular.item;
    // タイル化マーカーも同じ規則で比べる（指の下に描かれていれば、通常マーカーの近接より勝つ）。
    const tiledHit = this.tileRenderer?.findHit(position, tolerance, zoom) ?? null;
    const tiledEntity = tiledHit ? this.markerManager.getEntity(tiledHit.item.id) : null;
    return preferMarkerHit<MarkerEntity<atlas.Shape>>(
      regular,
      tiledHit && tiledEntity ? { ...tiledHit, item: tiledEntity } : null,
    )?.item ?? null;
  }


  // ── MarkerEventHost: the marker a press holds until release ──────────────

  /** @internal ドライバー実装点（`MarkerEventHost`）。 */
  getSelectedMarker(): MarkerEntity<atlas.Shape> | null {
    return this.selected;
  }

  /**
   * Called on press (the entity) and on release (null). While a marker is held
   * its shape follows the pointer directly; {@link update} leaves it alone so
   * the MarkerState emissions of the drag do not fight it, and the release
   * applies the final state once.
   *
   * @internal ドライバー実装点（`MarkerEventHost`）。
   */
  setSelectedMarker(entity: MarkerEntity<atlas.Shape> | null): void {
    const previous = this.selected;
    if (previous === entity) return;
    this.selected = entity;
    if (previous) {
      this.setDraggingState(previous.state, false);
      void super.update(previous.state);
    }
    if (entity) this.setDraggingState(entity.state, true);
  }

  /** @internal ドライバー実装点（`MarkerEventHost`）。 */
  updateSelectedPosition(position: GeoPoint | null): void {
    const entity = this.selected;
    if (!entity || position == null) return;
    this.renderer.setMarkerPosition(entity, position);
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
      .filter(entity => entity.tiling)
      .map(entity => entity.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    this.tileRouteId ??= `mc-azure-tile-${generateId()}`;
    const server = LocalTileServer.startServer();
    // Tiles are laid out as 256 CSS pixels; drawing them at the display's ratio
    // keeps pins and labels sharp instead of stretching a 1x image.
    this.tilePixelRatio = tilePixelRatio();
    const renderer = new MarkerTileRenderer<MarkerState>(
      tiledStates,
      256,
      this.tilingOptions.iconScaleCallback ?? undefined,
      1.0,
      false,
      this.tilingOptions.declutterPx,
      this.tilePixelRatio,
    );
    this.tileRenderer = renderer;
    this.tileVersion++;
    server.register(this.tileRouteId, renderer);

    registerTileProtocol();
    await renderer.preloadIcons();
    const template = localTileUrlTemplate({
      routeId: this.tileRouteId,
      tileSize: 256,
      cacheKey: String(this.tileVersion),
      pixelRatio: this.tilePixelRatio,
    });

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
    this.eventController.destroy();
    void this.removeTileOverlay();
    super.destroy();
  }
}
