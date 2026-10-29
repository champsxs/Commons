#!/bin/sh
# Installs the commons CLI from __BASE__ (macOS and Linux).
# It installs a standalone program for this computer, so Node.js isn't needed.
# COMMONS_INSTALL=node installs the Node.js version instead (needs Node 22+).
set -e

BASE="__BASE__"
DIR="$HOME/.commons/bin"
mkdir -p "$DIR"

case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) OS=other ;; esac
case "$(uname -m)" in arm64 | aarch64) ARCH=arm64 ;; x86_64 | amd64) ARCH=x64 ;; *) ARCH=other ;; esac

install_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "There's no standalone commons for $OS-$ARCH, and the Node.js version needs Node.js 22 or newer: https://nodejs.org" >&2
    exit 1
  fi
  if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    echo "commons needs Node.js 22 or newer (you have $(node -v))" >&2
    exit 1
  fi
  curl -fsSL "$BASE/cli/commons.mjs" -o "$DIR/commons.tmp"
}

if [ "${COMMONS_INSTALL:-}" = "node" ]; then
  install_node_version
elif curl -fsSL "$BASE/cli/download/$OS-$ARCH" -o "$DIR/commons.tmp" 2>/dev/null; then
  :
else
  echo "No standalone build for $OS-$ARCH on this server; installing the Node.js version." >&2
  install_node_version
fi
chmod +x "$DIR/commons.tmp"
mv "$DIR/commons.tmp" "$DIR/commons"

# Remember which Commons this came from, so `commons login` needs no address
if [ ! -f "$HOME/.commons/config.json" ]; then
  printf '{ "url": "%s" }\n' "$BASE" > "$HOME/.commons/config.json"
  chmod 600 "$HOME/.commons/config.json"
fi

# Link into a folder that's already on PATH when there is a writable one
LINKED=""
for d in "$HOME/.local/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  case ":$PATH:" in
    *":$d:"*)
      if [ -d "$d" ] && [ -w "$d" ]; then
        ln -sf "$DIR/commons" "$d/commons"
        LINKED="$d"
        break
      fi
      ;;
  esac
done

echo "Installed commons $("$DIR/commons" --version) to $DIR/commons"
if [ -n "$LINKED" ]; then
  echo "Linked into $LINKED"
else
  echo "Add it to your PATH, e.g. in ~/.zshrc:"
  echo "  export PATH=\"$DIR:\$PATH\""
fi
echo ""
echo "Next: commons login"
