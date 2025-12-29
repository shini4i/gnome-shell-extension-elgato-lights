/**
 * Elgato Lights GNOME Shell Extension
 *
 * Integrates Elgato Key Light controls into the GNOME Quick Settings panel.
 * Provides auto-discovery via mDNS and per-light controls for brightness
 * and color temperature.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ElgatoLight, Temperature, Brightness} from './elgatoApi.js';
import {discoverLights, isAvahiAvailable} from './discovery.js';

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

        // Main container
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'elgato-light-control',
        });
        this.add_child(box);

        // Header row: name + toggle
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

        this._toggle = new St.Button({
            style_class: 'elgato-light-toggle',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'system-shutdown-symbolic',
                icon_size: 16,
            }),
        });
        this._toggle.connect('clicked', () => this._onToggleClicked());
        headerBox.add_child(this._toggle);

        // Brightness slider row
        const brightnessBox = new St.BoxLayout({
            x_expand: true,
            style_class: 'elgato-slider-row',
        });
        box.add_child(brightnessBox);

        brightnessBox.add_child(new St.Icon({
            icon_name: 'lightbulb-symbolic',
            icon_size: 16,
            style_class: 'elgato-slider-icon',
        }));

        this._brightnessSlider = new Slider.Slider(0.5);
        this._brightnessSlider.x_expand = true;
        this._brightnessSlider.connect('notify::value', () => this._onBrightnessChanged());
        brightnessBox.add_child(this._brightnessSlider);

        this._brightnessLabel = new St.Label({
            text: '50%',
            style_class: 'elgato-slider-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        brightnessBox.add_child(this._brightnessLabel);

        // Temperature slider row
        const tempBox = new St.BoxLayout({
            x_expand: true,
            style_class: 'elgato-slider-row',
        });
        box.add_child(tempBox);

        tempBox.add_child(new St.Icon({
            icon_name: 'weather-clear-symbolic',
            icon_size: 16,
            style_class: 'elgato-slider-icon',
        }));

        this._tempSlider = new Slider.Slider(0.5);
        this._tempSlider.x_expand = true;
        this._tempSlider.connect('notify::value', () => this._onTemperatureChanged());
        tempBox.add_child(this._tempSlider);

        this._tempLabel = new St.Label({
            text: '5000K',
            style_class: 'elgato-slider-label',
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
            this._toggle.add_style_class_name('on');
        } else {
            this._toggle.remove_style_class_name('on');
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
        await this._light.toggle();
        this.updateState();
        this._onChanged?.();
    }

    /**
     * Handles brightness slider changes with debouncing.
     */
    async _onBrightnessChanged() {
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
            this._light.setBrightness(brightness);
            this._brightnessTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Handles temperature slider changes with debouncing.
     */
    async _onTemperatureChanged() {
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
            this._light.setTemperature(temp);
            this._tempTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Cleans up resources when the item is destroyed.
     */
    destroy() {
        if (this._brightnessTimeout) {
            GLib.source_remove(this._brightnessTimeout);
        }
        if (this._tempTimeout) {
            GLib.source_remove(this._tempTimeout);
        }
        super.destroy();
    }
});

/**
 * Main Quick Settings toggle for Elgato Lights.
 *
 * Displays in the GNOME Quick Settings panel alongside WiFi, Bluetooth, etc.
 * The main toggle controls all lights on/off, and the expanded menu shows
 * per-light controls.
 */
const ElgatoToggle = GObject.registerClass(
class ElgatoToggle extends QuickSettings.QuickMenuToggle {
    /**
     * Creates the main Elgato toggle for Quick Settings.
     *
     * @param {Extension} extensionObject - The extension instance
     */
    _init(extensionObject) {
        super._init({
            title: _('Lights'),
            subtitle: _('Elgato'),
            iconName: 'lightbulb-symbolic',
            toggleMode: true,
        });

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();
        this._lights = [];
        this._lightItems = [];

        // Menu header with refresh button
        this.menu.setHeader(
            'lightbulb-symbolic',
            _('Elgato Lights'),
            _('Control your Key Lights')
        );

        // Add refresh button to header
        const refreshButton = new St.Button({
            style_class: 'button elgato-refresh-button',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 16,
            }),
        });
        refreshButton.connect('clicked', () => this._onRefreshClicked());
        this.menu.addHeaderSuffix(refreshButton);

        // Status item (shown when no lights found)
        this._statusItem = new PopupMenu.PopupMenuItem(_('No lights found'), {
            reactive: false,
        });
        this.menu.addMenuItem(this._statusItem);

        // Separator before light controls
        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separator);
        this._separator.visible = false;

        // Connect toggle click
        this.connect('clicked', () => this._onToggleClicked());

        // Initial discovery
        this._loadCachedLights();
        this._discoverLights();
    }

    /**
     * Loads previously discovered lights from GSettings cache.
     * Fetches current state from each light to display actual values.
     */
    async _loadCachedLights() {
        try {
            const cached = this._settings.get_string('cached-lights');
            if (cached) {
                const lightsData = JSON.parse(cached);
                this._createLightsFromData(lightsData);

                // Fetch actual current state from cached lights
                if (this._lights.length > 0) {
                    await this._refreshLightStates();
                }
            }
        } catch (e) {
            console.error(`[ElgatoLights] Failed to load cached lights: ${e.message}`);
        }
    }

    /**
     * Saves discovered lights to GSettings cache for faster startup.
     */
    _saveCachedLights() {
        try {
            const data = this._lights.map(l => ({
                name: l.name,
                host: l.host,
                port: l.port,
            }));
            this._settings.set_string('cached-lights', JSON.stringify(data));
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
        this._statusItem.label.text = _('Discovering...');

        try {
            if (!isAvahiAvailable()) {
                this._statusItem.label.text = _('avahi-tools not installed');
                return;
            }

            const discovered = await discoverLights();

            if (discovered.length === 0) {
                this._statusItem.label.text = _('No lights found');
                this._statusItem.visible = true;
                return;
            }

            this._createLightsFromData(discovered);
            this._saveCachedLights();

            // Fetch actual state and display names
            await this._refreshLightStates();
        } catch (e) {
            console.error(`[ElgatoLights] Discovery failed: ${e.message}`);
            this._statusItem.label.text = _('Discovery failed');
        }
    }

    /**
     * Refreshes the state of all discovered lights from their devices.
     */
    async _refreshLightStates() {
        const promises = this._lights.map(async light => {
            await light.fetchInfo();
            await light.fetchState();
        });

        await Promise.all(promises);
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
            this._statusItem.label.text = _('No lights found');
            this._separator.visible = false;
            this.subtitle = _('No lights');
            return;
        }

        this._statusItem.visible = false;
        this._separator.visible = true;

        // Create control items for each light
        for (const light of this._lights) {
            const item = new LightControlItem(light, () => this._updateToggleState());
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
        const anyOn = this._lights.some(l => l.on);
        this.checked = anyOn;

        // Update subtitle
        const onCount = this._lights.filter(l => l.on).length;
        if (onCount === 0) {
            this.subtitle = _('All off');
        } else if (onCount === this._lights.length) {
            this.subtitle = _('All on');
        } else {
            this.subtitle = _('%d of %d on').format(onCount, this._lights.length);
        }
    }

    /**
     * Handles main toggle click - turns all lights on or off.
     */
    async _onToggleClicked() {
        if (this._lights.length === 0) {
            return;
        }

        // If any light is on, turn all off. Otherwise turn all on.
        const anyOn = this._lights.some(l => l.on);
        const targetState = !anyOn;

        const promises = this._lights.map(light =>
            targetState ? light.turnOn() : light.turnOff()
        );

        await Promise.all(promises);

        // Update UI
        for (const item of this._lightItems) {
            item.updateState();
        }
        this._updateToggleState();
    }

    /**
     * Handles refresh button click - re-runs discovery.
     */
    async _onRefreshClicked() {
        await this._discoverLights();
    }

    /**
     * Cleans up resources when the toggle is destroyed.
     */
    destroy() {
        for (const item of this._lightItems) {
            item.destroy();
        }
        super.destroy();
    }
});

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

        // Create and register the toggle with this indicator
        this._toggle = new ElgatoToggle(extensionObject);
        this.quickSettingsItems.push(this._toggle);
    }

    /**
     * Cleans up resources when the indicator is destroyed.
     */
    destroy() {
        this._toggle?.destroy();
        super.destroy();
    }
});

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
        // Add custom icons path to icon theme
        const iconTheme = St.IconTheme.get_for_display(null);
        const iconsPath = GLib.build_filenamev([this.path, 'icons']);
        if (!iconTheme.get_search_path().includes(iconsPath)) {
            iconTheme.add_search_path(iconsPath);
        }
        this._iconsPath = iconsPath;

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

        // Remove custom icons path from icon theme
        if (this._iconsPath) {
            const iconTheme = St.IconTheme.get_for_display(null);
            const searchPath = iconTheme.get_search_path().filter(p => p !== this._iconsPath);
            iconTheme.set_search_path(searchPath);
            this._iconsPath = null;
        }
    }
}
