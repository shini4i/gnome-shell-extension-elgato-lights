/**
 * Main Quick Settings toggle for Elgato Lights.
 *
 * Displays in the GNOME Quick Settings panel alongside WiFi, Bluetooth, etc.
 * The main toggle controls all lights on/off, and the expanded menu shows
 * per-light controls.
 */

import GObject from "gi://GObject";
import St from "gi://St";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { ElgatoLight } from "../elgatoApi.js";
import { discoverLights, isAvahiAvailable } from "../discovery.js";
import { parseCachedLights } from "../lib/parser.js";

import { getLightbulbIcon } from "./icons.js";
import { LightControlItem } from "./LightControlItem.js";

const ElgatoToggle = GObject.registerClass(
  class ElgatoToggle extends QuickSettings.QuickMenuToggle {
    /**
     * Creates the main Elgato toggle for Quick Settings.
     *
     * @param {Extension} extensionObject - The extension instance
     * @param {ElgatoIndicator} indicator - The parent system indicator for panel icon updates
     */
    _init(extensionObject, indicator) {
      // Store indicator reference for panel icon updates
      this._panelIndicator = indicator;

      // Get icons with fallback to bundled SVGs
      this._iconOn = getLightbulbIcon(extensionObject.path, true);
      this._iconOff = getLightbulbIcon(extensionObject.path, false);

      super._init({
        title: _("Lights"),
        subtitle: _("Elgato"),
        gicon: this._iconOff,
        toggleMode: true,
      });

      this._extensionObject = extensionObject;
      this._settings = extensionObject.getSettings();
      this._lights = [];
      this._lightItems = [];

      // Track signal IDs for cleanup
      this._signalIds = [];

      // Menu header with refresh button
      this.menu.setHeader(this._iconOff, _("Elgato Lights"), _("Control your Key Lights"));

      // Add refresh button to header
      this._refreshButton = new St.Button({
        style_class: "button elgato-refresh-button",
        can_focus: true,
        child: new St.Icon({
          icon_name: "view-refresh-symbolic",
          icon_size: 16,
        }),
      });
      this._refreshButtonSignalId = this._refreshButton.connect("clicked", () =>
        this._onRefreshClicked(),
      );
      this.menu.addHeaderSuffix(this._refreshButton);

      // Status item (shown when no lights found)
      this._statusItem = new PopupMenu.PopupMenuItem(_("No lights found"), {
        reactive: false,
      });
      this.menu.addMenuItem(this._statusItem);

      // Separator before light controls
      this._separator = new PopupMenu.PopupSeparatorMenuItem();
      this.menu.addMenuItem(this._separator);
      this._separator.visible = false;

      // Connect toggle click and track signal ID
      this._signalIds.push(this.connect("clicked", () => this._onToggleClicked()));

      // Initialize asynchronously (load cache first, then discover)
      this._initializeAsync();
    }

    /**
     * Initializes lights asynchronously to avoid race conditions.
     * Loads cached lights first, then runs discovery.
     * @private
     */
    async _initializeAsync() {
      try {
        await this._loadCachedLights();
        await this._discoverLights();
      } catch (e) {
        console.error(`[ElgatoLights] Initialization failed: ${e.message}`);
      }
    }

    /**
     * Loads previously discovered lights from GSettings cache.
     * Fetches current state from each light to display actual values.
     */
    async _loadCachedLights() {
      const cached = this._settings.get_string("cached-lights");
      const lightsData = parseCachedLights(cached);

      if (lightsData.length > 0) {
        this._createLightsFromData(lightsData);
        await this._refreshLightStates();
      }
    }

    /**
     * Saves discovered lights to GSettings cache for faster startup.
     */
    _saveCachedLights() {
      try {
        const data = this._lights.map((l) => ({
          name: l.name,
          host: l.host,
          port: l.port,
        }));
        this._settings.set_string("cached-lights", JSON.stringify(data));
      } catch (e) {
        console.error(`[ElgatoLights] Failed to save cached lights: ${e.message}`);
      }
    }

    /**
     * Creates ElgatoLight instances from serialized data.
     *
     * @param {Array} lightsData - Array of light configuration objects
     */
    _createLightsFromData(lightsData) {
      // Clear existing
      this._lights = [];
      for (const item of this._lightItems) {
        item.destroy();
      }
      this._lightItems = [];

      // Create new lights
      for (const data of lightsData) {
        const light = new ElgatoLight(data.name, data.host, data.port);
        this._lights.push(light);
      }

      this._updateUI();
    }

    /**
     * Performs mDNS discovery to find Elgato lights on the network.
     */
    async _discoverLights() {
      this._statusItem.label.text = _("Discovering...");

      try {
        if (!(await isAvahiAvailable())) {
          this._statusItem.label.text = _("avahi-tools not installed");
          return;
        }

        const discovered = await discoverLights();

        if (discovered.length === 0) {
          this._statusItem.label.text = _("No lights found");
          this._statusItem.visible = true;
          return;
        }

        this._createLightsFromData(discovered);
        this._saveCachedLights();

        // Fetch actual state and display names
        await this._refreshLightStates();
      } catch (e) {
        console.error(`[ElgatoLights] Discovery failed: ${e.message}`);
        this._statusItem.label.text = _("Discovery failed");
      }
    }

    /**
     * Refreshes the state of all discovered lights from their devices.
     * Uses Promise.allSettled to allow partial updates when some lights are unreachable.
     */
    async _refreshLightStates() {
      const promises = this._lights.map(async (light) => {
        try {
          await light.fetchInfo();
          await light.fetchState();
        } catch (e) {
          console.error(`[ElgatoLights] Failed to refresh ${light.name}: ${e.message}`);
        }
      });

      await Promise.allSettled(promises);
      this._updateUI();
    }

    /**
     * Updates the menu UI based on current light state.
     */
    _updateUI() {
      // Clear existing items
      for (const item of this._lightItems) {
        item.destroy();
      }
      this._lightItems = [];

      if (this._lights.length === 0) {
        this._statusItem.visible = true;
        this._statusItem.label.text = _("No lights found");
        this._separator.visible = false;
        this.subtitle = _("No lights");
        return;
      }

      this._statusItem.visible = false;
      this._separator.visible = true;

      // Create control items for each light
      for (const light of this._lights) {
        const item = new LightControlItem(
          light,
          () => this._updateToggleState(),
          this._extensionObject.path,
        );
        this.menu.addMenuItem(item);
        this._lightItems.push(item);
      }

      this._updateToggleState();
    }

    /**
     * Updates the main toggle state and subtitle based on light states.
     */
    _updateToggleState() {
      // Toggle is "on" if any light is on
      const anyOn = this._lights.some((l) => l.on);
      this.checked = anyOn;

      // Update icons based on state
      this._updateIcon(anyOn);

      // Update subtitle
      const onCount = this._lights.filter((l) => l.on).length;
      if (onCount === 0) {
        this.subtitle = _("All off");
      } else if (onCount === this._lights.length) {
        this.subtitle = _("All on");
      } else {
        this.subtitle = _("%d of %d on").format(onCount, this._lights.length);
      }
    }

    /**
     * Updates the toggle and menu header icons based on light state.
     * Also notifies the panel indicator to show/hide.
     *
     * @param {boolean} anyOn - Whether any light is currently on
     */
    _updateIcon(anyOn) {
      const icon = anyOn ? this._iconOn : this._iconOff;
      this.gicon = icon;

      // Update menu header icon
      this.menu.setHeader(icon, _("Elgato Lights"), _("Control your Key Lights"));

      // Notify panel indicator to show/hide
      this._panelIndicator?.updateIndicator(anyOn);
    }

    /**
     * Handles main toggle click - turns all lights on or off.
     * Uses Promise.allSettled to allow partial success when some lights are unreachable.
     */
    async _onToggleClicked() {
      if (this._lights.length === 0) {
        return;
      }

      // If any light is on, turn all off. Otherwise turn all on.
      const anyOn = this._lights.some((l) => l.on);
      const targetState = !anyOn;

      const promises = this._lights.map(async (light) => {
        try {
          targetState ? await light.turnOn() : await light.turnOff();
        } catch (e) {
          console.error(`[ElgatoLights] Failed to toggle ${light.name}: ${e.message}`);
        }
      });

      await Promise.allSettled(promises);

      // Update UI for all lights (including those that succeeded)
      for (const item of this._lightItems) {
        item.updateState();
      }
      this._updateToggleState();
    }

    /**
     * Handles refresh button click - re-runs discovery.
     * Disables the button during discovery to prevent concurrent operations.
     */
    async _onRefreshClicked() {
      if (this._refreshButton) {
        this._refreshButton.reactive = false;
      }
      try {
        await this._discoverLights();
      } catch (e) {
        console.error(`[ElgatoLights] Failed to refresh lights: ${e.message}`);
      } finally {
        if (this._refreshButton) {
          this._refreshButton.reactive = true;
        }
      }
    }

    /**
     * Cleans up resources when the toggle is destroyed.
     */
    destroy() {
      // Disconnect tracked signals
      for (const id of this._signalIds) {
        this.disconnect(id);
      }
      this._signalIds = [];

      // Disconnect refresh button signal
      if (this._refreshButton && this._refreshButtonSignalId) {
        this._refreshButton.disconnect(this._refreshButtonSignalId);
        this._refreshButtonSignalId = null;
      }

      for (const item of this._lightItems) {
        item.destroy();
      }
      super.destroy();
    }
  },
);

export { ElgatoToggle };
