import {
  useState } from 'react';
import {
  MapViewState,
  MapCameraPosition as MapCameraPositionNS,
  createRandomId,
  type MapCameraPosition,
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
  readonly subscriptionKey?: string;
  private _mapDesignType: AzureMapsMapDesignType;

  constructor({
    id = createRandomId(),
    subscriptionKey,
    mapDesignType = AzureMapsDesign.Road,
    cameraPosition = MapCameraPositionNS.Default,
  }: AzureMapsViewStateParams = {}) {
    super({ id, cameraPosition });
    this.subscriptionKey = subscriptionKey;
    this._mapDesignType = mapDesignType;
  }

  override get mapDesignType(): AzureMapsMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: AzureMapsMapDesignType) {
    this._mapDesignType = value;
    const controller = this.attachedMapController as { setMapDesignType?: (design: AzureMapsMapDesignType) => void } | null;
    controller?.setMapDesignType?.(value);
  }

  // If zoom/bearing/tilt are all 0, treat as a position-only update (matches Android/iOS).
}

export function useAzureMapsViewState(params: AzureMapsViewStateParams = {}): AzureMapsViewStateInterface {
  const [state] = useState(() => new AzureMapsViewState(params));
  return state;
}
