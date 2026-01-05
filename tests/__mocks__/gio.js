/**
 * Mock Gio module for testing.
 */

export default {
  bus_get_sync: () => {
    throw new Error("Use platform.getSystemBus() instead");
  },
  BusType: {
    SYSTEM: 0,
    SESSION: 1,
  },
  DBusCallFlags: {
    NONE: 0,
  },
  DBusSignalFlags: {
    NONE: 0,
  },
};
