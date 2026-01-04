/**
 * Unit tests for discovery module.
 *
 * Uses mock D-Bus objects to test the discovery logic without requiring
 * actual GI bindings or a running Avahi daemon.
 */

/* global setTimeout, setImmediate */

import { describe, it, expect, vi } from "vitest";
import {
  discoverLights,
  isAvahiAvailable,
  AVAHI_BUS_NAME,
  AVAHI_SERVICE_BROWSER_IFACE,
  AVAHI_SERVICE_RESOLVER_IFACE,
  ELGATO_SERVICE_TYPE,
  AVAHI_IF_UNSPEC,
  AVAHI_PROTO_UNSPEC,
} from "../discovery.js";

/**
 * Creates a mock variant that mimics GLib.Variant behavior.
 *
 * @param {*} value - The value to wrap
 * @returns {Object} Mock variant object
 */
function createMockVariant(value) {
  return {
    value,
    get_child_value: (index) => ({
      get_string: () => [value[index]],
    }),
    recursiveUnpack: () => value,
  };
}

/**
 * Creates a mock D-Bus bus object.
 *
 * @param {Object} options - Configuration options
 * @returns {Object} Mock bus object with call and signal_subscribe methods
 */
function createMockBus(options = {}) {
  const signalHandlers = new Map();
  let signalIdCounter = 1;
  let resolverCounter = 1;

  const bus = {
    _signalHandlers: signalHandlers,
    _options: options,
    _resolverPaths: [],

    call: vi.fn(
      (busName, path, iface, method, args, replyType, flags, timeout, cancellable, callback) => {
        // Handle different method calls
        if (method === "ServiceBrowserNew") {
          const browserPath = options.browserPath || "/test/browser/1";
          if (options.browserError) {
            setImmediate(() => {
              const mockResult = {
                call_finish: () => {
                  throw new Error(options.browserError);
                },
              };
              callback(bus, mockResult);
            });
          } else {
            setImmediate(() => {
              callback(bus, createMockVariant([browserPath]));
            });
          }
        } else if (method === "ServiceResolverNew") {
          const resolverPath = `/test/resolver/${resolverCounter++}`;
          bus._resolverPaths.push(resolverPath);
          setImmediate(() => {
            callback(bus, createMockVariant([resolverPath]));
          });
        } else if (method === "GetVersionString") {
          if (options.avahiUnavailable) {
            setImmediate(() => {
              const mockResult = {
                call_finish: () => {
                  throw new Error("Service not available");
                },
              };
              callback(bus, mockResult);
            });
          } else {
            setImmediate(() => {
              callback(bus, createMockVariant(["0.8"]));
            });
          }
        } else if (method === "Free") {
          // Free calls return a promise-like object
          return Promise.resolve();
        }
      },
    ),

    call_finish: vi.fn((result) => {
      if (result && result.call_finish) {
        return result.call_finish();
      }
      return result;
    }),

    signal_subscribe: vi.fn((busName, iface, signal, path, arg0, flags, handler) => {
      const id = signalIdCounter++;
      signalHandlers.set(id, { busName, iface, signal, path, handler });
      return id;
    }),

    signal_unsubscribe: vi.fn((id) => {
      signalHandlers.delete(id);
    }),

    // Helper to emit a signal for testing
    _emitSignal: (iface, signal, path, params) => {
      for (const [, entry] of signalHandlers) {
        if (entry.iface === iface && entry.signal === signal && entry.path === path) {
          entry.handler(bus, AVAHI_BUS_NAME, path, iface, signal, createMockVariant(params));
        }
      }
    },

    // Helper to get the last created resolver path
    _getLastResolverPath: () => {
      return bus._resolverPaths[bus._resolverPaths.length - 1];
    },
  };

  return bus;
}

/**
 * Creates a mock platform object for dependency injection.
 *
 * @param {Object} busOptions - Options for the mock bus
 * @returns {Object} Mock platform object
 */
function createMockPlatform(busOptions = {}) {
  const bus = createMockBus(busOptions);
  const timeouts = new Map();
  let timeoutId = 1;

  return {
    bus,
    timeouts,
    getSystemBus: vi.fn(() => {
      if (busOptions.busError) {
        throw new Error(busOptions.busError);
      }
      return bus;
    }),
    createTimeout: vi.fn((ms, callback) => {
      const id = timeoutId++;
      timeouts.set(id, { ms, callback, cleared: false });
      return id;
    }),
    removeTimeout: vi.fn((id) => {
      const timeout = timeouts.get(id);
      if (timeout) {
        timeout.cleared = true;
      }
    }),
    createVariant: vi.fn((signature, values) => createMockVariant(values)),
    createVariantType: vi.fn((signature) => ({ signature })),
    DbusCallFlags: { NONE: 0 },
    DbusSignalFlags: { NONE: 0 },

    // Helper to trigger a timeout
    _triggerTimeout: (id) => {
      const timeout = timeouts.get(id);
      if (timeout && !timeout.cleared) {
        timeout.callback();
      }
    },

    // Helper to trigger all pending timeouts
    _triggerAllTimeouts: () => {
      for (const [, timeout] of timeouts) {
        if (!timeout.cleared) {
          timeout.callback();
        }
      }
    },
  };
}

/**
 * Helper to wait for async operations to settle.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function wait(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("discoverLights", () => {
  it("returns empty array when no lights are found and timeout fires", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    // Emit AllForNow signal
    const browserPath = "/test/browser/1";
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    const result = await promise;
    expect(result).toEqual([]);
  });

  it("discovers a single light", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    // Emit ItemNew signal for a light
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      1, // interface
      0, // protocol
      "Elgato Key Light ABC1",
      ELGATO_SERVICE_TYPE,
      "local",
      0, // flags
    ]);

    // Wait for resolver to be created
    await wait();

    // Emit Found signal for the resolver
    const resolverPath = platform.bus._getLastResolverPath();
    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Found", resolverPath, [
      1, // interface
      0, // protocol
      "Elgato Key Light ABC1", // name
      ELGATO_SERVICE_TYPE, // type
      "local", // domain
      "elgato.local", // host
      0, // aprotocol
      "192.168.1.100", // address
      9123, // port
      [], // txt
      0, // flags
    ]);

    await wait();

    // Emit AllForNow
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    const result = await promise;

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Elgato Key Light ABC1",
      host: "192.168.1.100",
      port: 9123,
    });
  });

  it("discovers multiple lights", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    // Emit ItemNew for first light
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      0,
    ]);

    await wait();
    const resolver1 = platform.bus._getLastResolverPath();

    // Emit ItemNew for second light
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      1,
      0,
      "Light 2",
      ELGATO_SERVICE_TYPE,
      "local",
      0,
    ]);

    await wait();
    const resolver2 = platform.bus._getLastResolverPath();

    // Emit Found for first resolver
    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Found", resolver1, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      "host1.local",
      0,
      "192.168.1.100",
      9123,
      [],
      0,
    ]);

    // Emit Found for second resolver
    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Found", resolver2, [
      1,
      0,
      "Light 2",
      ELGATO_SERVICE_TYPE,
      "local",
      "host2.local",
      0,
      "192.168.1.101",
      9123,
      [],
      0,
    ]);

    // Emit AllForNow
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    const result = await promise;

    expect(result).toHaveLength(2);
    expect(result.map((l) => l.host)).toContain("192.168.1.100");
    expect(result.map((l) => l.host)).toContain("192.168.1.101");
  });

  it("deduplicates lights by address:port", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    // Emit ItemNew twice for the same light (different interfaces)
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      0,
    ]);

    await wait();
    const resolver1 = platform.bus._getLastResolverPath();

    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      2,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      0,
    ]);

    await wait();
    const resolver2 = platform.bus._getLastResolverPath();

    // Both resolve to same address
    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Found", resolver1, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      "host.local",
      0,
      "192.168.1.100",
      9123,
      [],
      0,
    ]);

    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Found", resolver2, [
      2,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      "host.local",
      0,
      "192.168.1.100",
      9123,
      [],
      0,
    ]);

    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    const result = await promise;

    expect(result).toHaveLength(1);
  });

  it("rejects when D-Bus connection fails", async () => {
    const platform = createMockPlatform({ busError: "Connection refused" });

    await expect(discoverLights(platform)).rejects.toThrow("Failed to connect to system D-Bus");
  });

  it("rejects when browser creation fails", async () => {
    const platform = createMockPlatform({ browserError: "Permission denied" });

    await expect(discoverLights(platform)).rejects.toThrow("Failed to create service browser");
  });

  it("handles browser failure signal", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    // Emit Failure signal
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "Failure", browserPath, [
      "Network unreachable",
    ]);

    await expect(promise).rejects.toThrow("Service browser failed: Network unreachable");
  });

  it("cleans up signals on completion", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    await promise;

    // Verify signal_unsubscribe was called
    expect(platform.bus.signal_unsubscribe).toHaveBeenCalled();
  });

  it("cleans up timeout on completion", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    await promise;

    // Verify removeTimeout was called
    expect(platform.removeTimeout).toHaveBeenCalled();
  });

  it("handles resolver failure gracefully", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    // Emit ItemNew
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      0,
    ]);

    await wait();
    const resolverPath = platform.bus._getLastResolverPath();

    // Emit Failure for resolver
    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Failure", resolverPath, [
      "Resolution failed",
    ]);

    // Emit AllForNow
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "AllForNow", browserPath, []);

    await wait();
    platform._triggerAllTimeouts();

    const result = await promise;

    // Should complete without error, just with no lights
    expect(result).toEqual([]);
  });

  it("returns results on main timeout without AllForNow", async () => {
    const platform = createMockPlatform();

    const promise = discoverLights(platform);

    await wait();

    const browserPath = "/test/browser/1";

    // Emit ItemNew and Found, but no AllForNow
    platform.bus._emitSignal(AVAHI_SERVICE_BROWSER_IFACE, "ItemNew", browserPath, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      0,
    ]);

    await wait();
    const resolverPath = platform.bus._getLastResolverPath();

    platform.bus._emitSignal(AVAHI_SERVICE_RESOLVER_IFACE, "Found", resolverPath, [
      1,
      0,
      "Light 1",
      ELGATO_SERVICE_TYPE,
      "local",
      "host.local",
      0,
      "192.168.1.100",
      9123,
      [],
      0,
    ]);

    await wait();

    // Trigger the main discovery timeout (simulating timeout without AllForNow)
    platform._triggerAllTimeouts();

    const result = await promise;

    expect(result).toHaveLength(1);
    expect(result[0].host).toBe("192.168.1.100");
  });
});

describe("isAvahiAvailable", () => {
  it("returns true when Avahi responds", async () => {
    const platform = createMockPlatform();

    const result = await isAvahiAvailable(platform);

    expect(result).toBe(true);
  });

  it("returns false when Avahi is not available", async () => {
    const platform = createMockPlatform({ avahiUnavailable: true });

    const result = await isAvahiAvailable(platform);

    expect(result).toBe(false);
  });

  it("returns false when D-Bus connection fails", async () => {
    const platform = createMockPlatform({ busError: "Connection refused" });

    const result = await isAvahiAvailable(platform);

    expect(result).toBe(false);
  });
});

describe("exported constants", () => {
  it("exports correct Avahi constants", () => {
    expect(AVAHI_BUS_NAME).toBe("org.freedesktop.Avahi");
    expect(AVAHI_SERVICE_BROWSER_IFACE).toBe("org.freedesktop.Avahi.ServiceBrowser");
    expect(AVAHI_SERVICE_RESOLVER_IFACE).toBe("org.freedesktop.Avahi.ServiceResolver");
    expect(ELGATO_SERVICE_TYPE).toBe("_elg._tcp");
    expect(AVAHI_IF_UNSPEC).toBe(-1);
    expect(AVAHI_PROTO_UNSPEC).toBe(-1);
  });
});
