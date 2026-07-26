[English](https://github.com/MapConductor/react-for-azuremaps/blob/main/README.md) | 日本語 | [Español (Latinoamérica)](https://github.com/MapConductor/react-for-azuremaps/blob/main/README.es-419.md)

# @mapconductor/react-for-azuremaps

MapConductor React SDK の Azure Maps プロバイダです。[Azure Maps Web SDK](https://www.npmjs.com/package/azure-maps-control)(`atlas`)を MapConductor のプロバイダ非依存な地図 API でラップするため、同じ MapConductor のコンポーネント(マーカー・円・ポリライン・ポリゴン・地表画像・ラスターレイヤー・インフォバブル・カメラ同期)が Azure Maps 上で描画されます。

## インストール

```shell
npm install @mapconductor/react-for-azuremaps
```

`@mapconductor/js-sdk-core` と `@mapconductor/js-sdk-react`(マーカーなどの共有コンポーネントで使用)は依存関係として自動的にインストールされます。ただしアプリケーションコードはこの2つから直接 import するため、pnpm の strict(isolated)な `node_modules` を使う場合や、import するものをすべて明示的に宣言したい場合は、次のように明示的にインストールしてください:

```shell
npm install @mapconductor/react-for-azuremaps @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

Azure Maps Web SDK(`azure-maps-control`)は依存関係として同梱されています。[Azure ポータル](https://portal.azure.com/)で取得した Azure Maps のサブスクリプションキーが必要です。

![](https://raw.githubusercontent.com/mapconductor/react-for-azuremaps/docs/images/hello-map.jpg)

## Hello Map チュートリアル

MapConductor + Azure Maps で作る、いちばん簡単な地図アプリです。マーカーをクリックすると「Hello, MapConductor」の吹き出しが出ます。この地図は、次の 5 ステップで作れます。Azure Maps はサブスクリプションキーが必要なので、実行前に設定してください。

### ステップ 1: React プロジェクトを作る

Vite で React + TypeScript のプロジェクトを作成します。

```shell
npm create vite@latest hello-map -- --template react-ts
cd hello-map
npm install
npm run dev
```

### ステップ 2: MapConductor（Azure Maps）をインストール

地図表示に必要なパッケージを入れます。ここでは Azure Maps を使いますが、他の地図モジュールを使うこともできます。

```shell
npm install @mapconductor/react-for-azuremaps
```

- `@mapconductor/react-for-azuremaps` — Azure Maps 用のコンポーネント/フック
- `@mapconductor/js-sdk-react` / `@mapconductor/js-sdk-core` は依存関係として自動的にインストールされます。
- Azure Maps のサブスクリプションキーが必要です。Vite の `.env` ファイルなどに環境変数(例: `VITE_AZURE_MAPS_SUBSCRIPTION_KEY`)として設定してください。

### ステップ 3: 地図を表示する

`useAzureMapsViewState` で地図の状態を作り、`<AzureMapsMapView>` で描画します。スタイル用の CSS import を忘れずに。外側の要素に高さを与えると全画面になります。

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

### ステップ 4: マーカーを置く

`createMarkerState` でマーカーの状態を作り、`<Marker>` で登録します。オーバーレイは地図コンポーネントの**子要素**として書きます。

```tsx
import { useMemo } from 'react';
import { createMarkerState } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';

// ...App の中...
const marker = useMemo(
  () => createMarkerState({ id: 'hello', position: TOKYO }),
  [],
);

// ...return の中...
<AzureMapsMapView state={mapViewState}>
  <Marker state={marker} />
</AzureMapsMapView>
```

### ステップ 5: クリックで InfoBubble を表示する

選択中かどうかを `useState` で持ち、マーカーの `onClick` で true にします。選択中のときだけ `<InfoBubble>` を描画します。これが完成形です。

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

### ポイント

- 座標・カメラ・マーカーは `js-sdk-core` の関数で作る（**プロバイダー非依存**）
- 地図コンポーネントとフックは `react-for-azuremaps` から来る（**プロバイダー固有**）
- オーバーレイは地図コンポーネントの**子要素**として書く
- 表示・非表示は React の `useState` で制御する

## カメラ / ズームの整合

Azure Maps の Web SDK は 512px タイルで描画するため、報告されるズームは Google Maps のような 256px タイルのプロバイダより 1 レベル低くなります。本パッケージは `ZoomAltitudeConverter` でこのオフセット(`GoogleZoom ≈ AzureZoom + 1`)を吸収するため、MapConductor のカメラはプロジェクト全体の基準である Google Maps と整合したままになります。

## 関連パッケージ

- [`@mapconductor/js-sdk-core`](https://github.com/mapconductor/js-sdk-core) — ジオメトリ・カメラ・状態のプリミティブ
- [`@mapconductor/js-sdk-react`](https://github.com/mapconductor/js-sdk-react) — 共有の `Marker`・`Markers`・シェイプ・インフォバブル

## ライセンス

Apache-2.0
