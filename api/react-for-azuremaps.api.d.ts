import { MapConfig, GeoRectBounds, MarkerTilingOptions, MapProvider, MapViewControllerInterface, MapViewHolderBase, GeoPointInterface, Offset, GeoPoint, MapDesignTypeInterface, AttributionRule, AbstractMarkerOverlayRenderer, MarkerEntity, AddParams, ChangeParams, AbstractMarkerController, RasterLayerState, MarkerState, CircleController, AbstractCircleOverlayRenderer, PolylineController, AbstractPolylineOverlayRenderer, PolylineState, PolylineEntity, PolygonController, AbstractPolygonOverlayRenderer, PolygonState, PolygonEntity, GroundImageController, AbstractGroundImageOverlayRenderer, GroundImageState, GroundImageEntity, CircleState, CircleEntity, RasterLayerController, RasterHeaderSupport, RasterLayerAddParams, RasterLayerChangeParams, RasterLayerEntity, MapCameraPosition, BaseMapViewController, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable, MapUISettings, OnMapInitializedHandler, OnMarkerEventHandler, MarkerAnimationOverlayHost, CameraRestriction, MapViewStateInterface, MapViewState, MapViewBaseProps, WebMercatorZoomAltitudeConverter } from '@mapconductor/js-sdk-core';
import * as atlas from 'azure-maps-control';
import React from 'react';

interface AzureMapsConfig extends MapConfig {
    subscriptionKey?: string;
    style?: string;
    minZoom?: number;
    maxZoom?: number;
    /** Restricts panning so the camera center cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    markerTilingOptions?: MarkerTilingOptions;
}
declare class AzureMapsProvider extends MapProvider {
    private map;
    initialize(config: AzureMapsConfig): Promise<MapViewControllerInterface>;
    destroy(): void;
    /** Returns true if the rejection was caused by an intentional destroy() call. */
    static isDestroyedBeforeReady(error: unknown): boolean;
}

/**
 * Web port of the MapConductor view holder for Azure Maps.
 *
 * Azure Maps projects between geographic positions and container pixels via
 * `map.positionsToPixels` / `map.pixelsToPositions`, which are already relative
 * to the map container — the same space MapConductor overlays (InfoBubble,
 * marker animation) live in.
 */
declare class AzureMapsMapViewHolder extends MapViewHolderBase<HTMLElement, atlas.Map> {
    readonly mapView: HTMLElement;
    readonly map: atlas.Map;
    private _controller;
    constructor(mapView: HTMLElement, map: atlas.Map);
    getController(): AzureMapsViewController | null;
    setController(controller: AzureMapsViewController): void;
    toScreenOffset(position: GeoPointInterface): Offset;
    fromScreenOffsetSync(offset: Offset): GeoPoint;
}

/**
 * An Azure Maps design maps a MapConductor design identifier to an Azure Maps
 * base map style name (the `style` option of the `atlas.Map` / `map.setStyle`).
 * Supported style names are listed in the Azure Maps "supported map styles" doc.
 */
interface AzureMapsMapDesignType extends MapDesignTypeInterface<string> {
    readonly style: string;
}
declare class AzureMapsDesign implements AzureMapsMapDesignType {
    readonly id: string;
    readonly style: string;
    readonly attributionRules: readonly AttributionRule[];
    constructor(id: string, style: string, attributionRules?: readonly AttributionRule[]);
    getValue(): string;
    static readonly Road: AzureMapsDesign;
    static readonly RoadShadedRelief: AzureMapsDesign;
    static readonly Blank: AzureMapsDesign;
    static readonly BlankAccessible: AzureMapsDesign;
    static readonly Satellite: AzureMapsDesign;
    static readonly SatelliteRoadLabels: AzureMapsDesign;
    static readonly GrayscaleDark: AzureMapsDesign;
    static readonly GrayscaleLight: AzureMapsDesign;
    static readonly Night: AzureMapsDesign;
    static readonly HighContrastDark: AzureMapsDesign;
    static readonly HighContrastLight: AzureMapsDesign;
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
declare class AzureMapsMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<AzureMapsMapViewHolder, atlas.Shape> {
    private readonly source;
    private readonly registeredImages;
    private readonly iconRefs;
    constructor(holder: AzureMapsMapViewHolder);
    /**
     * Drop animation, drawn on the canvas: the symbol falls from above the map
     * into place by animating its icon pixel offset. Because the offset is applied
     * to a symbol anchored at the marker's lng/lat, it tracks the correct world
     * copy (unlike a DOM overlay that projects to the primary copy). Overrides the
     * base geo-interpolation path.
     */
    animateMarkerDrop(entity: MarkerEntity<atlas.Shape>, duration: number): Promise<void>;
    /** Bounce animation, drawn on the canvas (see {@link animateMarkerDrop}). */
    animateMarkerBounce(entity: MarkerEntity<atlas.Shape>, duration: number): Promise<void>;
    private animateOffset;
    /** Registers an icon in the map's image sprite once, keyed by its URL hash. */
    private ensureImage;
    /** Increment an icon's ref count and ensure its sprite image is registered. */
    private retainImage;
    /** Decrement an icon's ref count; remove its sprite image when nothing uses it. */
    private releaseImage;
    onAdd(data: AddParams[]): Promise<(atlas.Shape | null)[]>;
    onChange(data: ChangeParams<atlas.Shape>[]): Promise<(atlas.Shape | null)[]>;
    onRemove(data: MarkerEntity<atlas.Shape>[]): Promise<void>;
    onPostProcess(): Promise<void>;
    setMarkerPosition(entity: MarkerEntity<atlas.Shape>, position: GeoPoint): void;
    setMarkerVisible(entity: MarkerEntity<atlas.Shape>, visible: boolean): void;
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
declare class AzureMapsMarkerController extends AbstractMarkerController<atlas.Shape> {
    private readonly map;
    private readonly tilingOptions;
    readonly renderer: AzureMapsMarkerOverlayRenderer;
    private tileRenderer;
    private tileRouteId;
    private tileVersion;
    private tileGeneration;
    private dragCandidate;
    private dragging;
    /** Pan state before a marker drag, so `uiSettings.scrollGesture` survives it. */
    private dragPanWasEnabled;
    /** Wired by AzureMapsViewController to drive the tiled-marker raster overlay. */
    onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null;
    constructor(map: atlas.Map, renderer: AzureMapsMarkerOverlayRenderer, tilingOptions?: MarkerTilingOptions);
    update(state: MarkerState): Promise<void>;
    /** Nearest tiled (raster) marker to a clicked point, or null. */
    findTiled(position: GeoPoint, zoom: number): MarkerEntity<atlas.Shape> | null;
    /**
     * Top-most non-tiled marker whose on-screen icon rectangle contains the tapped
     * point (falling back to the nearest within the tap tolerance). Replaces the
     * per-marker DOM click that HtmlMarker provided. Mirrors HERE's `find`.
     */
    find(position: GeoPoint): MarkerEntity<atlas.Shape> | null;
    /**
     * Synthesizes marker drag from map pointer events: SymbolLayer features have no
     * DOM node and no native drag, so press a draggable marker to disable map pan
     * and follow the pointer, promoting to a drag only once it actually moves (so a
     * press-release with no movement stays a click).
     */
    private setupDragHandling;
    protected shouldTile(state: MarkerState, totalCount: number): boolean;
    protected onTiledMarkersChanged(): Promise<void>;
    private syncTiledOverlay;
    private removeTileOverlay;
    clear(): Promise<void>;
    destroy(): void;
}

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
    source?: atlas.source.DataSource;
    fill?: atlas.layer.PolygonLayer;
    stroke?: atlas.layer.LineLayer;
    imageLayer?: atlas.layer.ImageLayer;
    sourceUrl?: string;
}
declare class AzureMapsCircleRenderer extends AbstractCircleOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
    createCircle(state: CircleState): Promise<VectorHandle>;
    updateCircleProperties({ circle, current }: {
        circle: VectorHandle;
        current: CircleEntity<VectorHandle>;
        prev: CircleEntity<VectorHandle>;
    }): Promise<VectorHandle | null>;
    removeCircle(entity: CircleEntity<VectorHandle>): Promise<void>;
}
declare class AzureMapsCircleController extends CircleController<VectorHandle> {
    constructor(renderer: AzureMapsCircleRenderer);
}
declare class AzureMapsPolylineRenderer extends AbstractPolylineOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
    createPolyline(state: PolylineState): Promise<VectorHandle>;
    updatePolylineProperties({ polyline, current }: {
        polyline: VectorHandle;
        current: PolylineEntity<VectorHandle>;
        prev: PolylineEntity<VectorHandle>;
    }): Promise<VectorHandle | null>;
    removePolyline(entity: PolylineEntity<VectorHandle>): Promise<void>;
}
declare class AzureMapsPolylineController extends PolylineController<VectorHandle> {
    constructor(renderer: AzureMapsPolylineRenderer);
}
declare class AzureMapsPolygonRenderer extends AbstractPolygonOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
    createPolygon(state: PolygonState): Promise<VectorHandle>;
    updatePolygonProperties({ polygon, current }: {
        polygon: VectorHandle;
        current: PolygonEntity<VectorHandle>;
        prev: PolygonEntity<VectorHandle>;
    }): Promise<VectorHandle | null>;
    removePolygon(entity: PolygonEntity<VectorHandle>): Promise<void>;
}
declare class AzureMapsPolygonController extends PolygonController<VectorHandle> {
    constructor(renderer: AzureMapsPolygonRenderer);
}
declare class AzureMapsGroundImageRenderer extends AbstractGroundImageOverlayRenderer<AzureMapsMapViewHolder, VectorHandle> {
    private imageCoordinates;
    /**
     * 画像を一度だけ取得して blob の object URL にして使い回す。
     *
     * Azure の `ImageLayer` は `setOptions({ coordinates })` のたびに内部のイメージソースを
     * 作り直し、`url` を渡していなくても画像を取り直す。ネットワーク往復のあいだ画像が
     * 消えるため、隅のマーカーをドラッグすると毎回ちらつく。object URL にしておくと
     * 取り直しがメモリから即座に解決されるので、空フレームが出ない。
     *
     * 取得に失敗したとき（CORS など）は元の URL をそのまま使う ＝ 従来どおりの挙動。
     */
    private toReusableUrl;
    createGroundImage(state: GroundImageState): Promise<VectorHandle | null>;
    updateGroundImageProperties({ groundImage, current }: {
        groundImage: VectorHandle;
        current: GroundImageEntity<VectorHandle>;
        prev: GroundImageEntity<VectorHandle>;
    }): Promise<VectorHandle | null>;
    removeGroundImage(entity: GroundImageEntity<VectorHandle>): Promise<void>;
}
declare class AzureMapsGroundImageController extends GroundImageController<VectorHandle> {
    constructor(renderer: AzureMapsGroundImageRenderer);
}

declare class AzureMapsRasterLayerRenderer {
    readonly holder: AzureMapsMapViewHolder;
    constructor(holder: AzureMapsMapViewHolder);
    onAdd(data: RasterLayerAddParams[]): Promise<(atlas.layer.TileLayer | null)[]>;
    onChange(data: RasterLayerChangeParams<atlas.layer.TileLayer>[]): Promise<(atlas.layer.TileLayer | null)[]>;
    onRemove(data: RasterLayerEntity<atlas.layer.TileLayer>[]): Promise<void>;
    onCameraChanged(_camera: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
    private create;
    private remove;
}
declare class AzureMapsRasterLayerController extends RasterLayerController<atlas.layer.TileLayer> {
    /**
     * azure-maps-control の transformRequest（AzureMapsProvider が地図生成時に差している）。
     *
     * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
     */
    protected get headerSupport(): RasterHeaderSupport;
    constructor(renderer: AzureMapsRasterLayerRenderer);
    composition(data: RasterLayerState[]): Promise<void>;
    update(state: RasterLayerState): Promise<void>;
}

declare class AzureMapsViewController extends BaseMapViewController implements MapViewControllerInterface, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable {
    readonly holder: AzureMapsMapViewHolder;
    private readonly markerController;
    private readonly circleController;
    private readonly polylineController;
    private readonly polygonController;
    private readonly groundImageController;
    private readonly rasterLayerController;
    private readonly map;
    private initialized;
    private destroyed;
    private logicalTiltHint;
    constructor(holder: AzureMapsMapViewHolder, markerController: AzureMapsMarkerController, circleController: AzureMapsCircleController, polylineController: AzureMapsPolylineController, polygonController: AzureMapsPolygonController, groundImageController: AzureMapsGroundImageController, rasterLayerController: AzureMapsRasterLayerController, logicalTiltHint?: number | null);
    getMap(): atlas.Map;
    /**
     * Azure Maps groups its gestures under `setUserInteraction`. It has no switch
     * for pitch on its own: `dragRotateInteraction` rotates *and* pitches on a
     * right-button drag, and a two-finger drag pitches whenever touch input is on
     * at all, so a tilt block cannot be honoured.
     */
    applyUISettings(settings: MapUISettings): void;
    /**
     * Switch the base map style in place. Azure Maps applies a new style name via
     * `setStyle` without recreating the map, so the camera and DOM-based markers
     * are preserved. Called by the view state's `mapDesignType` setter.
     */
    setMapDesignType(value: AzureMapsMapDesignType): void;
    private setupEventListeners;
    setMapInitializedListener(listener: OnMapInitializedHandler | null): void;
    private notifyControllersCameraChanged;
    moveCamera(position: MapCameraPosition): Promise<boolean>;
    animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;
    fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;
    getCameraPosition(): MapCameraPosition | null;
    private getVisibleRegion;
    setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDrag(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void;
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    clearOverlays(): Promise<void>;
    /**
     * Azure Maps は `setCamera` で範囲制限をランタイム変更できるので直接適用する。
     * ズームは統一ズーム（Google 準拠）と同一体系。
     */
    setCameraRestriction(restriction: CameraRestriction | null): void;
    destroy(): void;
}

interface AzureMapsViewStateInterface extends MapViewStateInterface<AzureMapsMapDesignType> {
    readonly subscriptionKey?: string;
}
interface AzureMapsViewStateParams {
    id?: string;
    subscriptionKey?: string;
    mapDesignType?: AzureMapsMapDesignType;
    cameraPosition?: MapCameraPosition;
}
declare class AzureMapsViewState extends MapViewState<AzureMapsMapDesignType> implements AzureMapsViewStateInterface {
    readonly subscriptionKey?: string;
    private _mapDesignType;
    constructor({ id, subscriptionKey, mapDesignType, cameraPosition, }?: AzureMapsViewStateParams);
    get mapDesignType(): AzureMapsMapDesignType;
    set mapDesignType(value: AzureMapsMapDesignType);
}
declare function useAzureMapsViewState(params?: AzureMapsViewStateParams): AzureMapsViewStateInterface;

interface AzureMapsMapViewProps extends MapViewBaseProps<AzureMapsViewStateInterface> {
    style?: React.CSSProperties;
    containerStyle?: React.CSSProperties;
    markerTilingOptions?: MarkerTilingOptions;
    minZoom?: number;
    maxZoom?: number;
    /** Restricts panning so the camera center cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    onError?: (error: Error) => void;
    children?: React.ReactNode;
}
/**
 * Azure Maps React component.
 *
 * Note: You must import the Azure Maps CSS separately:
 * import '@mapconductor/react-for-azuremaps/style.css';
 */
declare function AzureMapsMapView({ state, className, style, containerStyle, markerTilingOptions, minZoom, maxZoom, restrictBounds, cameraRestriction, onError, onMapLoaded, onMapClick, onMapLongClick, onCameraMoveStart, onCameraMove, onCameraMoveEnd, children, }: AzureMapsMapViewProps): React.JSX.Element;

/**
 * 統一ズーム（Google Maps 基準・256px タイル）⇄ 高度の変換。
 *
 * Azure Maps の Web SDK は（Mapbox GL と同じく）512px タイルで描くので、
 * 同じ見た目の縮尺でも報告されるズームが 1 段低い。つまり
 * `GoogleZoom ≈ AzureZoom + 1`。
 * 換算式はコアの {@link WebMercatorZoomAltitudeConverter} にある。
 */
declare class ZoomAltitudeConverter extends WebMercatorZoomAltitudeConverter {
    /** Empirical offset: GoogleZoom ≈ AzureMaps.zoom + 1.0 */
    static readonly AZURE_TO_GOOGLE_ZOOM_OFFSET = 1;
    constructor(zoom0Altitude?: number);
    static azureZoomToGoogleZoom(azureZoom: number): number;
    static googleZoomToAzureZoom(googleZoom: number): number;
}

/** Azure Maps positions are [longitude, latitude] tuples. */
type Position = [number, number];

interface AzureCameraParams {
    center: Position;
    zoom: number;
    bearing: number;
    tilt: number;
}
/**
 * Converts a MapConductor MapCameraPosition to Azure Maps camera parameters.
 * Applies the zoom offset: AzureZoom = GoogleZoom - 1.
 */
declare function toCameraPosition(pos: MapCameraPosition): AzureCameraParams;
/**
 * Converts Azure Maps camera state to a MapConductor MapCameraPosition.
 * Applies the zoom offset: GoogleZoom = AzureZoom + 1.
 */
declare function toMapCameraPosition({ center, zoom, bearing, tilt, logicalTiltHint, }: {
    center: atlas.data.Position;
    zoom: number;
    bearing: number;
    tilt: number;
    logicalTiltHint?: number | null;
}): MapCameraPosition;

export { type AzureCameraParams, AzureMapsCircleController, AzureMapsCircleRenderer, type AzureMapsConfig, AzureMapsDesign, AzureMapsGroundImageController, AzureMapsGroundImageRenderer, type AzureMapsMapDesignType, AzureMapsMapView, AzureMapsMapViewHolder, type AzureMapsMapViewProps, AzureMapsMarkerController, AzureMapsMarkerOverlayRenderer, AzureMapsPolygonController, AzureMapsPolygonRenderer, AzureMapsPolylineController, AzureMapsPolylineRenderer, AzureMapsProvider, AzureMapsRasterLayerController, AzureMapsRasterLayerRenderer, AzureMapsViewController, AzureMapsViewState, type AzureMapsViewStateInterface, type AzureMapsViewStateParams, ZoomAltitudeConverter, toCameraPosition, toMapCameraPosition, useAzureMapsViewState };
