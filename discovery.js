/**
 * mDNS discovery module for Elgato Key Light devices.
 *
 * Uses avahi-browse to discover Elgato lights on the local network
 * via their advertised _elg._tcp mDNS service.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

// Import parser from lib (testable without GI dependencies)
import { parseAvahiOutput } from "./lib/parser.js";

const AVAHI_TIMEOUT_MS = 5000;

/**
 * Discovers Elgato Key Light devices on the local network using mDNS.
 *
 * Runs avahi-browse to find devices advertising the _elg._tcp service type.
 * Returns a promise that resolves with an array of discovered light objects.
 *
 * @returns {Promise<Array<{name: string, host: string, port: number}>>}
 *          Array of discovered light objects with name, host (IP), and port
 * @throws {Error} If avahi-browse fails or is not installed
 */
export async function discoverLights() {
  return new Promise((resolve, reject) => {
    try {
      const proc = Gio.Subprocess.new(
        ["avahi-browse", "-t", "-r", "-p", "_elg._tcp"],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      );

      // Set up timeout
      const timeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        AVAHI_TIMEOUT_MS,
        () => {
          proc.force_exit();
          return GLib.SOURCE_REMOVE;
        },
      );

      proc.communicate_utf8_async(null, null, (proc, result) => {
        GLib.source_remove(timeoutId);

        try {
          const [ok, stdout] = proc.communicate_utf8_finish(result);

          if (!ok) {
            reject(new Error("avahi-browse failed"));
            return;
          }

          const lights = parseAvahiOutput(stdout);
          resolve(lights);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(
        new Error(
          `Failed to run avahi-browse: ${e.message}. Is avahi-tools installed?`,
        ),
      );
    }
  });
}

/**
 * Checks if avahi-browse command is available on the system.
 *
 * This is required for mDNS discovery to work. If not available,
 * users will need to configure lights manually.
 *
 * @returns {Promise<boolean>} True if avahi-browse is available, false otherwise
 */
export async function isAvahiAvailable() {
  return new Promise((resolve) => {
    try {
      const proc = Gio.Subprocess.new(
        ["which", "avahi-browse"],
        Gio.SubprocessFlags.STDOUT_PIPE,
      );
      proc.wait_async(null, (proc, result) => {
        try {
          proc.wait_finish(result);
          resolve(proc.get_successful());
        } catch {
          resolve(false);
        }
      });
    } catch {
      resolve(false);
    }
  });
}
