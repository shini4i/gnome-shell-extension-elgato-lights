/**
 * Parser utilities for Elgato Key Light discovery.
 *
 * This module handles parsing of avahi-browse output to extract light
 * information from mDNS discovery results.
 *
 * This module is pure JavaScript with no GI dependencies, making it testable
 * in a standard Node.js environment.
 */

/**
 * Decodes avahi-browse escaped strings.
 *
 * Avahi escapes special characters using \DDD where DDD is a 3-digit octal number.
 * For example, \032 represents a space character (octal 32 = decimal 26... wait, no).
 * Actually \032 is octal for decimal 26, but avahi uses decimal in the escape!
 * So \032 = character code 32 = space.
 *
 * @param {string} str - String with avahi escape sequences
 * @returns {string} Decoded string
 */
export function decodeAvahiString(str) {
  if (!str) {
    return str;
  }
  // Avahi uses \DDD where DDD is a 3-digit DECIMAL number (not octal despite the backslash)
  return str.replace(/\\(\d{3})/g, (match, digits) => {
    const charCode = parseInt(digits, 10);
    return String.fromCharCode(charCode);
  });
}

/**
 * Parses the output from avahi-browse command.
 *
 * The avahi-browse -p flag produces parseable output with semicolon-separated fields.
 * Resolved entries (starting with '=') contain the IP address and port we need.
 *
 * Output format for resolved entries:
 * =;interface;protocol;name;type;domain;hostname;address;port;txt-records...
 *
 * @param {string} output - Raw output from avahi-browse
 * @returns {Array<{name: string, host: string, port: number}>} Parsed light objects
 */
export function parseAvahiOutput(output) {
  const lights = [];
  const seen = new Set();

  if (!output) {
    return lights;
  }

  const lines = output.split("\n");

  for (const line of lines) {
    // Only process resolved entries (lines starting with '=')
    if (!line.startsWith("=")) {
      continue;
    }

    const fields = line.split(";");
    if (fields.length < 9) {
      continue;
    }

    // Skip IPv6 to avoid duplicates (prefer IPv4)
    if (fields[2] !== "IPv4") {
      continue;
    }

    const host = fields[7];
    const port = parseInt(fields[8], 10);

    // Deduplicate by host:port
    const key = `${host}:${port}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    lights.push({
      name: decodeAvahiString(fields[3]), // Service name from mDNS (decoded)
      host: host,
      port: port || 9123,
    });
  }

  return lights;
}

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
