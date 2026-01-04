/**
 * Mock GLib module for testing.
 */

export default {
  timeout_add: () => {
    throw new Error("Use platform.createTimeout() instead");
  },
  source_remove: () => {
    throw new Error("Use platform.removeTimeout() instead");
  },
  Variant: class Variant {
    constructor(signature, values) {
      this.signature = signature;
      this.values = values;
    }
  },
  VariantType: {
    new: (signature) => ({ signature }),
  },
  PRIORITY_DEFAULT: 0,
  SOURCE_REMOVE: false,
};
