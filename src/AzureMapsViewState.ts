import { useState } from 'react';
import {
  MapViewState,
  MapCameraPosition as MapCameraPositionNS,
  createRandomId,
  type GeoPoint,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type GeoRectBounds,
  type MapViewHolder,
  type MapViewStateInterface,
} from '@mapconductor/js-sdk-core';
import { AzureMapsDesign, type AzureMapsMapDesignType } from './AzureMapsDesign';

export interface AzureMapsViewStateInterface extends MapViewStateInterface<AzureMapsMapDesignType> {
  readonly subscriptionKey?: string;
}

export interface AzureMapsViewStateParams {
  id?: string;
  subscriptionKey?: string;
  mapDesignType?: AzureMapsMapDesignType;
  cameraPosition?: MapCameraPosition;
}

export class AzureMapsViewState
  extends MapViewState<AzureMapsMapDesignType>
  implements AzureMapsViewStateInterface
{
  readonly id: string;
  readonly subscriptionKey?: string;
  private _cameraPosition: MapCameraPosition;
  private _mapDesignType: AzureMapsMapDesignType;
  private _controller: MapViewControllerInterface | null = null;
  private _cameraPositionChangeListener: ((camera: MapCameraPosition) => void) | null = null;

  constructor({
    id = createRandomId(),
    subscriptionKey,
    mapDesignType = AzureMapsDesign.Road,
    cameraPosition = MapCameraPositionNS.Default,
  }: AzureMapsViewStateParams = {}) {
    super();
    this.id = id;
    this.subscriptionKey = subscriptionKey;
    this._cameraPosition = cameraPosition;
    this._mapDesignType = mapDesignType;
  }

  override get cameraPosition(): MapCameraPosition {
    return this._cameraPosition;
  }

  override get mapDesignType(): AzureMapsMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: AzureMapsMapDesignType) {
    this._mapDesignType = value;
    const controller = this._controller as { setMapDesignType?: (design: AzureMapsMapDesignType) => void } | null;
    controller?.setMapDesignType?.(value);
  }

  override moveCameraTo(position: GeoPoint, durationMillis?: number): void;
  override moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  override moveCameraTo(positionOrCamera: GeoPoint | MapCameraPosition, durationMillis?: number): void {
    const next = 'zoom' in positionOrCamera
      ? this.resolveCameraPosition(positionOrCamera as MapCameraPosition)
      : this._cameraPosition.copy({ position: positionOrCamera as GeoPoint });

    const ctrl = this._controller;
    if (!ctrl) {
      this._cameraPosition = next;
      return;
    }
    if (!durationMillis || durationMillis === 0) {
      void ctrl.moveCamera(next);
    } else {
      void ctrl.animateCamera(next, { duration: durationMillis });
    }
    this._cameraPosition = next;
    this._cameraPositionChangeListener?.(next);
  }

  override getMapViewHolder(): MapViewHolder<unknown, unknown> | null {
    return this._controller?.holder ?? null;
  }

  override fitBounds(bounds: GeoRectBounds, padding: number = 0): void {
    void this._controller?.fitBounds(bounds, { padding });
  }

  setController(ctrl: MapViewControllerInterface | null): void {
    this._controller = ctrl;
    if (ctrl) void ctrl.moveCamera(this._cameraPosition);
  }

  updateCameraPosition(camera: MapCameraPosition): void {
    this._cameraPosition = camera;
    this._cameraPositionChangeListener?.(camera);
  }

  setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void {
    this._cameraPositionChangeListener = listener;
  }

  // If zoom/bearing/tilt are all 0, treat as a position-only update (matches Android/iOS).
  private resolveCameraPosition(target: MapCameraPosition): MapCameraPosition {
    const isUnspecified = target.zoom === 0 && target.bearing === 0 && target.tilt === 0;
    if (isUnspecified) return this._cameraPosition.copy({ position: target.position });
    return target;
  }
}

export function useAzureMapsViewState(params: AzureMapsViewStateParams = {}): AzureMapsViewState {
  const [state] = useState(() => new AzureMapsViewState(params));
  return state;
}
