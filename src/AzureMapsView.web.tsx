import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MapContext,
  MapViewScope,
  MapServiceRegistryProvider,
  MapViewScopeProvider,
  InfoBubbleOverlay,
  MarkerAnimationLayer,
  MapAttributionOverlay,
  type InfoBubbleEntry,
} from '@mapconductor/js-sdk-react';
import {
  useCameraRestriction,
  useMapUISettings,
  useMarkerRenderingSupport,
} from '@mapconductor/js-sdk-react/internal';
import {
  type GeoPoint,
  type GeoRectBounds,
  type MapCameraPosition,
  type MapViewBaseProps,
  type MarkerAnimationOverlayEntry,
  type MarkerTilingOptions,
  type OverlayCollector,
  type MapViewControllerInterface,
} from '@mapconductor/js-sdk-core';
import { AzureMapsProvider, type AzureMapsConfig } from './AzureMapsProvider';
import type { AzureMapsViewStateInterface } from './AzureMapsViewState';
import type { AzureMapsViewController } from './AzureMapsViewController';

const MISSING_KEY_MESSAGE =
  'An Azure Maps subscription key is required. Set subscriptionKey via useAzureMapsViewState({ subscriptionKey }).';

export interface AzureMapsMapViewProps extends MapViewBaseProps<AzureMapsViewStateInterface> {
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
export function AzureMapsMapView({
  state,
  className,
  style,
  containerStyle,
  markerTilingOptions,
  minZoom,
  maxZoom,
  restrictBounds,
  cameraRestriction,
  onError,
  onMapLoaded,
  onMapClick,
  onMapLongClick,
  onCameraMoveStart,
  onCameraMove,
  onCameraMoveEnd,
  children,
}: AzureMapsMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [provider] = useState(() => new AzureMapsProvider());
  const [scope] = useState(() => new MapViewScope());
  const [controller, setController] = useState<MapViewControllerInterface | null>(null);
  const [isReady, setIsReady] = useState(false);
  // `onMapLoaded` と同じ瞬間を「値」として持つ。イベントを取り逃した後から
  // マウントした子（examples の Three.js overlay 等）も読めるようにするため。
  const [isLoaded, setIsLoaded] = useState(false);
  const bridgeUnsubs = useRef<(() => void)[]>([]);
  const typedControllerRef = useRef<AzureMapsViewController | null>(null);
  const [bubbleEntries, setBubbleEntries] = useState<InfoBubbleEntry[]>([]);
  const [animationEntries, setAnimationEntries] = useState<MarkerAnimationOverlayEntry[]>([]);
  const [cameraTick, setCameraTick] = useState(0);
  const [initializationError, setInitializationError] = useState<Error | null>(null);
  const missingKey = !state.subscriptionKey?.trim();

  const onMapLoadedRef = useRef(onMapLoaded);
  const onMapClickRef = useRef(onMapClick);
  const onMapLongClickRef = useRef(onMapLongClick);
  const onCameraMoveStartRef = useRef(onCameraMoveStart);
  const onCameraMoveRef = useRef(onCameraMove);
  const onCameraMoveEndRef = useRef(onCameraMoveEnd);
  const onErrorRef = useRef(onError);
  onMapLoadedRef.current = onMapLoaded;
  onMapClickRef.current = onMapClick;
  onMapLongClickRef.current = onMapLongClick;
  onCameraMoveStartRef.current = onCameraMoveStart;
  onCameraMoveRef.current = onCameraMove;
  onCameraMoveEndRef.current = onCameraMoveEnd;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!containerRef.current) return;

    const subscriptionKey = state.subscriptionKey?.trim();
    if (!subscriptionKey) {
      const error = new Error(MISSING_KEY_MESSAGE);
      setInitializationError(error);
      onErrorRef.current?.(error);
      return;
    }

    let cancelled = false;
    setInitializationError(null);
    setIsReady(false);
    setIsLoaded(false);

    const config: AzureMapsConfig = {
      container: containerRef.current,
      subscriptionKey,
      style: state.mapDesignType.style,
      initCameraPosition: state.cameraPosition,
      markerTilingOptions,
      minZoom,
      maxZoom,
      restrictBounds,
    };

    provider
      .initialize(config)
      .then(ctrl => {
        if (cancelled) return;

        state.setController(ctrl);
        state.setCameraPositionChangeListener(() => setCameraTick(t => t + 1));
        setController(ctrl);
        typedControllerRef.current = ctrl as AzureMapsViewController;

        ctrl.setCameraMoveStartListener((camera: MapCameraPosition) => {
          state.updateCameraPosition(camera);
          onCameraMoveStartRef.current?.(camera);
        });
        ctrl.setCameraMoveListener((camera: MapCameraPosition) => {
          state.updateCameraPosition(camera);
          onCameraMoveRef.current?.(camera);
          setCameraTick(t => t + 1);
        });
        ctrl.setCameraMoveEndListener((camera: MapCameraPosition) => {
          state.updateCameraPosition(camera);
          onCameraMoveEndRef.current?.(camera);
          setCameraTick(t => t + 1);
        });
        ctrl.setMapClickListener((point: GeoPoint) => onMapClickRef.current?.(point));
        ctrl.setMapLongClickListener((point: GeoPoint) => onMapLongClickRef.current?.(point));
        ctrl.setMapInitializedListener(() => {
          const initialCamera = typedControllerRef.current?.getCameraPosition() ?? null;
          // 地図が出来た時点の実カメラ（visibleRegion 込み）を state へ流し込む。
          if (initialCamera) state.updateCameraPosition(initialCamera);
          setIsLoaded(true);
          onMapLoadedRef.current?.(state);
          setCameraTick(t => t + 1);
        });

        const registry = scope.buildRegistry();
        for (const overlay of registry.getAll()) {
          const unsub = overlay.subscribe(data => {
            overlay.render(data, ctrl).catch(console.error);
          });
          bridgeUnsubs.current.push(unsub);
        }

        const bubbleUnsub = scope.bubbleCollector.subscribe(map => {
          setBubbleEntries(Array.from(map.values()));
        });
        bridgeUnsubs.current.push(bubbleUnsub);

        typedControllerRef.current.setMarkerAnimationOverlayHost(scope.markerAnimationStore.start);
        bridgeUnsubs.current.push(() => typedControllerRef.current?.setMarkerAnimationOverlayHost(null));
        const animationUnsub = scope.markerAnimationStore.subscribe(setAnimationEntries);
        bridgeUnsubs.current.push(animationUnsub);

        const c = ctrl as unknown as Record<string, (s: never) => unknown>;
        const setupUpdateHandler = <S extends { id: string }>(
          collector: OverlayCollector<S>,
          hasMethod: string,
          updateMethod: string,
          onUpdated?: () => void,
        ) => {
          collector.setUpdateHandler(updated => {
            if ((c[hasMethod] as (s: S) => boolean)?.(updated)) {
              void (c[updateMethod] as (s: S) => Promise<void>)?.(updated);
              onUpdated?.();
            }
          });
          bridgeUnsubs.current.push(() => collector.setUpdateHandler(null));
        };

        setupUpdateHandler(scope.markerCollector, 'hasMarker', 'updateMarker', () => setCameraTick(t => t + 1));
        setupUpdateHandler(scope.circleCollector, 'hasCircle', 'updateCircle');
        setupUpdateHandler(scope.polylineCollector, 'hasPolyline', 'updatePolyline');
        setupUpdateHandler(scope.polygonCollector, 'hasPolygon', 'updatePolygon');
        setupUpdateHandler(scope.groundImageCollector, 'hasGroundImage', 'updateGroundImage');
        setupUpdateHandler(scope.rasterLayerCollector, 'hasRasterLayer', 'updateRasterLayer');

        setIsReady(true);
      })
      .catch(error => {
        if (cancelled || AzureMapsProvider.isDestroyedBeforeReady(error)) return;
        console.error('Failed to initialize Azure Maps:', error);
        const initError = error instanceof Error ? error : new Error(String(error));
        setInitializationError(initError);
        onErrorRef.current?.(initError);
      });

    return () => {
      cancelled = true;
      state.setCameraPositionChangeListener(null);
      state.setController(null);
      typedControllerRef.current = null;
      bridgeUnsubs.current.forEach(unsub => unsub());
      bridgeUnsubs.current = [];
      provider.destroy();
    };
    // Design changes are applied live via the controller (see AzureMapsViewState's
    // mapDesignType setter -> controller.setMapDesignType), so the map is not torn
    // down and re-initialized when only the design changes.
  }, [state.subscriptionKey]);

  // cameraTick forces a re-render on camera moves so bubbles re-project.
  void cameraTick;

  useMapUISettings(state, controller);
  // マップ生成時 config だけでなく、prop の変化にも追随させる（android-sdk 相当）。
  useCameraRestriction(controller, { cameraRestriction, restrictBounds, minZoom, maxZoom });


  // マーカー描画 capability をこのマップのサービスレジストリへ登録する。
  // marker-clustering などの拡張がここから解決する
  // （android-sdk の *MapView.kt / ios-sdk の *MapView.swift が
  //  MarkerRenderingSupportKey を put するのと同じ位置づけ）。
  useMarkerRenderingSupport(state, scope, controller);

  return (
    <MapContext.Provider value={{ controller, isReady, isLoaded, state }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          ...style,
          ...containerStyle,
        }}
      >
        <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }} />
        {(missingKey || initializationError) && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              boxSizing: 'border-box',
              background: '#fff',
              color: '#b91c1c',
              fontFamily: 'sans-serif',
              textAlign: 'center',
            }}
          >
            {missingKey ? MISSING_KEY_MESSAGE : initializationError?.message}
          </div>
        )}
        <MapAttributionOverlay
          scope={scope}
          camera={state.cameraPosition}
          designAttributionRules={state.mapDesignType.attributionRules}
        />
        {animationEntries.length > 0 && typedControllerRef.current && (
          <MarkerAnimationLayer
            entries={animationEntries}
            resolveScreenOffset={entry => typedControllerRef.current!.holder.toScreenOffset(entry.state.position)}
          />
        )}
        {bubbleEntries.length > 0 && typedControllerRef.current && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {bubbleEntries.map(entry => {
              const holder = typedControllerRef.current!.holder;
              const pos = entry.positionProvider();
              const screenOffset = holder.toScreenOffset(pos);
              if (!screenOffset) return null;
              const icon = entry.icon;
              const iconPixelSize = icon ? icon.iconSize * icon.scale : 0;
              return (
                <InfoBubbleOverlay
                  key={entry.id}
                  positionOffset={screenOffset}
                  iconSize={{ width: iconPixelSize, height: iconPixelSize }}
                  iconOffset={icon ? icon.anchor : { x: 0.5, y: 0.5 }}
                  infoAnchorOffset={icon ? icon.infoAnchor : { x: 0.5, y: 0.5 }}
                  tailOffset={entry.tailOffset}
                  style={{ pointerEvents: 'auto' }}
                >
                  {entry.content as ReactNode}
                </InfoBubbleOverlay>
              );
            })}
          </div>
        )}
      </div>
      <MapServiceRegistryProvider registry={state.serviceRegistry}>
        <MapViewScopeProvider scope={scope}>{children}</MapViewScopeProvider>
      </MapServiceRegistryProvider>
    </MapContext.Provider>
  );
}
