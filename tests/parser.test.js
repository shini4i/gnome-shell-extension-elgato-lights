/**
 * Unit tests for parser utilities.
 */

import { describe, it, expect } from "vitest";
import {
  parseAvahiOutput,
  decodeAvahiString,
  isValidLightConfig,
  parseCachedLights,
} from "../lib/parser.js";

describe("decodeAvahiString", () => {
  it("returns null/undefined as-is", () => {
    expect(decodeAvahiString(null)).toBe(null);
    expect(decodeAvahiString(undefined)).toBe(undefined);
  });

  it("returns string without escapes unchanged", () => {
    expect(decodeAvahiString("Hello World")).toBe("Hello World");
  });

  it("decodes space character (\\032)", () => {
    expect(decodeAvahiString("Hello\\032World")).toBe("Hello World");
  });

  it("decodes multiple escape sequences", () => {
    expect(decodeAvahiString("Elgato\\032Key\\032Light\\03244CB")).toBe("Elgato Key Light 44CB");
  });

  it("handles empty string", () => {
    expect(decodeAvahiString("")).toBe("");
  });
});

describe("parseAvahiOutput", () => {
  it("returns empty array for null input", () => {
    expect(parseAvahiOutput(null)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAvahiOutput("")).toEqual([]);
  });

  it("returns empty array for undefined input", () => {
    expect(parseAvahiOutput(undefined)).toEqual([]);
  });

  it("ignores lines that do not start with =", () => {
    const output = `+;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local
-;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local`;
    expect(parseAvahiOutput(output)).toEqual([]);
  });

  it("parses a single resolved IPv4 entry", () => {
    const output =
      '=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;elgato-key-light-abc1.local;192.168.1.100;9123;"mf=Elgato"';
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Elgato Key Light ABC1",
      host: "192.168.1.100",
      port: 9123,
    });
  });

  it("parses multiple lights", () => {
    const output = `=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host1.local;192.168.1.100;9123;"mf=Elgato"
=;eth0;IPv4;Elgato Key Light DEF2;_elg._tcp;local;host2.local;192.168.1.101;9123;"mf=Elgato"`;
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(2);
    expect(result[0].host).toBe("192.168.1.100");
    expect(result[1].host).toBe("192.168.1.101");
  });

  it("skips IPv6 entries", () => {
    const output = `=;eth0;IPv6;Elgato Key Light ABC1;_elg._tcp;local;host.local;fe80::1;9123;"mf=Elgato"
=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host.local;192.168.1.100;9123;"mf=Elgato"`;
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0].host).toBe("192.168.1.100");
  });

  it("deduplicates entries by host:port", () => {
    const output = `=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host.local;192.168.1.100;9123;"mf=Elgato"
=;wlan0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host.local;192.168.1.100;9123;"mf=Elgato"`;
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(1);
  });

  it("ignores malformed lines with too few fields", () => {
    const output = `=;eth0;IPv4;Elgato Key Light;_elg._tcp;local;host.local
=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host.local;192.168.1.100;9123`;
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0].host).toBe("192.168.1.100");
  });

  it("uses default port 9123 when port is invalid", () => {
    const output =
      '=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host.local;192.168.1.100;invalid;"mf=Elgato"';
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(9123);
  });

  it("handles mixed valid and invalid entries", () => {
    const output = `+;eth0;IPv4;Announcement;_elg._tcp;local
=;eth0;IPv4;Elgato Key Light ABC1;_elg._tcp;local;host.local;192.168.1.100;9123;"mf=Elgato"
=;eth0;IPv6;Elgato Key Light ABC1;_elg._tcp;local;host.local;fe80::1;9123;"mf=Elgato"
malformed line
=;eth0;IPv4;Elgato Key Light DEF2;_elg._tcp;local;host2.local;192.168.1.101;9123;"mf=Elgato"`;
    const result = parseAvahiOutput(output);

    expect(result).toHaveLength(2);
    expect(result.map((l) => l.host)).toEqual(["192.168.1.100", "192.168.1.101"]);
  });
});

describe("isValidLightConfig", () => {
  it("returns true for valid config", () => {
    const config = { name: "Test Light", host: "192.168.1.100", port: 9123 };
    expect(isValidLightConfig(config)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidLightConfig(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidLightConfig(undefined)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isValidLightConfig("string")).toBe(false);
    expect(isValidLightConfig(123)).toBe(false);
    expect(isValidLightConfig([])).toBe(false);
  });

  it("returns false for empty name", () => {
    expect(isValidLightConfig({ name: "", host: "192.168.1.100", port: 9123 })).toBe(false);
  });

  it("returns false for non-string name", () => {
    expect(isValidLightConfig({ name: 123, host: "192.168.1.100", port: 9123 })).toBe(false);
  });

  it("returns false for empty host", () => {
    expect(isValidLightConfig({ name: "Test", host: "", port: 9123 })).toBe(false);
  });

  it("returns false for invalid port", () => {
    expect(isValidLightConfig({ name: "Test", host: "192.168.1.100", port: 0 })).toBe(false);
    expect(isValidLightConfig({ name: "Test", host: "192.168.1.100", port: -1 })).toBe(false);
    expect(isValidLightConfig({ name: "Test", host: "192.168.1.100", port: 70000 })).toBe(false);
    expect(
      isValidLightConfig({
        name: "Test",
        host: "192.168.1.100",
        port: "string",
      }),
    ).toBe(false);
  });

  it("accepts valid port range (1-65535)", () => {
    expect(isValidLightConfig({ name: "Test", host: "192.168.1.100", port: 1 })).toBe(true);
    expect(isValidLightConfig({ name: "Test", host: "192.168.1.100", port: 65535 })).toBe(true);
  });
});

describe("parseCachedLights", () => {
  it("returns empty array for null", () => {
    expect(parseCachedLights(null)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCachedLights("")).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseCachedLights("not json")).toEqual([]);
    expect(parseCachedLights("{invalid}")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseCachedLights('{"foo": "bar"}')).toEqual([]);
    expect(parseCachedLights('"string"')).toEqual([]);
  });

  it("parses valid JSON array of lights", () => {
    const json = JSON.stringify([
      { name: "Light 1", host: "192.168.1.100", port: 9123 },
      { name: "Light 2", host: "192.168.1.101", port: 9123 },
    ]);
    const result = parseCachedLights(json);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Light 1");
    expect(result[1].name).toBe("Light 2");
  });

  it("filters out invalid entries", () => {
    const json = JSON.stringify([
      { name: "Valid", host: "192.168.1.100", port: 9123 },
      { name: "", host: "192.168.1.101", port: 9123 }, // invalid: empty name
      { name: "Missing port", host: "192.168.1.102" }, // invalid: no port
      null, // invalid
      { name: "Valid 2", host: "192.168.1.103", port: 9123 },
    ]);
    const result = parseCachedLights(json);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Valid");
    expect(result[1].name).toBe("Valid 2");
  });
});
