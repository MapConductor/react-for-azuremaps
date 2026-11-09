import {
  DefaultMarkerEventController,
  type GlMarkerDragMap,
  type MarkerEventHost,
} from '@mapconductor/js-sdk-core';
import type * as atlas from 'azure-maps-control';
import { MARKER_SYMBOL_LAYER_ID } from '../helpers';
import type { AzureMapsMarkerController } from './AzureMapsMarkerController';

/**
 * Azure Maps のマーカーイベント。
 *
 * ドラッグの状態遷移（しきい値・タップとドラッグの区別・離した後の click の抑止・
 * パン抑止と復元）はすべてコアの {@link DefaultMarkerEventController} が持つ。
 * GL 系プロバイダ（maplibre / mapbox / maptiler / tomtom / longdo / mappls）と deck.gl も
 * 同じものを使う。ここに残るのは **Azure 固有のもの**——`atlas.Map` を
 * {@link GlMarkerDragMap} の面に合わせる橋渡しだけ。
 *
 * 移行前は `AzureMapsMarkerController.setupDragHandling` が `map.events` の
 * mousedown / mousemove / mouseup からドラッグを合成していた。しきい値が無く
 * （1 px の揺れでもドラッグになる）、離した後のブラウザの click が地図に届いて
 * 下のオーバーレイをクリックしていた。
 */
export class AzureMapsMarkerEventController extends DefaultMarkerEventController<atlas.Shape> {
  constructor(controller: AzureMapsMarkerController, map: atlas.Map) {
    super(markerEventHost(controller, map));
  }
}

/** `atlas.Map` を、コアのドラッグ処理が要る面（maplibre-gl の `Map` の一部）として見せる。 */
function dragMapOf(map: atlas.Map): GlMarkerDragMap {
  return {
    getCanvas: () => map.getCanvas(),
    getZoom: () => map.getCamera().zoom ?? 0,
    getLayer: (id: string) => map.layers.getLayerById(id) ?? undefined,
    dragPan: {
      isEnabled: () => map.getUserInteraction().dragPanInteraction !== false,
      enable: () => map.setUserInteraction({ dragPanInteraction: true }),
      disable: () => map.setUserInteraction({ dragPanInteraction: false }),
    },
  };
}

/**
 * マーカーコントローラを {@link MarkerEventHost} として見せる。
 *
 * コントローラの `renderer.holder.map` は `atlas.Map` で、コアが要る面と違うので、
 * 地図の部分だけ差し替えた窓口を作る。それ以外（リスナー、選択、配送、
 * `mapTapDispatcher`）はコントローラへそのまま流す。
 */
function markerEventHost(
  controller: AzureMapsMarkerController,
  map: atlas.Map,
): MarkerEventHost<atlas.Shape> {
  const dragMap = dragMapOf(map);
  const holder = controller.renderer.holder;
  return {
    get clickListener() { return controller.clickListener; },
    set clickListener(listener) { controller.clickListener = listener; },
    get dragStartListener() { return controller.dragStartListener; },
    set dragStartListener(listener) { controller.dragStartListener = listener; },
    get dragListener() { return controller.dragListener; },
    set dragListener(listener) { controller.dragListener = listener; },
    get dragEndListener() { return controller.dragEndListener; },
    set dragEndListener(listener) { controller.dragEndListener = listener; },
    get animateStartListener() { return controller.animateStartListener; },
    set animateStartListener(listener) { controller.animateStartListener = listener; },
    get animateEndListener() { return controller.animateEndListener; },
    set animateEndListener(listener) { controller.animateEndListener = listener; },
    // 地図に登録されたとき（registerOverlayController）に設定される。都度読む。
    get mapTapDispatcher() { return controller.mapTapDispatcher; },

    findWithZoom: (position, zoom, pointerType) =>
      position == null ? null : controller.findWithZoom(position, zoom, pointerType),
    hasDraggableMarker: () => controller.hasDraggableMarker(),
    getSelectedMarker: () => controller.getSelectedMarker(),
    setSelectedMarker: (entity) => controller.setSelectedMarker(entity),
    updateSelectedPosition: (position) => controller.updateSelectedPosition(position),

    dispatchClick: (state) => controller.dispatchClick(state),
    dispatchDragStart: (state) => controller.dispatchDragStart(state),
    dispatchDrag: (state) => controller.dispatchDrag(state),
    dispatchDragEnd: (state) => controller.dispatchDragEnd(state),

    renderer: {
      holder: {
        map: dragMap,
        fromScreenOffsetSync: (offset) => holder.fromScreenOffsetSync(offset),
      },
      markerLayer: { layerId: MARKER_SYMBOL_LAYER_ID },
    },
  };
}
