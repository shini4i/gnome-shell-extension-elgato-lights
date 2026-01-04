/**
 * Elgato Lights GNOME Shell Extension
 *
 * Integrates Elgato Key Light controls into the GNOME Quick Settings panel.
 * Provides auto-discovery via mDNS and per-light controls for brightness
 * and color temperature.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { ElgatoIndicator } from "./ui/ElgatoIndicator.js";

/**
 * Main extension entry point.
 *
 * Manages the lifecycle of the Elgato Lights Quick Settings integration.
 */
export default class ElgatoLightsExtension extends Extension {
  /**
   * Called when the extension is enabled.
   * Creates and adds the indicator to Quick Settings.
   */
  enable() {
    this._indicator = new ElgatoIndicator(this);

    // Add to Quick Settings panel
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
  }

  /**
   * Called when the extension is disabled.
   * Removes and destroys the indicator.
   */
  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
