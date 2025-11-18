{
  description = "Hathor Playground - Node.js + Python Development Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    devshell.url = "github:numtide/devshell";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, flake-utils, devshell, nixpkgs, ... }:
    let
      overlays.default = final: prev: {
        nodejs = final.nodejs_24;
        nodePackages = prev.nodePackages;
      };
    in
    flake-utils.lib.eachDefaultSystem (system: {
      devShell =
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [
              devshell.overlays.default
              overlays.default
            ];
            # Always allow unfree here
            config = {
              allowUnfree = true;
            };
          };
        in
        pkgs.devshell.mkShell {
          packages = with pkgs; [
            # --- Core Languages & Package Managers ---
            nodejs_24
            yarn-berry
            python311
            poetry

            # --- Task Runners ---
            just

            # --- Code Quality ---
            nixpkgs-fmt # Nix formatting
            ruff # Python linting & formatting (fast!)

            # --- Debug & Development Utilities ---
            jq # JSON processor
            fx # Interactive JSON viewer
            httpie # Human-friendly HTTP client
            curlie # curl with httpie-like syntax

            # --- Database Clients ---
            redis # Redis CLI (server started manually)
            postgresql_16 # PostgreSQL client tools (psql)

            # --- Build Dependencies (for native modules) ---
            snappy
            openssl
            readline
            zlib
            xz
            bzip2
            lz4
            cmake
            gcc
            pkg-config
          ];

          devshell.startup.shell-hook.text = ''
            # Configure Poetry to use Python 3.11
            poetry env use python3.11

            # Quick Reference
            echo ""
            echo "╔════════════════════════════════════════════════════════╗"
            echo "║       Hathor Playground Development Environment       ║"
            echo "╚════════════════════════════════════════════════════════╝"
            echo ""
            echo "  Versions:"
            echo "    Node.js:  $(node --version)"
            echo "    Python:   $(python3 --version | cut -d' ' -f2)"
            echo "    Poetry:   $(poetry --version | cut -d' ' -f3)"
            echo ""
            echo "  Quick Commands (using just):"
            echo "    just install    Install dependencies"
            echo "    just dev        Start development"
            echo "    just test       Run tests"
            echo "    just fmt        Format code"
            echo "    just lint       Lint code"
            echo "    just clean      Clean artifacts"
            echo "    just redis      Start Redis server"
            echo ""
            echo "  Manual Services:"
            echo "    Redis:  just redis  (or: redis-server)"
            echo ""
            echo "  Type 'just' to see all available commands"
            echo ""
          '';
        };
    });
}
