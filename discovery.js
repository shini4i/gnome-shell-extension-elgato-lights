/**
 * mDNS discovery module for Elgato Key Light devices.
 *
 * Uses the Avahi D-Bus API to discover Elgato lights on the local network
 * via their advertised _elg._tcp mDNS service.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

export const AVAHI_BUS_NAME = "org.freedesktop.Avahi";
export const AVAHI_SERVER_PATH = "/";
export const AVAHI_SERVER_IFACE = "org.freedesktop.Avahi.Server";
export const AVAHI_SERVICE_BROWSER_IFACE = "org.freedesktop.Avahi.ServiceBrowser";
export const AVAHI_SERVICE_RESOLVER_IFACE = "org.freedesktop.Avahi.ServiceResolver";

export const ELGATO_SERVICE_TYPE = "_elg._tcp";
export const DISCOVERY_TIMEOUT_MS = 5000;

// Avahi constants
export const AVAHI_IF_UNSPEC = -1;
export const AVAHI_PROTO_UNSPEC = -1;

/**
 * Gets the system D-Bus connection.
 * Exported for testing - can be mocked to inject a test bus.
 *
 * @returns {Gio.DBusConnection} The system bus connection
 * @throws {Error} If connection fails
 */
export function getSystemBus() {
  return Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
}

/**
 * Creates a timeout using GLib.
 * Exported for testing - can be mocked to control timing.
 *
 * @param {number} ms - Timeout in milliseconds
 * @param {Function} callback - Function to call when timeout fires
 * @returns {number} Timeout ID for cancellation
 */
export function createTimeout(ms, callback) {
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, callback);
}

/**
 * Removes a timeout.
 * Exported for testing - can be mocked.
 *
 * @param {number} id - Timeout ID to remove
 */
export function removeTimeout(id) {
  GLib.source_remove(id);
}

/**
 * Creates a GLib.Variant for D-Bus calls.
 * Exported for testing - can be mocked.
 *
 * @param {string} signature - Variant type signature
 * @param {Array} values - Values to pack
 * @returns {GLib.Variant} The packed variant
 */
export function createVariant(signature, values) {
  return new GLib.Variant(signature, values);
}

/**
 * Creates a GLib.VariantType.
 * Exported for testing - can be mocked.
 *
 * @param {string} signature - Type signature
 * @returns {GLib.VariantType} The variant type
 */
export function createVariantType(signature) {
  return GLib.VariantType.new(signature);
}

/**
 * Default implementations of platform dependencies.
 * These can be overridden in tests.
 */
export const platformDefaults = {
  getSystemBus,
  createTimeout,
  removeTimeout,
  createVariant,
  createVariantType,
  DbusCallFlags: Gio.DBusCallFlags,
  DbusSignalFlags: Gio.DBusSignalFlags,
};

/**
 * Discovers Elgato Key Light devices on the local network using mDNS.
 *
 * Uses the Avahi D-Bus API to browse for devices advertising the _elg._tcp
 * service type. Returns a promise that resolves with an array of discovered
 * light objects.
 *
 * @param {Object} [platform=platformDefaults] - Platform dependencies (for testing)
 * @returns {Promise<Array<{name: string, host: string, port: number}>>}
 *          Array of discovered light objects with name, host (IP), and port
 * @throws {Error} If Avahi daemon is not available or discovery fails
 */
export function discoverLights(platform = platformDefaults) {
  return new Promise((resolve, reject) => {
    const lights = new Map();
    let browserPath = null;
    let browserSignalId = null;
    let allForNowSignalId = null;
    let failureSignalId = null;
    const resolverSignalIds = [];
    const resolverPaths = new Set();
    const freedResolvers = new Set();
    const completedResolvers = new Set();
    let timeoutId = null;
    let bus = null;
    let completed = false;
    let allForNowReceived = false;
    let pendingResolvers = 0;

    /**
     * Frees a resolver if not already freed.
     *
     * @param {string} resolverPath - D-Bus path of the resolver to free
     */
    const freeResolver = (resolverPath) => {
      if (freedResolvers.has(resolverPath)) {
        return;
      }
      freedResolvers.add(resolverPath);

      bus.call(
        AVAHI_BUS_NAME,
        resolverPath,
        AVAHI_SERVICE_RESOLVER_IFACE,
        "Free",
        null,
        null,
        platform.DbusCallFlags.NONE,
        -1,
        null,
        () => {
          // Ignore errors during cleanup - callback required for async D-Bus call
        },
      );
    };

    /**
     * Checks if discovery should complete and triggers completion if ready.
     * Discovery completes when AllForNow has been received and all pending
     * resolvers have finished (either Found or Failure).
     */
    const checkCompletion = () => {
      if (allForNowReceived && pendingResolvers === 0) {
        complete();
      }
    };

    /**
     * Cleans up all D-Bus subscriptions and resources.
     */
    const cleanup = () => {
      if (timeoutId) {
        platform.removeTimeout(timeoutId);
        timeoutId = null;
      }

      if (bus) {
        if (browserSignalId) {
          bus.signal_unsubscribe(browserSignalId);
          browserSignalId = null;
        }
        if (allForNowSignalId) {
          bus.signal_unsubscribe(allForNowSignalId);
          allForNowSignalId = null;
        }
        if (failureSignalId) {
          bus.signal_unsubscribe(failureSignalId);
          failureSignalId = null;
        }
        for (const id of resolverSignalIds) {
          bus.signal_unsubscribe(id);
        }
        resolverSignalIds.length = 0;

        // Free any resolvers that haven't been freed yet
        for (const resolverPath of resolverPaths) {
          freeResolver(resolverPath);
        }
      }

      // Free the browser if created
      if (bus && browserPath) {
        bus.call(
          AVAHI_BUS_NAME,
          browserPath,
          AVAHI_SERVICE_BROWSER_IFACE,
          "Free",
          null,
          null,
          platform.DbusCallFlags.NONE,
          -1,
          null,
          () => {
            // Ignore errors during cleanup - callback required for async D-Bus call
          },
        );
        browserPath = null;
      }
    };

    /**
     * Completes the discovery with results.
     *
     * @param {Error|null} error - Error if discovery failed
     */
    const complete = (error = null) => {
      if (completed) return;
      completed = true;
      cleanup();

      if (error) {
        reject(error);
      } else {
        resolve(Array.from(lights.values()));
      }
    };

    try {
      bus = platform.getSystemBus();
    } catch (e) {
      reject(new Error(`Failed to connect to system D-Bus: ${e.message}`));
      return;
    }

    // Set up timeout
    timeoutId = platform.createTimeout(DISCOVERY_TIMEOUT_MS, () => {
      timeoutId = null;
      complete();
      return false; // GLib.SOURCE_REMOVE
    });

    // Create service browser
    try {
      bus.call(
        AVAHI_BUS_NAME,
        AVAHI_SERVER_PATH,
        AVAHI_SERVER_IFACE,
        "ServiceBrowserNew",
        platform.createVariant("(iissu)", [
          AVAHI_IF_UNSPEC,
          AVAHI_PROTO_UNSPEC,
          ELGATO_SERVICE_TYPE,
          "",
          0,
        ]),
        platform.createVariantType("(o)"),
        platform.DbusCallFlags.NONE,
        -1,
        null,
        (_conn, result) => {
          try {
            const reply = bus.call_finish(result);
            browserPath = reply.get_child_value(0).get_string()[0];

            // Subscribe to ItemNew signal
            browserSignalId = bus.signal_subscribe(
              AVAHI_BUS_NAME,
              AVAHI_SERVICE_BROWSER_IFACE,
              "ItemNew",
              browserPath,
              null,
              platform.DbusSignalFlags.NONE,
              (_conn, _sender, _path, _iface, _signal, params) => {
                const [iface, protocol, name, type, domain] = params.recursiveUnpack();

                // Track that we're starting a resolver operation
                pendingResolvers++;

                // Create a resolver for this service
                bus.call(
                  AVAHI_BUS_NAME,
                  AVAHI_SERVER_PATH,
                  AVAHI_SERVER_IFACE,
                  "ServiceResolverNew",
                  platform.createVariant("(iisssiu)", [
                    iface,
                    protocol,
                    name,
                    type,
                    domain,
                    AVAHI_PROTO_UNSPEC,
                    0,
                  ]),
                  platform.createVariantType("(o)"),
                  platform.DbusCallFlags.NONE,
                  -1,
                  null,
                  (_conn, resolverResult) => {
                    try {
                      const resolverReply = bus.call_finish(resolverResult);
                      const resolverPath = resolverReply.get_child_value(0).get_string()[0];

                      // Track resolver for cleanup
                      resolverPaths.add(resolverPath);

                      // Subscribe to Found signal
                      const foundSignalId = bus.signal_subscribe(
                        AVAHI_BUS_NAME,
                        AVAHI_SERVICE_RESOLVER_IFACE,
                        "Found",
                        resolverPath,
                        null,
                        platform.DbusSignalFlags.NONE,
                        (_conn, _sender, _path, _iface, _signal, foundParams) => {
                          // Guard against duplicate signal delivery
                          if (completedResolvers.has(resolverPath)) {
                            return;
                          }
                          completedResolvers.add(resolverPath);

                          const unpacked = foundParams.recursiveUnpack();
                          // Found signal: (iissssisqaayu)
                          // interface, protocol, name, type, domain, host, aprotocol, address, port, txt, flags
                          const serviceName = unpacked[2];
                          const address = unpacked[7];
                          const port = unpacked[8];

                          // Use address as unique key to avoid duplicates
                          const key = `${address}:${port}`;
                          if (!lights.has(key)) {
                            lights.set(key, {
                              name: serviceName,
                              host: address,
                              port: port,
                            });
                          }

                          freeResolver(resolverPath);
                          pendingResolvers--;
                          checkCompletion();
                        },
                      );
                      resolverSignalIds.push(foundSignalId);

                      // Subscribe to resolver Failure signal
                      const resolverFailureId = bus.signal_subscribe(
                        AVAHI_BUS_NAME,
                        AVAHI_SERVICE_RESOLVER_IFACE,
                        "Failure",
                        resolverPath,
                        null,
                        platform.DbusSignalFlags.NONE,
                        () => {
                          // Guard against duplicate signal delivery
                          if (completedResolvers.has(resolverPath)) {
                            return;
                          }
                          completedResolvers.add(resolverPath);

                          freeResolver(resolverPath);
                          pendingResolvers--;
                          checkCompletion();
                        },
                      );
                      resolverSignalIds.push(resolverFailureId);
                    } catch (e) {
                      console.error(`[ElgatoLights] Failed to create resolver: ${e.message}`);
                      pendingResolvers--;
                      checkCompletion();
                    }
                  },
                );
              },
            );

            // Subscribe to AllForNow signal (discovery complete)
            allForNowSignalId = bus.signal_subscribe(
              AVAHI_BUS_NAME,
              AVAHI_SERVICE_BROWSER_IFACE,
              "AllForNow",
              browserPath,
              null,
              platform.DbusSignalFlags.NONE,
              () => {
                // Mark that Avahi has finished browsing for services
                allForNowReceived = true;
                // Complete if all resolvers have finished, otherwise wait for them
                checkCompletion();
              },
            );

            // Subscribe to Failure signal
            failureSignalId = bus.signal_subscribe(
              AVAHI_BUS_NAME,
              AVAHI_SERVICE_BROWSER_IFACE,
              "Failure",
              browserPath,
              null,
              platform.DbusSignalFlags.NONE,
              (_conn, _sender, _path, _iface, _signal, params) => {
                const [errorMsg] = params.recursiveUnpack();
                complete(new Error(`Service browser failed: ${errorMsg}`));
              },
            );
          } catch (e) {
            complete(new Error(`Failed to create service browser: ${e.message}`));
          }
        },
      );
    } catch (e) {
      complete(new Error(`Failed to initiate service browser: ${e.message}`));
    }
  });
}

/**
 * Checks if the Avahi D-Bus service is available on the system.
 *
 * @param {Object} [platform=platformDefaults] - Platform dependencies (for testing)
 * @returns {Promise<boolean>} True if Avahi is available, false otherwise
 */
export async function isAvahiAvailable(platform = platformDefaults) {
  try {
    const bus = platform.getSystemBus();

    return new Promise((resolve) => {
      bus.call(
        AVAHI_BUS_NAME,
        AVAHI_SERVER_PATH,
        AVAHI_SERVER_IFACE,
        "GetVersionString",
        null,
        platform.createVariantType("(s)"),
        platform.DbusCallFlags.NONE,
        1000,
        null,
        (conn, result) => {
          try {
            conn.call_finish(result);
            resolve(true);
          } catch {
            resolve(false);
          }
        },
      );
    });
  } catch {
    return false;
  }
}
