/**
 * Parser utilities for Elgato Key Light extension.
 *
 * This module handles parsing and validation of light configuration data.
 * It is pure JavaScript with no GI dependencies, making it testable
 * in a standard Node.js environment.
 */

/**
 * Validates a light configuration object.
 *
 * @param {Object} light - Light configuration to validate
 * @param {string} light.name - Display name of the light
 * @param {string} light.host - IP address or hostname
 * @param {number} light.port - Port number
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidLightConfig(light) {
  if (!light || typeof light !== "object") {
    return false;
  }

  if (typeof light.name !== "string" || light.name.length === 0) {
    return false;
  }

  if (typeof light.host !== "string" || light.host.length === 0) {
    return false;
  }

  if (typeof light.port !== "number" || light.port < 1 || light.port > 65535) {
    return false;
  }

  return true;
}

/**
 * Parses a JSON string of cached lights.
 *
 * @param {string} json - JSON string containing array of light configs
 * @returns {Array<{name: string, host: string, port: number}>} Valid light configs
 */
export function parseCachedLights(json) {
  if (!json || typeof json !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidLightConfig);
  } catch {
    return [];
  }
}
