/**
 * System indicator for the Elgato Lights extension.
 *
 * Acts as a wrapper that manages the QuickMenuToggle and integrates it
 * properly into the GNOME Quick Settings panel.
 */

import GObject from "gi://GObject";

import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";

import { getLightbulbIcon } from "./icons.js";
import { ElgatoToggle } from "./ElgatoToggle.js";

/**
 * System indicator container for the Elgato Lights Quick Settings toggle.
 *
 * Acts as a wrapper that manages the QuickMenuToggle and integrates it
 * properly into the GNOME Quick Settings panel. All Quick Settings extensions
 * should use a SystemIndicator instance as a container.
 */
const ElgatoIndicator = GObject.registerClass(
  class ElgatoIndicator extends QuickSettings.SystemIndicator {
    /**
     * Creates the system indicator with the Elgato toggle.
     *
     * @param {Extension} extensionObject - The extension instance
     */
    _init(extensionObject) {
      super._init();

      // Add panel indicator (visible only when lights are on)
      this._indicator = this._addIndicator();
      this._indicator.visible = false;
      this._indicator.gicon = getLightbulbIcon(extensionObject.path, true);

      // Create and register the toggle with this indicator
      this._toggle = new ElgatoToggle(extensionObject, this);
      this.quickSettingsItems.push(this._toggle);
    }

    /**
     * Updates the panel indicator visibility based on light state.
     *
     * @param {boolean} anyLightOn - Whether any light is currently on
     */
    updateIndicator(anyLightOn) {
      this._indicator.visible = anyLightOn;
    }

    /**
     * Cleans up resources when the indicator is destroyed.
     */
    destroy() {
      this._toggle?.destroy();
      super.destroy();
    }
  },
);

export { ElgatoIndicator };
