import { AbstractZoomAltitudeConverter, WebMercatorZoomAltitudeConverter } from '@mapconductor/js-sdk-core';

/**
 * 統一ズーム（Google Maps 基準・256px タイル）⇄ 高度の変換。
 *
 * Azure Maps の Web SDK は（Mapbox GL と同じく）512px タイルで描くので、
 * 同じ見た目の縮尺でも報告されるズームが 1 段低い。つまり
 * `GoogleZoom ≈ AzureZoom + 1`。
 * 換算式はコアの {@link WebMercatorZoomAltitudeConverter} にある。
 */
export class ZoomAltitudeConverter extends WebMercatorZoomAltitudeConverter {
    /** Empirical offset: GoogleZoom ≈ AzureMaps.zoom + 1.0 */
    static readonly AZURE_TO_GOOGLE_ZOOM_OFFSET = 1.0;

    constructor(zoom0Altitude: number = AbstractZoomAltitudeConverter.DEFAULT_ZOOM0_ALTITUDE) {
        super(zoom0Altitude, ZoomAltitudeConverter.AZURE_TO_GOOGLE_ZOOM_OFFSET);
    }

    static azureZoomToGoogleZoom(azureZoom: number): number {
        const google = azureZoom + ZoomAltitudeConverter.AZURE_TO_GOOGLE_ZOOM_OFFSET;
        return Math.min(Math.max(google, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL), AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL);
    }

    static googleZoomToAzureZoom(googleZoom: number): number {
        // MIN/MAX_ZOOM_LEVEL は Google 系のズーム値。オフセットを引いた *あと* に
        // 当てると、Google 系の 0 がプロバイダ系の 0 へ潰れて戻ってこない
        // （読み戻しは +1 されるので 0 を指定したはずが 1 になる）。丸めるのは
        // 変換の前、値がまだ Google 系でいるあいだ。逆方向は変換してから丸めており、
        // そちらは元から Google 系どうしで正しい。
        const clamped = Math.min(
            Math.max(googleZoom, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL),
            AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL,
        );
        return clamped - ZoomAltitudeConverter.AZURE_TO_GOOGLE_ZOOM_OFFSET;
    }
}
