import {
  AbstractMarkerOverlayRenderer,
  bounceInterpolation,
  createDefaultIcon,
  type AddParams,
  type BitmapIcon,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
} from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import { AzureMapsMapViewHolder } from '../AzureMapsMapViewHolder';
import { MARKER_SYMBOL_LAYER_ID, toPosition } from '../helpers';

const MARKER_SOURCE_ID = 'mc-marker-symbols';
const MARKER_LAYER_ID = MARKER_SYMBOL_LAYER_ID;

// Height (px) the icon falls from for a drop/bounce. A fixed screen-space
// distance keeps the whole fall on-screen and, being a pure pixel offset, is
// independent of the marker's projected position (and thus its world copy).
const DROP_HEIGHT_PX = 260;

/** Stable image id for a bitmap icon URL, so identical icons share one sprite image. */
function iconImageId(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
  return `mc-icon-${(hash >>> 0).toString(36)}`;
}

/**
 * Per-feature symbol properties. The icon is anchored by its centre (SymbolLayer's
 * only expression-free anchor), then shifted by `mcOffset` so the icon's own
 * fractional anchor point (e.g. bottom-centre for a pin) lands on the geographic
 * position — the same anchoring the HtmlMarker renderer did with pixelOffset.
 */
/** Pixel offset placing the icon's fractional anchor on the (centre-anchored) symbol. */
function baseOffset(bitmapIcon: BitmapIcon): [number, number] {
  return [
    (0.5 - bitmapIcon.anchor.x) * bitmapIcon.size.width,
    (0.5 - bitmapIcon.anchor.y) * bitmapIcon.size.height,
  ];
}

function symbolProperties(state: { id: string }, bitmapIcon: BitmapIcon): Record<string, unknown> {
  return {
    mcId: state.id,
    mcImage: iconImageId(bitmapIcon.url),
    mcOffset: baseOffset(bitmapIcon),
    mcHidden: false,
  };
}

/**
 * Azure Maps marker renderer backed by a WebGL `SymbolLayer` (a shared
 * DataSource of point features) instead of DOM `HtmlMarker`s. Every marker is
 * an `atlas.Shape` in one DataSource; icons are registered once in the map's
 * image sprite and referenced per-feature. Because symbols are canvas-drawn
 * (no DOM node), clicks and drags are resolved from the tapped coordinate in
 * AzureMapsMarkerController / AzureMapsViewController, mirroring the vector
 * overlays and the other canvas-based providers (HERE, Mapbox).
 */
export class AzureMapsMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<
  AzureMapsMapViewHolder,
  atlas.Shape
> {
  private readonly source: atlas.source.DataSource;
  // Sprite images are reference-counted by icon id: an image is added to the
  // map's imageSprite when the first marker uses it and removed when the last
  // marker using it goes away. Without this, distinct icon URLs accumulate in
  // the sprite for the map's lifetime (they were never removed on any path).
  private readonly registeredImages = new Set<string>();
  private readonly iconRefs = new Map<string, number>();

  constructor(holder: AzureMapsMapViewHolder) {
    super({ holder });
    // Drop/bounce is animated on the map's WebGL canvas by moving the symbol's
    // pixel offset (see animateMarkerDrop/Bounce), not via the screen-space DOM
    // overlay. The overlay resolves its position by projecting the marker's
    // lng/lat to a pixel, which returns the primary world copy — so a marker at
    // a wrapped longitude (e.g. across the date line) would animate off-screen.
    // Animating the canvas symbol's offset tracks the marker in whatever world
    // copy it is drawn in, exactly like the other canvas-based providers.
    this.supportsAnimationOverlay = false;

    const map = holder.map;
    this.source = new atlas.source.DataSource(MARKER_SOURCE_ID);
    map.sources.add(this.source);
    map.layers.add(
      new atlas.layer.SymbolLayer(this.source, MARKER_LAYER_ID, {
        iconOptions: {
          image: ['get', 'mcImage'],
          // Fixed centre anchor + per-feature pixel offset reproduces each icon's
          // fractional anchor (SymbolLayer's `anchor` is not data-driven).
          anchor: 'center',
          offset: ['get', 'mcOffset'],
          // Markers must never be dropped by label collision.
          allowOverlap: true,
          ignorePlacement: true,
        },
        filter: ['!=', ['get', 'mcHidden'], true],
      }),
    );
  }

  /**
   * Drop animation, drawn on the canvas: the symbol falls from above the map
   * into place by animating its icon pixel offset. Because the offset is applied
   * to a symbol anchored at the marker's lng/lat, it tracks the correct world
   * copy (unlike a DOM overlay that projects to the primary copy). Overrides the
   * base geo-interpolation path.
   */
  override async animateMarkerDrop(entity: MarkerEntity<atlas.Shape>, duration: number): Promise<void> {
    await this.animateOffset(entity, duration, time => time);
  }

  /** Bounce animation, drawn on the canvas (see {@link animateMarkerDrop}). */
  override async animateMarkerBounce(entity: MarkerEntity<atlas.Shape>, duration: number): Promise<void> {
    await this.animateOffset(entity, duration, bounceInterpolation);
  }

  private animateOffset(
    entity: MarkerEntity<atlas.Shape>,
    duration: number,
    interpolate: (time: number) => number,
  ): Promise<void> {
    const shape = entity.marker;
    if (!shape) return Promise.resolve();
    const icon = entity.state.icon?.toBitmapIcon() ?? createDefaultIcon().toBitmapIcon();
    const [baseX, baseY] = baseOffset(icon);
    const dropPx = DROP_HEIGHT_PX;
    const setY = (y: number): void => shape.addProperty('mcOffset', [baseX, y]);

    this.animateStartListener?.(entity.state);
    return new Promise<void>(resolve => {
      const finish = (): void => {
        setY(baseY);
        entity.state.animate(null);
        this.animateEndListener?.(entity.state);
        resolve();
      };
      if (duration <= 0) {
        finish();
        return;
      }
      // Start above the map before the first paint to avoid a one-frame flash
      // of the marker at its final resting position.
      setY(baseY - dropPx);
      const startTime = performance.now();
      const step = (): void => {
        const t = Math.min(1, (performance.now() - startTime) / duration);
        const fraction = Math.max(0, interpolate(t));
        setY(baseY - dropPx * (1 - fraction));
        if (t < 1) requestAnimationFrame(step);
        else finish();
      };
      requestAnimationFrame(step);
    });
  }

  /** Registers an icon in the map's image sprite once, keyed by its URL hash. */
  private async ensureImage(bitmapIcon: BitmapIcon): Promise<void> {
    const id = iconImageId(bitmapIcon.url);
    if (this.registeredImages.has(id)) return;
    this.registeredImages.add(id);
    try {
      // The sprite image is at the icon's intrinsic pixel size (the SVG/data URL
      // is authored at bitmapIcon.size), so the symbol renders 1:1 at size 1.
      await this.holder.map.imageSprite.add(id, bitmapIcon.url);
    } catch (error) {
      this.registeredImages.delete(id);
      console.error('[MapConductor] Failed to add Azure marker icon to sprite', error);
    }
  }

  /** Increment an icon's ref count and ensure its sprite image is registered. */
  private async retainImage(bitmapIcon: BitmapIcon): Promise<void> {
    const id = iconImageId(bitmapIcon.url);
    this.iconRefs.set(id, (this.iconRefs.get(id) ?? 0) + 1);
    await this.ensureImage(bitmapIcon);
  }

  /** Decrement an icon's ref count; remove its sprite image when nothing uses it. */
  private releaseImage(id: string | undefined): void {
    if (!id) return;
    const next = (this.iconRefs.get(id) ?? 1) - 1;
    if (next > 0) {
      this.iconRefs.set(id, next);
      return;
    }
    this.iconRefs.delete(id);
    if (this.registeredImages.delete(id)) {
      try {
        this.holder.map.imageSprite.remove(id);
      } catch {
        // Image already gone (e.g. map torn down) — nothing to release.
      }
    }
  }

  async onAdd(data: AddParams[]): Promise<(atlas.Shape | null)[]> {
    return Promise.all(
      data.map(async ({ state, bitmapIcon }) => {
        await this.retainImage(bitmapIcon);
        const shape = new atlas.Shape(
          new atlas.data.Point(toPosition(state.position)),
          state.id,
          symbolProperties(state, bitmapIcon),
        );
        this.source.add(shape);
        return shape;
      }),
    );
  }

  async onChange(data: ChangeParams<atlas.Shape>[]): Promise<(atlas.Shape | null)[]> {
    return Promise.all(
      data.map(async ({ current, prev, bitmapIcon }) => {
        const shape = prev.marker;
        if (!shape) return null;
        // Re-count only when the icon actually changes: retain the new image and
        // release the old one so the sprite drops icons no marker uses anymore.
        const oldId = shape.getProperties()?.mcImage as string | undefined;
        const newId = iconImageId(bitmapIcon.url);
        if (oldId !== newId) {
          await this.retainImage(bitmapIcon);
          this.releaseImage(oldId);
        }
        shape.setCoordinates(toPosition(current.state.position));
        // Preserve current visibility (mcHidden) across property replacement.
        const hidden = shape.getProperties()?.mcHidden === true;
        shape.setProperties({ ...symbolProperties(current.state, bitmapIcon), mcHidden: hidden });
        return shape;
      }),
    );
  }

  async onRemove(data: MarkerEntity<atlas.Shape>[]): Promise<void> {
    for (const entity of data) {
      if (!entity.marker) continue;
      const id = entity.marker.getProperties()?.mcImage as string | undefined;
      this.source.remove(entity.marker);
      this.releaseImage(id);
    }
  }

  async onPostProcess(): Promise<void> {}

  setMarkerPosition(entity: MarkerEntity<atlas.Shape>, position: GeoPoint): void {
    entity.marker?.setCoordinates(toPosition(position));
  }

  override setMarkerVisible(entity: MarkerEntity<atlas.Shape>, visible: boolean): void {
    entity.marker?.addProperty('mcHidden', !visible);
  }
}
