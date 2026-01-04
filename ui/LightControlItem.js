/**
 * Per-light control item for the Elgato Lights extension.
 *
 * Displays individual light controls including toggle, brightness slider,
 * and color temperature slider in the Quick Settings menu.
 */

import GObject from "gi://GObject";
import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Temperature, Brightness } from "../elgatoApi.js";

/**
 * Per-light control item displayed in the Quick Settings menu.
 *
 * Provides a toggle button, brightness slider, and color temperature slider
 * for controlling an individual Elgato Key Light.
 */
const LightControlItem = GObject.registerClass(
  class LightControlItem extends PopupMenu.PopupBaseMenuItem {
    /**
     * Creates a new LightControlItem.
     *
     * @param {ElgatoLight} light - The light instance to control
     * @param {Function} onChanged - Callback invoked when light state changes
     */
    _init(light, onChanged) {
      super._init({
        activate: false,
        can_focus: false,
      });

      this._light = light;
      this._onChanged = onChanged;
      this._updating = false;

      // Track signals for cleanup
      this._signals = [];

      // Flag to track destroyed state for async operation safety
      this._destroyed = false;

      // Main container
      const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: "elgato-light-control",
      });
      this.add_child(box);

      // Header row: name + info button + toggle
      const headerBox = new St.BoxLayout({
        x_expand: true,
      });
      box.add_child(headerBox);

      this._nameLabel = new St.Label({
        text: light.displayName || light.name,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      headerBox.add_child(this._nameLabel);

      // Info button
      this._infoButton = new St.Button({
        style_class: "elgato-info-button",
        can_focus: true,
        child: new St.Icon({
          icon_name: "dialog-information-symbolic",
          icon_size: 16,
        }),
      });
      this._signals.push({
        obj: this._infoButton,
        id: this._infoButton.connect("clicked", () => this._onInfoClicked()),
      });
      headerBox.add_child(this._infoButton);

      this._toggle = new St.Button({
        style_class: "elgato-light-toggle",
        can_focus: true,
        child: new St.Icon({
          icon_name: "system-shutdown-symbolic",
          icon_size: 16,
        }),
      });
      this._signals.push({
        obj: this._toggle,
        id: this._toggle.connect("clicked", () => this._onToggleClicked()),
      });
      headerBox.add_child(this._toggle);

      // Info panel (hidden by default)
      this._infoBox = new St.BoxLayout({
        vertical: true,
        style_class: "elgato-info-panel",
        visible: false,
      });
      box.add_child(this._infoBox);

      // Brightness slider row
      const brightnessBox = new St.BoxLayout({
        x_expand: true,
        style_class: "elgato-slider-row",
      });
      box.add_child(brightnessBox);

      // Static brightness icon for the slider - represents the control concept,
      // not the on/off state (which is indicated by the toggle button)
      brightnessBox.add_child(
        new St.Icon({
          icon_name: "display-brightness-symbolic",
          icon_size: 16,
          style_class: "elgato-slider-icon",
        }),
      );

      this._brightnessSlider = new Slider.Slider(0.5);
      this._brightnessSlider.x_expand = true;
      this._signals.push({
        obj: this._brightnessSlider,
        id: this._brightnessSlider.connect("notify::value", () => this._onBrightnessChanged()),
      });
      brightnessBox.add_child(this._brightnessSlider);

      this._brightnessLabel = new St.Label({
        text: "50%",
        style_class: "elgato-slider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      brightnessBox.add_child(this._brightnessLabel);

      // Temperature slider row
      const tempBox = new St.BoxLayout({
        x_expand: true,
        style_class: "elgato-slider-row",
      });
      box.add_child(tempBox);

      tempBox.add_child(
        new St.Icon({
          icon_name: "weather-clear-symbolic",
          icon_size: 16,
          style_class: "elgato-slider-icon",
        }),
      );

      this._tempSlider = new Slider.Slider(0.5);
      this._tempSlider.x_expand = true;
      this._signals.push({
        obj: this._tempSlider,
        id: this._tempSlider.connect("notify::value", () => this._onTemperatureChanged()),
      });
      tempBox.add_child(this._tempSlider);

      this._tempLabel = new St.Label({
        text: "5000K",
        style_class: "elgato-slider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      tempBox.add_child(this._tempLabel);

      // Initial state update
      this.updateState();
    }

    /**
     * Updates the UI to reflect the current light state.
     */
    updateState() {
      this._updating = true;

      const light = this._light;

      // Update toggle appearance
      if (light.on) {
        this._toggle.add_style_class_name("on");
      } else {
        this._toggle.remove_style_class_name("on");
      }

      // Update sliders
      this._brightnessSlider.value = Brightness.toSlider(light.brightness);
      this._brightnessLabel.text = `${light.brightness}%`;

      this._tempSlider.value = Temperature.apiToSlider(light.temperature);
      this._tempLabel.text = `${Temperature.apiToKelvin(light.temperature)}K`;

      this._updating = false;
    }

    /**
     * Handles toggle button click.
     */
    async _onToggleClicked() {
      if (this._destroyed) return;

      try {
        await this._light.toggle();
        if (this._destroyed) return;
        this.updateState();
        this._onChanged?.();
      } catch (e) {
        if (!this._destroyed) {
          console.error(`[ElgatoLights] Failed to toggle light: ${e.message}`);
        }
      }
    }

    /**
     * Handles info button click - toggles the info panel visibility.
     */
    _onInfoClicked() {
      const isVisible = this._infoBox.visible;

      if (!isVisible) {
        // Populate info panel
        this._infoBox.destroy_all_children();

        const light = this._light;

        const addInfoRow = (label, value) => {
          if (value === null || value === undefined) {
            return;
          }
          const row = new St.BoxLayout({
            style_class: "elgato-info-row",
          });
          row.add_child(
            new St.Label({
              text: `${label}:`,
              style_class: "elgato-info-label",
            }),
          );
          row.add_child(
            new St.Label({
              text: String(value),
              style_class: "elgato-info-value",
              x_expand: true,
            }),
          );
          this._infoBox.add_child(row);
        };

        addInfoRow(_("Product"), light.productName);
        addInfoRow(_("Firmware"), light.firmwareVersion);
        addInfoRow(_("Serial"), light.serialNumber);
        addInfoRow(_("IP Address"), `${light.host}:${light.port}`);
      }

      this._infoBox.visible = !isVisible;
    }

    /**
     * Handles brightness slider changes with debouncing.
     */
    _onBrightnessChanged() {
      if (this._updating) {
        return;
      }

      const brightness = Brightness.fromSlider(this._brightnessSlider.value);
      this._brightnessLabel.text = `${brightness}%`;

      // Debounce the API call
      if (this._brightnessTimeout) {
        GLib.source_remove(this._brightnessTimeout);
      }
      this._brightnessTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        if (this._destroyed) return GLib.SOURCE_REMOVE;
        this._light.setBrightness(brightness).catch((e) => {
          console.error(`[ElgatoLights] Failed to set brightness: ${e.message}`);
        });
        this._brightnessTimeout = null;
        return GLib.SOURCE_REMOVE;
      });
    }

    /**
     * Handles temperature slider changes with debouncing.
     */
    _onTemperatureChanged() {
      if (this._updating) {
        return;
      }

      const temp = Temperature.sliderToApi(this._tempSlider.value);
      this._tempLabel.text = `${Temperature.apiToKelvin(temp)}K`;

      // Debounce the API call
      if (this._tempTimeout) {
        GLib.source_remove(this._tempTimeout);
      }
      this._tempTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        if (this._destroyed) return GLib.SOURCE_REMOVE;
        this._light.setTemperature(temp).catch((e) => {
          console.error(`[ElgatoLights] Failed to set temperature: ${e.message}`);
        });
        this._tempTimeout = null;
        return GLib.SOURCE_REMOVE;
      });
    }

    /**
     * Cleans up resources when the item is destroyed.
     */
    destroy() {
      // Mark as destroyed to stop in-flight async operations
      this._destroyed = true;

      // Disconnect tracked signals
      for (const signal of this._signals) {
        signal.obj.disconnect(signal.id);
      }
      this._signals = [];

      // Remove pending timeouts
      if (this._brightnessTimeout) {
        GLib.source_remove(this._brightnessTimeout);
        this._brightnessTimeout = null;
      }
      if (this._tempTimeout) {
        GLib.source_remove(this._tempTimeout);
        this._tempTimeout = null;
      }
      super.destroy();
    }
  },
);

export { LightControlItem };
