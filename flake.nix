{
  description = "Development environment for GNOME Shell Elgato Lights extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Wrap bump-my-version to isolate its Python environment
        # This prevents it from polluting PYTHONPATH and breaking other Python tools (e.g., serena MCP)
        bump-my-version-wrapped = pkgs.writeShellScriptBin "bump-my-version" ''
          exec ${pkgs.bump-my-version}/bin/bump-my-version "$@"
        '';
      in
      {
        devShells.default = pkgs.mkShell {
          name = "gnome-extension-dev";

          buildInputs = with pkgs; [
            # GNOME JavaScript runtime
            gjs

            # GLib for schema compilation (glib-compile-schemas)
            glib

            # Avahi for mDNS discovery (avahi-browse command)
            avahi

            # GNOME Shell (includes gnome-extensions CLI)
            gnome-shell

            # Node.js for development tooling (eslint, prettier)
            nodejs_24

            # TypeScript for type checking (optional, useful for GJS)
            typescript

            # An automation for bumping version in the project (wrapped to isolate Python env)
            bump-my-version-wrapped

            # Task runner
            go-task

            # Pre-commit hooks
            pre-commit
          ];

          shellHook = ''
            echo "GNOME Shell Extension Development Environment"
            echo "============================================="
            echo ""
            echo "Available tools:"
            echo "  - gjs: GNOME JavaScript interpreter"
            echo "  - glib-compile-schemas: Compile GSettings schemas"
            echo "  - avahi-browse: mDNS service discovery"
            echo "  - gnome-extensions: Extension management CLI"
            echo "  - node/npm: JavaScript tooling"
            echo ""
            echo "Useful commands:"
            echo "  glib-compile-schemas schemas/"
            echo "  gnome-extensions enable elgato-lights@shini4i.github.io"
            echo "  journalctl -f -o cat /usr/bin/gnome-shell | grep -i elgato"
            echo ""
          '';
        };
      }
    );
}
