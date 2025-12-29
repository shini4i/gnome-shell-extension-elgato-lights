# Elgato Lights GNOME Shell Extension

A GNOME Shell extension that integrates Elgato Key Light controls into the Quick Settings panel.

## Features

- **Quick Toggle**: Turn all discovered lights on/off with a single click from Quick Settings
- **Per-Light Controls**: Individual brightness and color temperature sliders for each light
- **Auto-Discovery**: Automatically discovers Elgato lights on your network via mDNS
- **State Persistence**: Remembers discovered lights between sessions for faster startup
- **GNOME 47+ Support**: Built for modern GNOME Shell (47, 48, 49)

## Requirements

- GNOME Shell 47, 48, or 49
- `avahi-tools` package for mDNS discovery

### Installing avahi-tools

```bash
# Debian/Ubuntu
sudo apt install avahi-tools

# Fedora
sudo dnf install avahi-tools

# Arch Linux
sudo pacman -S avahi

# NixOS (add to configuration.nix)
services.avahi.enable = true;
```

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/shini4i/gnome-shell-extension-elgato-lights.git
   cd gnome-shell-extension-elgato-lights
   ```

2. Compile the GSettings schema:
   ```bash
   glib-compile-schemas schemas/
   ```

3. Create a symlink to the GNOME extensions directory:
   ```bash
   ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/elgato-lights@shini4i.github.io
   ```

4. Restart GNOME Shell:
   - **Wayland**: Log out and log back in
   - **X11**: Press `Alt+F2`, type `r`, press Enter

5. Enable the extension:
   ```bash
   gnome-extensions enable elgato-lights@shini4i.github.io
   ```

## Usage

Once enabled, you'll find a new "Lights" toggle in the Quick Settings panel (where WiFi, Bluetooth, etc. are located).

- **Main Toggle**: Click to turn all lights on or off
- **Expand Menu**: Click the arrow to access per-light controls
- **Refresh**: Click the refresh button to re-discover lights on your network
- **Brightness Slider**: Adjust brightness from 3% to 100%
- **Temperature Slider**: Adjust color temperature from 2900K (warm) to 7000K (cool)

## Development

### Prerequisites

This project uses [Nix](https://nixos.org/) with flakes for reproducible development environments.

```bash
# Enter the development shell
nix develop

# Or with direnv
direnv allow
```

### Available Tools

- `gjs` - GNOME JavaScript interpreter
- `glib-compile-schemas` - Schema compiler
- `avahi-browse` - mDNS discovery tool
- `node` / `npm` - JavaScript tooling

### Project Structure

```
.
├── extension.js          # Main extension entry point
├── elgatoApi.js          # HTTP client for Elgato REST API
├── discovery.js          # mDNS discovery via avahi-browse
├── stylesheet.css        # Custom UI styles
├── metadata.json         # Extension metadata
├── schemas/              # GSettings schema
│   └── org.gnome.shell.extensions.elgato-lights.gschema.xml
├── lib/                  # Testable utility modules
│   ├── conversions.js    # Temperature/brightness conversions
│   └── parser.js         # Avahi output parser
└── tests/                # Unit tests
    ├── conversions.test.js
    └── parser.test.js
```

### Running Tests

```bash
# Run tests once
npm test

# Watch mode
npm run test:watch

# With coverage report
npm run test:coverage
```

### Debugging

View extension logs:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i elgato
```

Test in a nested GNOME Shell session (Wayland):
```bash
dbus-run-session -- gnome-shell --nested --wayland
```

## Elgato Key Light API

The extension communicates with Elgato Key Lights via their REST API on port 9123.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/elgato/lights` | GET | Get current light state |
| `/elgato/lights` | PUT | Update light state |
| `/elgato/accessory-info` | GET | Get device information |

### Light State Properties

| Property | Range | Description |
|----------|-------|-------------|
| `on` | 0-1 | Light on/off state |
| `brightness` | 3-100 | Brightness percentage |
| `temperature` | 143-344 | Color temperature (143=7000K, 344=2900K) |

## Configuration

Settings are stored in GSettings and can be viewed/modified with:

```bash
# View all settings
gsettings list-recursively org.gnome.shell.extensions.elgato-lights

# View cached lights
gsettings get org.gnome.shell.extensions.elgato-lights cached-lights

# Enable/disable auto-discovery
gsettings set org.gnome.shell.extensions.elgato-lights auto-discover true
```

## Troubleshooting

### Lights not discovered

1. Ensure `avahi-tools` is installed
2. Check that Avahi daemon is running: `systemctl status avahi-daemon`
3. Verify lights are on the same network
4. Try manual discovery: `avahi-browse -t -r -p _elg._tcp`

### Extension not appearing

1. Check GNOME Shell version compatibility
2. Verify schema is compiled: `ls schemas/gschemas.compiled`
3. Check for errors: `journalctl -f -o cat /usr/bin/gnome-shell`

