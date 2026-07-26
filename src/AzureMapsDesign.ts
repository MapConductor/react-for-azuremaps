import type { AttributionRule, MapDesignTypeInterface } from '@mapconductor/js-sdk-core';

/**
 * An Azure Maps design maps a MapConductor design identifier to an Azure Maps
 * base map style name (the `style` option of the `atlas.Map` / `map.setStyle`).
 * Supported style names are listed in the Azure Maps "supported map styles" doc.
 */
export interface AzureMapsMapDesignType extends MapDesignTypeInterface<string> {
  readonly style: string;
}

export class AzureMapsDesign implements AzureMapsMapDesignType {
  readonly id: string;
  readonly style: string;
  readonly attributionRules: readonly AttributionRule[];

  constructor(id: string, style: string, attributionRules: readonly AttributionRule[] = []) {
    this.id = id;
    this.style = style;
    this.attributionRules = attributionRules;
  }

  getValue(): string {
    return this.style;
  }

  static readonly Road = new AzureMapsDesign('road', 'road');
  static readonly RoadShadedRelief = new AzureMapsDesign('road_shaded_relief', 'road_shaded_relief');
  static readonly Blank = new AzureMapsDesign('blank', 'blank');
  static readonly BlankAccessible = new AzureMapsDesign('blank_accessible', 'blank_accessible');
  static readonly Satellite = new AzureMapsDesign('satellite', 'satellite');
  static readonly SatelliteRoadLabels = new AzureMapsDesign('satellite_road_labels', 'satellite_road_labels');
  static readonly GrayscaleDark = new AzureMapsDesign('grayscale_dark', 'grayscale_dark');
  static readonly GrayscaleLight = new AzureMapsDesign('grayscale_light', 'grayscale_light');
  static readonly Night = new AzureMapsDesign('night', 'night');
  static readonly HighContrastDark = new AzureMapsDesign('high_contrast_dark', 'high_contrast_dark');
  static readonly HighContrastLight = new AzureMapsDesign('high_contrast_light', 'high_contrast_light');
}
