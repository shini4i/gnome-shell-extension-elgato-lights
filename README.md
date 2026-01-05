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
- `avahi-daemon` running (typically pre-installed on most Linux distributions)

## Installation

### NixOS

Add the flake input to your `flake.nix`:

```nix
{
  inputs = {
    shini4i-pkgs = {
      url = "github:shini4i/nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
```

Then add the package to your configuration:

```nix
environment.systemPackages = [
  inputs.shini4i-pkgs.packages.${pkgs.system}.gnome-shell-extension-elgato-lights
];
```

### From Source

```bash
git clone https://github.com/shini4i/gnome-shell-extension-elgato-lights.git
cd gnome-shell-extension-elgato-lights
glib-compile-schemas schemas/
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/elgato-lights@shini4i.github.io
```

After installation, restart GNOME Shell (log out/in on Wayland, or `Alt+F2` → `r` on X11) and enable the extension:

```bash
gnome-extensions enable elgato-lights@shini4i.github.io
```

## Usage

Once enabled, find the "Lights" toggle in Quick Settings panel:

- **Main Toggle**: Turn all lights on/off
- **Expand Menu**: Access per-light brightness (3-100%) and temperature (2900K-7000K) controls
- **Refresh**: Re-discover lights on your network

## Development

```bash
# Enter development shell
nix develop

# Run tests
npm test
```

## Troubleshooting

### Lights not discovered

1. Ensure `avahi-daemon` is running: `systemctl status avahi-daemon`
2. Verify lights are on the same network as your computer
3. Test mDNS discovery manually: `avahi-browse -t -r -p _elg._tcp` (requires `avahi-tools`)

### Extension not appearing

1. Verify GNOME Shell version compatibility
2. Check schema is compiled: `ls schemas/gschemas.compiled`
3. Check logs: `journalctl -f -o cat /usr/bin/gnome-shell | grep -i elgato`
