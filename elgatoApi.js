/**
 * Elgato Light API client module.
 *
 * Provides HTTP client functionality for communicating with Elgato Key Light
 * devices via their REST API on port 9123.
 */

import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';

// Re-export conversion utilities from lib (testable without GI dependencies)
export { Temperature, Brightness } from './lib/conversions.js';

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
        try {
            const message = Soup.Message.new('GET', `${this.baseUrl}/elgato/lights`);
            const bytes = await this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.get_status() !== Soup.Status.OK) {
                throw new Error(`HTTP ${message.get_status()}`);
            }

            const decoder = new TextDecoder('utf-8');
            const text = decoder.decode(bytes.get_data());
            const data = JSON.parse(text);

            if (data.lights && data.lights.length > 0) {
                const light = data.lights[0];
                this.on = light.on === 1;
                this.brightness = light.brightness;
                this.temperature = light.temperature;
            }

            return true;
        } catch (e) {
            console.error(`[ElgatoLights] Failed to fetch state from ${this.name}: ${e.message}`);
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
        try {
            const message = Soup.Message.new('GET', `${this.baseUrl}/elgato/accessory-info`);
            const bytes = await this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.get_status() !== Soup.Status.OK) {
                throw new Error(`HTTP ${message.get_status()}`);
            }

            const decoder = new TextDecoder('utf-8');
            const text = decoder.decode(bytes.get_data());
            const data = JSON.parse(text);

            if (data.displayName) {
                this.displayName = data.displayName;
            }

            return data;
        } catch (e) {
            console.error(`[ElgatoLights] Failed to fetch info from ${this.name}: ${e.message}`);
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
        try {
            const payload = JSON.stringify({
                numberOfLights: 1,
                lights: [{
                    on: on ? 1 : 0,
                    brightness: Math.round(brightness),
                    temperature: Math.round(temperature),
                }],
            });

            const message = Soup.Message.new('PUT', `${this.baseUrl}/elgato/lights`);
            message.set_request_body_from_bytes(
                'application/json',
                new GLib.Bytes(new TextEncoder().encode(payload))
            );

            const bytes = await this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.get_status() !== Soup.Status.OK) {
                throw new Error(`HTTP ${message.get_status()}`);
            }

            // Update local cache
            this.on = on;
            this.brightness = brightness;
            this.temperature = temperature;

            return true;
        } catch (e) {
            console.error(`[ElgatoLights] Failed to set state on ${this.name}: ${e.message}`);
            return false;
        }
    }

    /**
     * Sets only the on/off state without affecting brightness or temperature.
     * This preserves the light's current settings.
     *
     * @param {boolean} on - Whether to turn the light on or off
     * @returns {Promise<boolean>} True if successful
     */
    async setOn(on) {
        try {
            // Fetch current state to preserve brightness and temperature
            const getMessage = Soup.Message.new('GET', `${this.baseUrl}/elgato/lights`);
            const getBytes = await this._session.send_and_read_async(
                getMessage,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (getMessage.get_status() !== Soup.Status.OK) {
                throw new Error(`HTTP ${getMessage.get_status()}`);
            }

            const decoder = new TextDecoder('utf-8');
            const text = decoder.decode(getBytes.get_data());
            const data = JSON.parse(text);

            if (!data.lights || data.lights.length === 0) {
                throw new Error('No lights in response');
            }

            // Update only the on field, preserve brightness and temperature from device
            const payload = JSON.stringify({
                numberOfLights: 1,
                lights: [{
                    on: on ? 1 : 0,
                    brightness: data.lights[0].brightness,
                    temperature: data.lights[0].temperature,
                }],
            });

            const putMessage = Soup.Message.new('PUT', `${this.baseUrl}/elgato/lights`);
            putMessage.set_request_body_from_bytes(
                'application/json',
                new GLib.Bytes(new TextEncoder().encode(payload))
            );

            const putBytes = await this._session.send_and_read_async(
                putMessage,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (putMessage.get_status() !== Soup.Status.OK) {
                throw new Error(`HTTP ${putMessage.get_status()}`);
            }

            // Update local cache with actual values from device
            this.on = on;
            this.brightness = data.lights[0].brightness;
            this.temperature = data.lights[0].temperature;

            return true;
        } catch (e) {
            console.error(`[ElgatoLights] Failed to set on state on ${this.name}: ${e.message}`);
            return false;
        }
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

