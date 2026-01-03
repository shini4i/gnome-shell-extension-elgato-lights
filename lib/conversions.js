/**
 * Conversion utilities for Elgato Key Light values.
 *
 * These utilities handle the conversion between API values, Kelvin temperatures,
 * brightness percentages, and slider positions (0.0 - 1.0).
 *
 * This module is pure JavaScript with no GI dependencies, making it testable
 * in a standard Node.js environment.
 */

/**
 * Temperature conversion utilities.
 *
 * The Elgato API uses an inverted scale where:
 * - 143 = 7000K (cool/blue)
 * - 344 = 2900K (warm/yellow)
 */
export const Temperature = {
  MIN_API: 143, // 7000K (cool/blue)
  MAX_API: 344, // 2900K (warm/yellow)
  MIN_K: 2900,
  MAX_K: 7000,

  /**
   * Converts API value to Kelvin.
   *
   * @param {number} api - API value (143-344)
   * @returns {number} Temperature in Kelvin (2900-7000)
   */
  apiToKelvin(api) {
    return Math.round(
      this.MAX_K -
        ((api - this.MIN_API) / (this.MAX_API - this.MIN_API)) *
          (this.MAX_K - this.MIN_K),
    );
  },

  /**
   * Converts Kelvin to API value.
   *
   * @param {number} kelvin - Temperature in Kelvin (2900-7000)
   * @returns {number} API value (143-344)
   */
  kelvinToApi(kelvin) {
    return Math.round(
      this.MAX_API -
        ((kelvin - this.MIN_K) / (this.MAX_K - this.MIN_K)) *
          (this.MAX_API - this.MIN_API),
    );
  },

  /**
   * Converts API value to slider position (0.0 - 1.0).
   *
   * @param {number} api - API value (143-344)
   * @returns {number} Slider position (0.0 - 1.0)
   */
  apiToSlider(api) {
    return (api - this.MIN_API) / (this.MAX_API - this.MIN_API);
  },

  /**
   * Converts slider position to API value.
   *
   * @param {number} slider - Slider position (0.0 - 1.0)
   * @returns {number} API value (143-344)
   */
  sliderToApi(slider) {
    return Math.round(this.MIN_API + slider * (this.MAX_API - this.MIN_API));
  },
};

/**
 * Brightness conversion utilities.
 *
 * Brightness ranges from 3% to 100%.
 */
export const Brightness = {
  MIN: 3,
  MAX: 100,

  /**
   * Converts brightness value to slider position (0.0 - 1.0).
   *
   * @param {number} brightness - Brightness value (3-100)
   * @returns {number} Slider position (0.0 - 1.0)
   */
  toSlider(brightness) {
    return (brightness - this.MIN) / (this.MAX - this.MIN);
  },

  /**
   * Converts slider position to brightness value.
   *
   * @param {number} slider - Slider position (0.0 - 1.0)
   * @returns {number} Brightness value (3-100)
   */
  fromSlider(slider) {
    return Math.round(this.MIN + slider * (this.MAX - this.MIN));
  },
};
