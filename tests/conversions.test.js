/**
 * Unit tests for conversion utilities.
 */

import { describe, it, expect } from 'vitest';
import { Temperature, Brightness } from '../lib/conversions.js';

describe('Temperature', () => {
  describe('apiToKelvin', () => {
    it('converts minimum API value (143) to maximum Kelvin (7000K)', () => {
      expect(Temperature.apiToKelvin(143)).toBe(7000);
    });

    it('converts maximum API value (344) to minimum Kelvin (2900K)', () => {
      expect(Temperature.apiToKelvin(344)).toBe(2900);
    });

    it('converts middle API value to approximately middle Kelvin', () => {
      const middleApi = Math.round((143 + 344) / 2);
      const result = Temperature.apiToKelvin(middleApi);
      // Should be around 4950K (middle of 2900-7000)
      expect(result).toBeGreaterThan(4800);
      expect(result).toBeLessThan(5100);
    });
  });

  describe('kelvinToApi', () => {
    it('converts 7000K to API value 143', () => {
      expect(Temperature.kelvinToApi(7000)).toBe(143);
    });

    it('converts 2900K to API value 344', () => {
      expect(Temperature.kelvinToApi(2900)).toBe(344);
    });

    it('is inverse of apiToKelvin', () => {
      const testValues = [143, 200, 250, 300, 344];
      for (const api of testValues) {
        const kelvin = Temperature.apiToKelvin(api);
        const backToApi = Temperature.kelvinToApi(kelvin);
        // Allow for rounding differences
        expect(Math.abs(backToApi - api)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('apiToSlider', () => {
    it('converts minimum API (143) to slider 0.0', () => {
      expect(Temperature.apiToSlider(143)).toBeCloseTo(0.0, 5);
    });

    it('converts maximum API (344) to slider 1.0', () => {
      expect(Temperature.apiToSlider(344)).toBeCloseTo(1.0, 5);
    });

    it('converts middle API to slider 0.5', () => {
      const middleApi = (143 + 344) / 2;
      expect(Temperature.apiToSlider(middleApi)).toBeCloseTo(0.5, 5);
    });
  });

  describe('sliderToApi', () => {
    it('converts slider 0.0 to minimum API (143)', () => {
      expect(Temperature.sliderToApi(0.0)).toBe(143);
    });

    it('converts slider 1.0 to maximum API (344)', () => {
      expect(Temperature.sliderToApi(1.0)).toBe(344);
    });

    it('is inverse of apiToSlider', () => {
      const testValues = [0.0, 0.25, 0.5, 0.75, 1.0];
      for (const slider of testValues) {
        const api = Temperature.sliderToApi(slider);
        const backToSlider = Temperature.apiToSlider(api);
        // Allow for rounding differences
        expect(backToSlider).toBeCloseTo(slider, 2);
      }
    });
  });
});

describe('Brightness', () => {
  describe('toSlider', () => {
    it('converts minimum brightness (3) to slider 0.0', () => {
      expect(Brightness.toSlider(3)).toBeCloseTo(0.0, 5);
    });

    it('converts maximum brightness (100) to slider 1.0', () => {
      expect(Brightness.toSlider(100)).toBeCloseTo(1.0, 5);
    });

    it('converts 50% brightness to approximately 0.485 slider', () => {
      // (50 - 3) / (100 - 3) = 47/97 ≈ 0.485
      const result = Brightness.toSlider(50);
      expect(result).toBeCloseTo(0.485, 2);
    });
  });

  describe('fromSlider', () => {
    it('converts slider 0.0 to minimum brightness (3)', () => {
      expect(Brightness.fromSlider(0.0)).toBe(3);
    });

    it('converts slider 1.0 to maximum brightness (100)', () => {
      expect(Brightness.fromSlider(1.0)).toBe(100);
    });

    it('is inverse of toSlider', () => {
      const testValues = [3, 25, 50, 75, 100];
      for (const brightness of testValues) {
        const slider = Brightness.toSlider(brightness);
        const backToBrightness = Brightness.fromSlider(slider);
        expect(backToBrightness).toBe(brightness);
      }
    });
  });

  describe('edge cases', () => {
    it('handles values at boundaries', () => {
      expect(Brightness.fromSlider(0)).toBe(3);
      expect(Brightness.fromSlider(1)).toBe(100);
    });

    it('rounds correctly for fractional slider values', () => {
      const result = Brightness.fromSlider(0.5);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(3);
      expect(result).toBeLessThanOrEqual(100);
    });
  });
});
