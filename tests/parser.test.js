/**
 * Unit tests for parser utilities.
 */

import { describe, it, expect } from "vitest";
import { isValidLightConfig, parseCachedLights } from "../lib/parser.js";

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
