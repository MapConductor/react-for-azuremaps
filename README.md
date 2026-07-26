English | [日本語](https://github.com/MapConductor/react-for-azuremaps/README.ja.md) | [Español (Latinoamérica)](https://github.com/MapConductor/react-for-azuremaps/README.es-419.md)

# @mapconductor/react-for-azuremaps

Azure Maps provider for the [MapConductor](https://github.com/MapConductor) React SDK.
Wraps the [Azure Maps Web SDK](https://www.npmjs.com/package/azure-maps-control)
(`atlas`) behind MapConductor's provider-agnostic map API, so the same
MapConductor components (markers, circles, polylines, polygons, ground images,
raster layers, info bubbles, camera sync) render on Azure Maps.

## Installation

```shell
npm install @mapconductor/react-for-azuremaps
```

`@mapconductor/js-sdk-core` and `@mapconductor/js-sdk-react` (used for markers and
other shared components) are installed automatically as dependencies. Your
code imports from both directly, so with pnpm's strict (isolated)
`node_modules` — or whenever you prefer to declare everything you import —
install them explicitly instead:

```shell
npm install @mapconductor/react-for-azuremaps @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

The Azure Maps Web SDK (`azure-maps-control`) is bundled as a dependency. You
need an Azure Maps subscription key from the
[Azure portal](https://portal.azure.com/).

![](https://raw.githubusercontent.com/mapconductor/react-for-azuremaps/docs/images/hello-map.jpg)

## Hello Map tutorial

The simplest possible map app, built with MapConductor + Azure Maps: click the
marker and a "Hello, MapConductor" bubble pops up. You can build it in the 5
steps below. Azure Maps requires a subscription key, so add one before you run
the app.

### Step 1: Create a React project

Create a React + TypeScript project with Vite.

```shell
npm create vite@latest hello-map -- --template react-ts
cd hello-map
npm install
npm run dev
```

### Step 2: Install MapConductor (Azure Maps)

Install the package needed to show a map. We use Azure Maps here, but you can
use other map modules too.

```shell
npm install @mapconductor/react-for-azuremaps
```

- `@mapconductor/react-for-azuremaps` — components / hooks for Azure Maps
- `@mapconductor/js-sdk-react` / `@mapconductor/js-sdk-core` are installed
  automatically as dependencies.
- An Azure Maps subscription key is required. Set it as an environment
  variable, e.g. `VITE_AZURE_MAPS_SUBSCRIPTION_KEY` in a Vite `.env` file.

### Step 3: Show the map

Create the map state with `useAzureMapsViewState` and render it with
`<AzureMapsMapView>`. Don't forget the style CSS import. Give the outer element a
height to make it full-screen.

```tsx
import {
  AzureMapsDesign,
  AzureMapsMapView,
  useAzureMapsViewState,
} from '@mapconductor/react-for-azuremaps';
import '@mapconductor/react-for-azuremaps/style.css';
import { createGeoPoint, createMapCameraPosition } from '@mapconductor/js-sdk-core';

const TOKYO = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });
const INITIAL_CAMERA = createMapCameraPosition({ position: TOKYO, zoom: 14 });

export default function App() {
  const mapViewState = useAzureMapsViewState({
    subscriptionKey: import.meta.env.VITE_AZURE_MAPS_SUBSCRIPTION_KEY,
    mapDesignType: AzureMapsDesign.Road,
    cameraPosition: INITIAL_CAMERA,
  });

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AzureMapsMapView state={mapViewState} />
    </div>
  );
}
```

### Step 4: Place a marker

Create the marker state with `createMarkerState` and register it with
`<Marker>`. Write overlays as **child elements** of the map component.

```tsx
import { useMemo } from 'react';
import { createMarkerState } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';

// ...inside App...
const marker = useMemo(
  () => createMarkerState({ id: 'hello', position: TOKYO }),
  [],
);

// ...inside return...
<AzureMapsMapView state={mapViewState}>
  <Marker state={marker} />
</AzureMapsMapView>
```

### Step 5: Show an InfoBubble on click

Track the selected state with `useState`, set it to true in the marker's
`onClick`, and render `<InfoBubble>` only while selected. This is the finished
app.

```tsx
import { useMemo, useState } from 'react';
import {
  AzureMapsDesign,
  AzureMapsMapView,
  useAzureMapsViewState,
} from '@mapconductor/react-for-azuremaps';
import '@mapconductor/react-for-azuremaps/style.css';
import {
  createGeoPoint,
  createMapCameraPosition,
  createMarkerState,
} from '@mapconductor/js-sdk-core';
import { InfoBubble, Marker } from '@mapconductor/js-sdk-react';

const TOKYO = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });
const INITIAL_CAMERA = createMapCameraPosition({ position: TOKYO, zoom: 14 });

export default function App() {
  const mapViewState = useAzureMapsViewState({
    subscriptionKey: import.meta.env.VITE_AZURE_MAPS_SUBSCRIPTION_KEY,
    mapDesignType: AzureMapsDesign.Road,
    cameraPosition: INITIAL_CAMERA,
  });

  const [selected, setSelected] = useState(false);

  const marker = useMemo(
    () => createMarkerState({
      id: 'hello',
      position: TOKYO,
      onClick: () => setSelected(true),
    }),
    [],
  );

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AzureMapsMapView state={mapViewState} onMapClick={() => setSelected(false)}>
        <Marker state={marker} />
        {selected && (
          <InfoBubble marker={marker}>
            <div style={{ padding: '8px 12px', fontWeight: 600 }}>
              Hello, MapConductor
            </div>
          </InfoBubble>
        )}
      </AzureMapsMapView>
    </div>
  );
}
```

### Key points

- Coordinates, cameras and markers are created with `js-sdk-core` functions
  (**provider-independent**).
- The map component and hooks come from `react-for-azuremaps`
  (**provider-specific**).
- Write overlays as **child elements** of the map component.
- Control show / hide with React `useState`.

## Camera / zoom alignment

Azure Maps' Web SDK renders with 512px tiles, so its reported zoom is one level
lower than 256px-tile providers such as Google Maps. This package carries that
offset (`GoogleZoom ≈ AzureZoom + 1`) in its `ZoomAltitudeConverter`, so a
MapConductor camera stays aligned with the project-wide Google Maps reference.

## Related packages

- [`@mapconductor/js-sdk-core`](https://github.com/mapconductor/js-sdk-core) — geometry, camera, and state primitives
- [`@mapconductor/js-sdk-react`](https://github.com/mapconductor/js-sdk-react) — shared `Marker`, `Markers`, shapes, and info bubbles

## License

Apache-2.0
