import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';

import {
    BaseMapViewController,
    createGeoPoint,
    createMarkerEntity,
    createMarkerState,
} from '@mapconductor/js-sdk-core';

/**
 * A press on a draggable marker behaves as on the other providers (the GL ones
 * through js-sdk-core's DefaultMarkerEventController, and Android):
 *  - released without moving past the drag threshold, it is a tap: a clickable
 *    marker gets onClick once; one with `clickable: false` passes the tap to
 *    what is under it (the circle under a vertex handle), once;
 *  - moved past the threshold, it is a drag: dragStart / drag / dragEnd, and no
 *    click anywhere — not on the circle the pointer is released over either.
 *
 * Azure synthesized the drag from `map.events` mouse events with no threshold,
 * so any mousemove (a 1 px jitter) turned a tap into a drag, and the browser's
 * click that follows the release reached the map and clicked the circle.
 */

// Azure Maps needs a browser to load; the controller only touches `atlas` to
// register the tile protocol, which these tests never reach.
const outDir = (() => {
    mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
    return mkdtempSync(fileURLToPath(new URL('../build/marker-drag-tap-tests-', import.meta.url)));
})();
after(() => rmSync(outDir, { recursive: true, force: true }));
const atlasStub = resolve(outDir, 'atlas-stub.mjs');
writeFileSync(atlasStub, 'export function addProtocol() {}\n');
await build({
    entry: { controller: 'src/marker/AzureMapsMarkerController.ts' },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
    external: ['@mapconductor/js-sdk-core'],
    noExternal: ['azure-maps-control'],
    esbuildPlugins: [{
        name: 'atlas-stub',
        setup(b) {
            b.onResolve({ filter: /^azure-maps-control$/ }, () => ({ path: atlasStub }));
        },
    }],
});
const { AzureMapsMarkerController } = await import(pathToFileURL(resolve(outDir, 'controller.mjs')));

/** Just enough of EventTarget: listeners per type, capture flag kept. */
class FakeTarget {
    constructor() { this.listeners = []; }
    addEventListener(type, fn, options) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        this.listeners.push({ type, fn, capture });
    }
    removeEventListener(type, fn, options) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
        if (i >= 0) this.listeners.splice(i, 1);
    }
    /** Calls the listeners for `type`; returns false if one stopped propagation. */
    fire(type, event) {
        for (const l of this.listeners.filter((x) => x.type === type)) {
            l.fn(event);
            if (event.stopped) return false;
        }
        return true;
    }
}

function domEvent(fields) {
    return {
        isPrimary: true,
        button: 0,
        pointerType: 'mouse',
        defaultPrevented: false,
        stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; },
        ...fields,
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Screen x/y map 1:1 to longitude/latitude. The marker sits at (50, 50); its pin is drawn above that, so presses land at (50, 40). */
const geo = (x, y) => createGeoPoint({ latitude: y, longitude: x });

/** The parts of `atlas.Map` the marker controller uses. */
function makeAtlasMap() {
    const win = new FakeTarget();
    const canvas = new FakeTarget();
    canvas.ownerDocument = { defaultView: win };
    canvas.captured = new Set();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    canvas.setPointerCapture = (id) => canvas.captured.add(id);
    canvas.hasPointerCapture = (id) => canvas.captured.has(id);
    canvas.releasePointerCapture = (id) => canvas.captured.delete(id);
    const handlers = new Map();
    let interaction = { dragPanInteraction: true };
    const map = {
        getCanvas: () => canvas,
        getCamera: () => ({ zoom: 10 }),
        getUserInteraction: () => ({ ...interaction }),
        setUserInteraction: (options) => { interaction = { ...interaction, ...options }; },
        positionsToPixels: (positions) => positions.map(([lng, lat]) => [lng, lat]),
        pixelsToPositions: (pixels) => pixels.map(([x, y]) => [x, y]),
        layers: { getLayerById: () => ({}) },
        events: {
            add(type, fn) {
                if (!handlers.has(type)) handlers.set(type, []);
                handlers.get(type).push(fn);
            },
            remove(type, fn) {
                const list = handlers.get(type) ?? [];
                const i = list.indexOf(fn);
                if (i >= 0) list.splice(i, 1);
            },
        },
        /** What atlas does on a DOM mouse event: hand a MapMouseEvent to `map.events`. */
        emit(type, x, y) {
            for (const fn of handlers.get(type) ?? []) fn({ position: [x, y], pixel: [x, y], type });
        },
    };
    return { win, canvas, map };
}

/** The renderer surface the controller drives: the holder's projection and the shape position. */
function makeRenderer(map) {
    return {
        holder: {
            map,
            fromScreenOffsetSync: ({ x, y }) => geo(x, y),
            toScreenOffset: (p) => ({ x: p.longitude, y: p.latitude }),
        },
        markerLayer: { layerId: 'mc-marker-symbols-layer' },
        positions: [],
        setMarkerPosition(_entity, position) { this.positions.push(position); },
        async onAdd(data) { return data.map((p) => p.state.id); },
        async onChange(data) { return data.map((p) => p.current.state.id); },
        async onRemove() {},
        async onAnimate() {},
        async onPostProcess() {},
    };
}

/** A circle that covers the whole screen. */
class CircleController {
    constructor(log) { this.kind = 'circle'; this.log = log; }
    hasId() { return false; }
    async compositionAny() {}
    async updateAny() {}
    setClickListenerAny() {}
    async clear() {}
    resolveTap(position) {
        return { kind: 'circle', clicked: position, dispatch: () => this.log.push('circle') };
    }
}

/**
 * AzureMapsViewController's shape: the marker controller and a circle registered
 * with the map, the map's `click` going to `dispatchTap`, and marker taps resolved
 * with `find` (clickable markers only).
 */
class Provider extends BaseMapViewController {
    constructor() {
        super();
        this.log = [];
        const { win, canvas, map } = makeAtlasMap();
        this.win = win;
        this.canvas = canvas;
        this.map = map;
        this.renderer = makeRenderer(map);
        this.markers = new AzureMapsMarkerController(map, this.renderer);
        this.registerOverlayController(this.markers);
        this.registerOverlayController(new CircleController(this.log));
        this.setMapClickListener(() => this.log.push('map'));
    }
    dispatchMarkerTap(point) {
        const entity = this.markers.find(point);
        if (!entity?.state.clickable) return false;
        this.markers.dispatchClick(entity.state);
        return true;
    }
    putMarker({ clickable }) {
        const state = createMarkerState({
            id: 'vertex',
            position: geo(50, 50),
            draggable: true,
            clickable,
            onClick: () => this.log.push('marker'),
            onDragStart: () => this.log.push('dragStart'),
            onDragEnd: () => this.log.push('dragEnd'),
        });
        const entity = createMarkerEntity({ state, marker: { id: 'vertex' } });
        this.markers.markerManager.registerEntity(entity);
        return state;
    }

    /**
     * A press and release the way Chrome delivers it. `pointerdown` and the
     * compatibility mouse event that follows it unless `preventDefault()` was
     * called on the pointerdown; atlas turns the mouse events into
     * `map.events` handlers. After pointerup, in the same task, the `click`:
     * through the window's capture listeners first, then the map
     * (`map.events.add('click')` → `dispatchTap`).
     */
    async gesture(points) {
        const [first, ...rest] = points;
        const down = domEvent({ pointerId: 1, clientX: first.x, clientY: first.y });
        this.win.fire('pointerdown', down);
        this.canvas.fire('pointerdown', down);
        const mouseSuppressed = down.defaultPrevented;
        if (!mouseSuppressed) this.map.emit('mousedown', first.x, first.y);
        for (const p of rest) {
            this.canvas.fire('pointermove', domEvent({ pointerId: 1, clientX: p.x, clientY: p.y }));
            if (!mouseSuppressed) this.map.emit('mousemove', p.x, p.y);
        }
        const last = points[points.length - 1];
        this.canvas.fire('pointerup', domEvent({ pointerId: 1, clientX: last.x, clientY: last.y }));
        if (!mouseSuppressed) this.map.emit('mouseup', last.x, last.y);
        const click = domEvent({ clientX: last.x, clientY: last.y });
        if (this.win.fire('click', click)) this.dispatchTap(geo(last.x, last.y));
        await flush();
        await flush();
    }
}

test('a tap with a 1 px jitter on a non-clickable marker passes through to the circle once', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 40 }, { x: 51, y: 40 }]);
    assert.deepEqual(provider.log, ['circle']);
});

test('a tap with a 1 px jitter on a clickable marker fires onClick once', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: true });
    await provider.gesture([{ x: 50, y: 40 }, { x: 51, y: 40 }]);
    assert.deepEqual(provider.log, ['marker']);
});

test('a tap without moving on a non-clickable marker passes through to the circle once', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 40 }]);
    assert.deepEqual(provider.log, ['circle']);
});

test('a tap without moving on a clickable marker fires onClick once', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: true });
    await provider.gesture([{ x: 50, y: 40 }]);
    assert.deepEqual(provider.log, ['marker']);
});

test('dragging a non-clickable marker and releasing over the circle reports the drag only', async () => {
    const provider = new Provider();
    const state = provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 40 }, { x: 60, y: 40 }, { x: 80, y: 60 }]);
    assert.deepEqual(provider.log, ['dragStart', 'dragEnd']);
    assert.equal(state.position.longitude, 80);
    assert.equal(state.position.latitude, 60);
});

test('dragging a clickable marker reports the drag only', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: true });
    await provider.gesture([{ x: 50, y: 40 }, { x: 60, y: 40 }, { x: 80, y: 60 }]);
    assert.deepEqual(provider.log, ['dragStart', 'dragEnd']);
});

test('the next click on the map after a marker drag still reaches the map', async () => {
    const provider = new Provider();
    provider.putMarker({ clickable: false });
    await provider.gesture([{ x: 50, y: 40 }, { x: 60, y: 40 }, { x: 80, y: 60 }]);
    provider.log.length = 0;
    // A press somewhere without a marker: the map pans as usual, and its click lands.
    provider.markers.markerManager.removeEntity('vertex');
    await provider.gesture([{ x: 10, y: 10 }]);
    assert.deepEqual(provider.log, ['circle']);
});

test('a marker drag leaves the map pan as the app set it', async () => {
    for (const enabled of [true, false]) {
        const provider = new Provider();
        provider.map.setUserInteraction({ dragPanInteraction: enabled });
        provider.putMarker({ clickable: false });
        await provider.gesture([{ x: 50, y: 40 }, { x: 60, y: 40 }, { x: 80, y: 60 }]);
        assert.equal(provider.map.getUserInteraction().dragPanInteraction, enabled);
    }
});
