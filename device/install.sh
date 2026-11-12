#!/usr/bin/env bash
# SmartRoute Guardian gateway - install into this directory.
#
#   ./install.sh
#
# Creates .venv, installs the requirements and creates config.json from the
# example if it does not exist yet. It does NOT install or start the systemd
# service - it prints the commands for that, to run once config.json is ready.
set -euo pipefail

cd "$(dirname "$0")"
DIR="$(pwd)"
PYTHON="${PYTHON:-python3}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the user the gateway should run as (not root / sudo)." >&2
  exit 1
fi

if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "Python 3.9 or newer is required ($PYTHON is $("$PYTHON" --version 2>&1))." >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Creating virtual environment in $DIR/.venv"
  "$PYTHON" -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
echo "Installed: $(.venv/bin/pip freeze | grep -iE '^(pyserial|requests)==' | tr '\n' ' ')"

if [ ! -f config.json ]; then
  cp config.example.json config.json
  chmod 600 config.json # holds the device account password
  echo "Created config.json from config.example.json"
else
  echo "Keeping existing config.json"
fi

USER_NAME="$(id -un)"
cat <<EOF

Next steps
----------
1. Edit config.json: device.password (and email / deviceId / vehicleId),
   reader.port and gps.port. See README.md -> Configuration.

2. Allow serial access (then log out and back in):
     sudo usermod -aG dialout $USER_NAME

3. Check the hardware without touching Firebase:
     .venv/bin/python -m smartroute_gateway.tools.scan --config config.json --info
     .venv/bin/python -m smartroute_gateway.tools.scan --config config.json
     .venv/bin/python -m smartroute_gateway --config config.json --dry-run

4. Run it for real in the foreground (Ctrl+C to stop):
     .venv/bin/python -m smartroute_gateway --config config.json

5. Install and start the service:
     sed -e "s|@DEVICE_DIR@|$DIR|g" -e "s|@USER@|$USER_NAME|g" systemd/smartroute-gateway.service \\
       | sudo tee /etc/systemd/system/smartroute-gateway.service >/dev/null
     sudo systemctl daemon-reload
     sudo systemctl enable --now smartroute-gateway
     journalctl -u smartroute-gateway -f
EOF
