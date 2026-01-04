/**
 * Icon utilities for the Elgato Lights extension.
 *
 * Provides helper functions and constants for loading lightbulb icons,
 * with fallback to bundled SVGs when system theme doesn't provide them.
 */

import St from "gi://St";
import Gio from "gi://Gio";

export const ICON_PATH = "/icons/hicolor/scalable/status/";
export const LIGHTBULB_ON_ICON = "lightbulb-on-symbolic";
export const LIGHTBULB_OFF_ICON = "lightbulb-off-symbolic";

/**
 * Gets the lightbulb icon based on state, falling back to bundled SVG if not in system theme.
 *
 * @param {string} extensionPath - The extension's base path
 * @param {boolean} isOn - Whether to return the "on" icon (with rays) or "off" icon
 * @returns {Gio.Icon} The icon to use
 */
export function getLightbulbIcon(extensionPath, isOn = false) {
  const iconName = isOn ? LIGHTBULB_ON_ICON : LIGHTBULB_OFF_ICON;
  const iconTheme = new St.IconTheme();
  if (iconTheme.has_icon(iconName)) {
    return Gio.ThemedIcon.new(iconName);
  }
  return Gio.icon_new_for_string(`${extensionPath}${ICON_PATH}${iconName}.svg`);
}
