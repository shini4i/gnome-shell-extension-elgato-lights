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
    let resolverFoundSignalId = null;
    let resolverFailureSignalId = null;
    const resolverPaths = new Set();
    const freedResolvers = new Set();
    const completedResolvers = new Set();
    let timeoutId = null;
    let bus = null;
    let completed = false;
    let allForNowReceived = false;
    let pendingResolvers = 0;

    // Buffer for signals received before we know our browser path
    const bufferedBrowserSignals = [];

    // Buffer for resolver signals received before the resolver path is tracked
    const bufferedResolverSignals = [];

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
        if (resolverFoundSignalId) {
          bus.signal_unsubscribe(resolverFoundSignalId);
          resolverFoundSignalId = null;
        }
        if (resolverFailureSignalId) {
          bus.signal_unsubscribe(resolverFailureSignalId);
          resolverFailureSignalId = null;
        }

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

    /**
     * Handles an ItemNew signal by creating a resolver for the discovered service.
     *
     * @param {Array} params - Signal parameters: [iface, protocol, name, type, domain]
     */
    const handleItemNew = (params) => {
      const [iface, protocol, name, type, domain] = params;

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

            // Track resolver for cleanup and signal filtering
            resolverPaths.add(resolverPath);

            // Process any buffered signals that arrived before we tracked this path
            processBufferedResolverSignals(resolverPath);
          } catch (e) {
            console.error(`[ElgatoLights] Failed to create resolver: ${e.message}`);
            pendingResolvers--;
            checkCompletion();
          }
        },
      );
    };

    /**
     * Handles an AllForNow signal indicating browsing is complete.
     */
    const handleAllForNow = () => {
      allForNowReceived = true;
      checkCompletion();
    };

    /**
     * Handles a browser Failure signal.
     *
     * @param {string} errorMsg - Error message from Avahi
     */
    const handleBrowserFailure = (errorMsg) => {
      complete(new Error(`Service browser failed: ${errorMsg}`));
    };

    /**
     * Handles a resolver Found signal with the resolved service details.
     *
     * @param {string} resolverPath - D-Bus path of the resolver
     * @param {Array} params - Signal parameters with service details
     */
    const handleResolverFound = (resolverPath, params) => {
      // Guard against duplicate signal delivery
      if (completedResolvers.has(resolverPath)) {
        return;
      }
      completedResolvers.add(resolverPath);

      // Found signal: (iissssisqaayu)
      // interface, protocol, name, type, domain, host, aprotocol, address, port, txt, flags
      const serviceName = params[2];
      const address = params[7];
      const port = params[8];

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
    };

    /**
     * Handles a resolver Failure signal.
     *
     * @param {string} resolverPath - D-Bus path of the resolver
     */
    const handleResolverFailure = (resolverPath) => {
      // Guard against duplicate signal delivery
      if (completedResolvers.has(resolverPath)) {
        return;
      }
      completedResolvers.add(resolverPath);

      freeResolver(resolverPath);
      pendingResolvers--;
      checkCompletion();
    };

    /**
     * Processes any buffered browser signals that match our browser path.
     */
    const processBufferedBrowserSignals = () => {
      for (const { signalName, path, params } of bufferedBrowserSignals) {
        if (path !== browserPath) continue;

        if (signalName === "ItemNew") {
          handleItemNew(params);
        } else if (signalName === "AllForNow") {
          handleAllForNow();
        } else if (signalName === "Failure") {
          handleBrowserFailure(params[0]);
        }
      }
      bufferedBrowserSignals.length = 0;
    };

    /**
     * Processes any buffered resolver signals that match the given resolver path.
     *
     * @param {string} resolverPath - D-Bus path of the resolver to process signals for
     */
    const processBufferedResolverSignals = (resolverPath) => {
      // Process buffered signals for this resolver path
      const remaining = [];
      for (const entry of bufferedResolverSignals) {
        if (entry.path === resolverPath) {
          if (entry.signalName === "Found") {
            handleResolverFound(entry.path, entry.params);
          } else if (entry.signalName === "Failure") {
            handleResolverFailure(entry.path);
          }
        } else {
          remaining.push(entry);
        }
      }
      bufferedResolverSignals.length = 0;
      bufferedResolverSignals.push(...remaining);
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

    // IMPORTANT: Subscribe to signals BEFORE creating the browser to avoid race condition.
    // Use null for object path to receive signals from any browser, then filter by our browserPath.

    // Subscribe to ItemNew signal (null path = wildcard)
    browserSignalId = bus.signal_subscribe(
      AVAHI_BUS_NAME,
      AVAHI_SERVICE_BROWSER_IFACE,
      "ItemNew",
      null, // Wildcard - receive from any browser
      null,
      platform.DbusSignalFlags.NONE,
      (_conn, _sender, path, _iface, _signal, params) => {
        if (completed) return;

        const unpacked = params.recursiveUnpack();
        if (browserPath === null) {
          // Buffer signal until we know our browser path
          bufferedBrowserSignals.push({ signalName: "ItemNew", path, params: unpacked });
        } else if (path === browserPath) {
          handleItemNew(unpacked);
        }
      },
    );

    // Subscribe to AllForNow signal (null path = wildcard)
    allForNowSignalId = bus.signal_subscribe(
      AVAHI_BUS_NAME,
      AVAHI_SERVICE_BROWSER_IFACE,
      "AllForNow",
      null, // Wildcard - receive from any browser
      null,
      platform.DbusSignalFlags.NONE,
      (_conn, _sender, path, _iface, _signal, _params) => {
        if (completed) return;

        if (browserPath === null) {
          // Buffer signal until we know our browser path
          bufferedBrowserSignals.push({ signalName: "AllForNow", path, params: [] });
        } else if (path === browserPath) {
          handleAllForNow();
        }
      },
    );

    // Subscribe to browser Failure signal (null path = wildcard)
    failureSignalId = bus.signal_subscribe(
      AVAHI_BUS_NAME,
      AVAHI_SERVICE_BROWSER_IFACE,
      "Failure",
      null, // Wildcard - receive from any browser
      null,
      platform.DbusSignalFlags.NONE,
      (_conn, _sender, path, _iface, _signal, params) => {
        if (completed) return;

        const unpacked = params.recursiveUnpack();
        if (browserPath === null) {
          // Buffer signal until we know our browser path
          bufferedBrowserSignals.push({ signalName: "Failure", path, params: unpacked });
        } else if (path === browserPath) {
          handleBrowserFailure(unpacked[0]);
        }
      },
    );

    // Subscribe to resolver Found signal (null path = wildcard)
    // Buffer signals for resolver paths we don't know yet, process for known paths
    resolverFoundSignalId = bus.signal_subscribe(
      AVAHI_BUS_NAME,
      AVAHI_SERVICE_RESOLVER_IFACE,
      "Found",
      null, // Wildcard - receive from any resolver
      null,
      platform.DbusSignalFlags.NONE,
      (_conn, _sender, path, _iface, _signal, params) => {
        if (completed) return;

        const unpacked = params.recursiveUnpack();
        if (resolverPaths.has(path)) {
          // Process immediately if we know this resolver
          handleResolverFound(path, unpacked);
        } else {
          // Buffer signal - resolver path may not be tracked yet due to race condition
          bufferedResolverSignals.push({ signalName: "Found", path, params: unpacked });
        }
      },
    );

    // Subscribe to resolver Failure signal (null path = wildcard)
    // Buffer signals for resolver paths we don't know yet, process for known paths
    resolverFailureSignalId = bus.signal_subscribe(
      AVAHI_BUS_NAME,
      AVAHI_SERVICE_RESOLVER_IFACE,
      "Failure",
      null, // Wildcard - receive from any resolver
      null,
      platform.DbusSignalFlags.NONE,
      (_conn, _sender, path, _iface, _signal, _params) => {
        if (completed) return;

        if (resolverPaths.has(path)) {
          // Process immediately if we know this resolver
          handleResolverFailure(path);
        } else {
          // Buffer signal - resolver path may not be tracked yet due to race condition
          bufferedResolverSignals.push({ signalName: "Failure", path, params: [] });
        }
      },
    );

    // Now create the service browser - signals may already be arriving
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

            // Process any buffered signals that arrived before we knew our path
            processBufferedBrowserSignals();
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
