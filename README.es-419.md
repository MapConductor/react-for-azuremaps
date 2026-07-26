[English](https://github.com/MapConductor/react-for-azuremaps/blob/main/README.md) | [日本語](https://github.com/MapConductor/react-for-azuremaps/blob/main/README.ja.md) | Español (Latinoamérica)

# @mapconductor/react-for-azuremaps

Proveedor de Azure Maps para el SDK de React de [MapConductor](https://github.com/MapConductor). Envuelve el [Azure Maps Web SDK](https://www.npmjs.com/package/azure-maps-control) (`atlas`) detrás de la API de mapas independiente del proveedor de MapConductor, de modo que los mismos componentes de MapConductor (marcadores, círculos, polilíneas, polígonos, imágenes sobre el terreno, capas ráster, burbujas de información, sincronización de cámara) se renderizan en Azure Maps.

## Instalación

```shell
npm install @mapconductor/react-for-azuremaps
```

`@mapconductor/js-sdk-core` y `@mapconductor/js-sdk-react` (usados para marcadores y otros componentes compartidos) se instalan automáticamente como dependencias. Tu código importa directamente de ambos, así que con el `node_modules` estricto (aislado) de pnpm — o siempre que prefieras declarar todo lo que importas — instálalos explícitamente:

```shell
npm install @mapconductor/react-for-azuremaps @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

El Azure Maps Web SDK (`azure-maps-control`) viene incluido como dependencia. Necesitas una clave de suscripción de Azure Maps del [portal de Azure](https://portal.azure.com/).

![](https://raw.githubusercontent.com/mapconductor/react-for-azuremaps/docs/images/hello-map.jpg)

## Tutorial Hello Map

La aplicación de mapa más sencilla posible, creada con MapConductor + Azure Maps: haz clic en el marcador y aparecerá un globo "Hello, MapConductor". Puedes crear este mapa en los 5 pasos siguientes. Azure Maps requiere una clave de suscripción, así que agrégala antes de ejecutar la app.

### Paso 1: Crea un proyecto React

Crea un proyecto React + TypeScript con Vite.

```shell
npm create vite@latest hello-map -- --template react-ts
cd hello-map
npm install
npm run dev
```

### Paso 2: Instala MapConductor (Azure Maps)

Instala el paquete necesario para mostrar un mapa. Aquí usamos Azure Maps, pero también puedes usar otros módulos de mapas.

```shell
npm install @mapconductor/react-for-azuremaps
```

- `@mapconductor/react-for-azuremaps` — componentes / hooks para Azure Maps
- `@mapconductor/js-sdk-react` / `@mapconductor/js-sdk-core` se instalan
  automáticamente como dependencias.
- Se requiere una clave de suscripción de Azure Maps. Configúrala como una variable de entorno, por ejemplo `VITE_AZURE_MAPS_SUBSCRIPTION_KEY` en un archivo `.env` de Vite.

### Paso 3: Muestra el mapa

Crea el estado del mapa con `useAzureMapsViewState` y renderízalo con `<AzureMapsMapView>`. No olvides el import del CSS de estilos. Da una altura al elemento externo para que ocupe toda la pantalla.

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

### Paso 4: Coloca un marcador

Crea el estado del marcador con `createMarkerState` y regístralo con `<Marker>`. Escribe las superposiciones como **elementos hijos** del componente del mapa.

```tsx
import { useMemo } from 'react';
import { createMarkerState } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';

// ...dentro de App...
const marker = useMemo(
  () => createMarkerState({ id: 'hello', position: TOKYO }),
  [],
);

// ...dentro de return...
<AzureMapsMapView state={mapViewState}>
  <Marker state={marker} />
</AzureMapsMapView>
```

### Paso 5: Muestra un InfoBubble al hacer clic

Guarda el estado de selección con `useState`, ponlo en true en el `onClick` del marcador y renderiza `<InfoBubble>` solo mientras está seleccionado. Este es el resultado final.

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

### Puntos clave

- Las coordenadas, cámaras y marcadores se crean con funciones de `js-sdk-core`
  (**independiente del proveedor**).
- El componente del mapa y los hooks vienen de `react-for-azuremaps`
  (**específico del proveedor**).
- Escribe las superposiciones como **elementos hijos** del componente del mapa.
- Controla mostrar / ocultar con `useState` de React.

## Alineación de cámara / zoom

El Web SDK de Azure Maps renderiza con teselas de 512px, por lo que el zoom que reporta es un nivel más bajo que el de proveedores con teselas de 256px como Google Maps. Este paquete incorpora ese desfase (`GoogleZoom ≈ AzureZoom + 1`) en su `ZoomAltitudeConverter`, de modo que una cámara de MapConductor permanece alineada con la referencia de Google Maps de todo el proyecto.

## Paquetes relacionados

- [`@mapconductor/js-sdk-core`](https://github.com/mapconductor/js-sdk-core) — primitivas de geometría, cámara y estado
- [`@mapconductor/js-sdk-react`](https://github.com/mapconductor/js-sdk-react) — `Marker`, `Markers`, formas y burbujas de información compartidos

## Licencia

Apache-2.0
