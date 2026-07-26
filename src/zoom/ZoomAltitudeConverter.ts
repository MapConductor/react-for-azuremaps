import { AbstractZoomAltitudeConverter } from '@mapconductor/js-sdk-core';

/**
 * Web port of the Google-aligned zoom/altitude converter for Azure Maps.
 *
 * Azure Maps' Web SDK (like Mapbox GL) renders with 512px tiles, so at the same
 * on-screen scale its reported zoom is one level lower than 256px-tile providers
 * such as Google Maps. `getCamera().zoom` therefore satisfies
 * `GoogleZoom ≈ AzureZoom + 1`. This converter carries that offset so a
 * MapConductor (Google-referenced) camera renders at the matching scale on Azure
 * and the reported camera converts back to the Google zoom.
 */
export class ZoomAltitudeConverter extends AbstractZoomAltitudeConverter {
  /** Empirical offset: GoogleZoom ≈ AzureMaps.zoom + 1.0 */
  static readonly AZURE_TO_GOOGLE_ZOOM_OFFSET = 1.0;

  static azureZoomToGoogleZoom(azureZoom: number): number {
    const google = azureZoom + ZoomAltitudeConverter.AZURE_TO_GOOGLE_ZOOM_OFFSET;
    return Math.min(Math.max(google, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL), AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL);
  }

  static googleZoomToAzureZoom(googleZoom: number): number {
    const azure = googleZoom - ZoomAltitudeConverter.AZURE_TO_GOOGLE_ZOOM_OFFSET;
    return Math.min(Math.max(azure, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL), AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL);
  }

  private cosLatitudeFactor(latitude: number): number {
    const clamped = Math.max(-85, Math.min(85, latitude));
    const latRad = (clamped * Math.PI) / 180;
    return Math.max(AbstractZoomAltitudeConverter.MIN_COS_LAT, Math.abs(Math.cos(latRad)));
  }

  private cosTiltFactor(tilt: number): number {
    const clamped = Math.max(0, Math.min(90, tilt));
    const tiltRad = (clamped * Math.PI) / 180;
    return Math.max(AbstractZoomAltitudeConverter.MIN_COS_TILT, Math.cos(tiltRad));
  }

  zoomLevelToAltitude({
    zoomLevel,
    latitude,
    tilt,
  }: {
    zoomLevel: number;
    latitude: number;
    tilt: number;
  }): number {
    const googleZoom = ZoomAltitudeConverter.azureZoomToGoogleZoom(zoomLevel);
    const cosLat = this.cosLatitudeFactor(latitude);
    const cosTilt = this.cosTiltFactor(tilt);
    const distance = (this.zoom0Altitude * cosLat) / Math.pow(AbstractZoomAltitudeConverter.ZOOM_FACTOR, googleZoom);
    const altitude = distance * cosTilt;
    return Math.min(Math.max(altitude, AbstractZoomAltitudeConverter.MIN_ALTITUDE), AbstractZoomAltitudeConverter.MAX_ALTITUDE);
  }

  altitudeToZoomLevel({
    altitude,
    latitude,
    tilt,
  }: {
    altitude: number;
    latitude: number;
    tilt: number;
  }): number {
    const clampedAltitude = Math.min(Math.max(altitude, AbstractZoomAltitudeConverter.MIN_ALTITUDE), AbstractZoomAltitudeConverter.MAX_ALTITUDE);
    const cosLat = this.cosLatitudeFactor(latitude);
    const cosTilt = this.cosTiltFactor(tilt);
    const distance = clampedAltitude / cosTilt;
    const googleZoom = Math.log2((this.zoom0Altitude * cosLat) / distance);
    return ZoomAltitudeConverter.googleZoomToAzureZoom(googleZoom);
  }
}
