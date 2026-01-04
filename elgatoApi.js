/**
 * Elgato Light API client module.
 *
 * Provides HTTP client functionality for communicating with Elgato Key Light
 * devices via their REST API on port 9123.
 */

import Soup from "gi://Soup?version=3.0";
import GLib from "gi://GLib";

// Re-export conversion utilities from lib (testable without GI dependencies)
export { Temperature, Brightness } from "./lib/conversions.js";

const TIMEOUT_SECONDS = 5;

/**
 * Represents a single Elgato Key Light device.
 *
 * Handles all HTTP communication with the device including fetching state,
 * updating settings, and retrieving device information.
 */
export class ElgatoLight {
  /**
   * Creates a new ElgatoLight instance.
   *
   * @param {string} name - The display name of the light (from mDNS discovery)
   * @param {string} host - The IP address or hostname of the light
   * @param {number} port - The port number (default: 9123)
   */
  constructor(name, host, port = 9123) {
    this.name = name;
    this.host = host;
    this.port = port;
    this._session = new Soup.Session({
      timeout: TIMEOUT_SECONDS,
    });

    // Cached state
    this.on = false;
    this.brightness = 50;
    this.temperature = 200;
    this.displayName = name;

    // Accessory info (populated by fetchInfo)
    this.productName = null;
    this.firmwareVersion = null;
    this.serialNumber = null;
    this.hardwareBoardType = null;
  }

  /**
   * Delays execution for the specified number of milliseconds.
   *
   * @param {number} ms - Delay duration in milliseconds
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise((resolve) => {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  /**
   * Sends an HTTP request with retry logic and linear backoff.
   *
   * Retries on transient errors (5xx status codes and network failures).
   * Uses linear backoff: 1s, 2s, 3s delays between retries.
   *
   * @param {string} method - HTTP method (GET, PUT, etc.)
   * @param {string} url - The URL to send the request to
   * @param {string|null} body - JSON body for PUT requests, null for GET
   * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
   * @returns {Promise<{success: boolean, bytes?: GLib.Bytes, status?: number, error?: Error}>}
   * @private
   */
  async _sendWithRetry(method, url, body = null, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const message = Soup.Message.new(method, url);

        if (body !== null) {
          message.set_request_body_from_bytes(
            "application/json",
            new GLib.Bytes(new TextEncoder().encode(body)),
          );
        }

        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

        const status = message.get_status();

        // Success
        if (status === Soup.Status.OK) {
          return { success: true, bytes, status };
        }

        // Server error (5xx) - retry with backoff
        if (status >= 500 && attempt < maxRetries - 1) {
          const delayMs = 1000 * (attempt + 1);
          console.error(
            `[ElgatoLights] Server error ${status} from ${this.name}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await this._delay(delayMs);
          continue;
        }

        // Non-retryable error (4xx or final 5xx)
        return {
          success: false,
          status,
          error: new Error(`HTTP ${status}`),
        };
      } catch (e) {
        lastError = e;

        // Network error - retry with backoff
        if (attempt < maxRetries - 1) {
          const delayMs = 1000 * (attempt + 1);
          console.error(
            `[ElgatoLights] Network error from ${this.name}: ${e.message}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await this._delay(delayMs);
          continue;
        }
      }
    }

    return {
      success: false,
      error: lastError || new Error("Max retries exceeded"),
    };
  }

  /**
   * Returns the base URL for API requests.
   *
   * @returns {string} The base URL (e.g., "http://192.168.1.100:9123")
   */
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Fetches the current state from the light device.
   *
   * Updates the internal state cache with the current on/off status,
   * brightness, and color temperature values.
   *
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async fetchState() {
    const url = `${this.baseUrl}/elgato/lights`;
    const result = await this._sendWithRetry("GET", url);

    if (!result.success) {
      console.error(
        `[ElgatoLights] Failed to fetch state from ${this.name}: ${result.error?.message}`,
      );
      return false;
    }

    try {
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(result.bytes.get_data());
      const data = JSON.parse(text);

      if (data.lights && data.lights.length > 0) {
        const light = data.lights[0];
        this.on = light.on === 1;
        this.brightness = light.brightness;
        this.temperature = light.temperature;
      }

      return true;
    } catch (e) {
      console.error(`[ElgatoLights] Failed to parse state from ${this.name}: ${e.message}`);
      return false;
    }
  }

  /**
   * Fetches accessory information from the light device.
   *
   * Retrieves device metadata including the user-configured display name,
   * product name, firmware version, and serial number.
   *
   * @returns {Promise<Object|null>} The accessory info object or null on failure
   */
  async fetchInfo() {
    const url = `${this.baseUrl}/elgato/accessory-info`;
    const result = await this._sendWithRetry("GET", url);

    if (!result.success) {
      console.error(
        `[ElgatoLights] Failed to fetch info from ${this.name}: ${result.error?.message}`,
      );
      return null;
    }

    try {
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(result.bytes.get_data());
      const data = JSON.parse(text);

      // Store all accessory info
      if (data.displayName) {
        this.displayName = data.displayName;
      }
      if (data.productName) {
        this.productName = data.productName;
      }
      if (data.firmwareVersion) {
        this.firmwareVersion = data.firmwareVersion;
      }
      if (data.serialNumber) {
        this.serialNumber = data.serialNumber;
      }
      if (data.hardwareBoardType !== undefined) {
        this.hardwareBoardType = data.hardwareBoardType;
      }

      return data;
    } catch (e) {
      console.error(`[ElgatoLights] Failed to parse info from ${this.name}: ${e.message}`);
      return null;
    }
  }

  /**
   * Updates the light state with new values.
   *
   * @param {boolean} on - Whether the light should be on
   * @param {number} brightness - Brightness level (3-100)
   * @param {number} temperature - Color temperature in API units (143-344)
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async setState(on, brightness, temperature) {
    // Input validation: clamp values to valid ranges
    brightness = Math.max(3, Math.min(100, Math.round(brightness)));
    temperature = Math.max(143, Math.min(344, Math.round(temperature)));

    const payload = JSON.stringify({
      numberOfLights: 1,
      lights: [
        {
          on: on ? 1 : 0,
          brightness,
          temperature,
        },
      ],
    });

    const url = `${this.baseUrl}/elgato/lights`;
    const result = await this._sendWithRetry("PUT", url, payload);

    if (!result.success) {
      console.error(`[ElgatoLights] Failed to set state on ${this.name}: ${result.error?.message}`);
      return false;
    }

    // Update local cache
    this.on = on;
    this.brightness = brightness;
    this.temperature = temperature;

    return true;
  }

  /**
   * Sets only the on/off state without affecting brightness or temperature.
   * This preserves the light's current settings.
   *
   * Note: This method performs a GET followed by PUT to preserve device settings.
   * There is a small TOCTOU (time-of-check-time-of-use) window where another client
   * (e.g., Elgato Control Center) could modify settings between these operations.
   * This trade-off ensures we always use the device's actual current settings rather
   * than potentially stale cached values.
   *
   * @param {boolean} on - Whether to turn the light on or off
   * @returns {Promise<boolean>} True if successful
   */
  async setOn(on) {
    const url = `${this.baseUrl}/elgato/lights`;

    // Fetch current state to preserve brightness and temperature
    const getResult = await this._sendWithRetry("GET", url);

    if (!getResult.success) {
      console.error(
        `[ElgatoLights] Failed to get state from ${this.name}: ${getResult.error?.message}`,
      );
      return false;
    }

    let data;
    try {
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(getResult.bytes.get_data());
      data = JSON.parse(text);

      if (!data.lights || data.lights.length === 0) {
        throw new Error("No lights in response");
      }
    } catch (e) {
      console.error(`[ElgatoLights] Failed to parse state from ${this.name}: ${e.message}`);
      return false;
    }

    // Update only the on field, preserve brightness and temperature from device
    const payload = JSON.stringify({
      numberOfLights: 1,
      lights: [
        {
          on: on ? 1 : 0,
          brightness: data.lights[0].brightness,
          temperature: data.lights[0].temperature,
        },
      ],
    });

    const putResult = await this._sendWithRetry("PUT", url, payload);

    if (!putResult.success) {
      console.error(
        `[ElgatoLights] Failed to set on state on ${this.name}: ${putResult.error?.message}`,
      );
      return false;
    }

    // Update local cache with actual values from device
    this.on = on;
    this.brightness = data.lights[0].brightness;
    this.temperature = data.lights[0].temperature;

    return true;
  }

  /**
   * Turns the light on while maintaining current brightness and temperature.
   *
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async turnOn() {
    return this.setOn(true);
  }

  /**
   * Turns the light off while maintaining current brightness and temperature.
   *
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async turnOff() {
    return this.setOn(false);
  }

  /**
   * Toggles the light on/off state.
   *
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async toggle() {
    // Fetch current state first to avoid using stale cache
    await this.fetchState();
    return this.setOn(!this.on);
  }

  /**
   * Sets the brightness level while maintaining current on/off and temperature.
   *
   * @param {number} value - Brightness level (3-100)
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async setBrightness(value) {
    return this.setState(this.on, value, this.temperature);
  }

  /**
   * Sets the color temperature while maintaining current on/off and brightness.
   *
   * @param {number} value - Color temperature in API units (143-344)
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async setTemperature(value) {
    return this.setState(this.on, this.brightness, value);
  }
}
