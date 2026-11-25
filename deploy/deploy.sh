#!/usr/bin/env bash
# Build and start the local web-client container. Does not push an image or create a release.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEFAULT_PORT="${HOST_PORT:-21120}"
HOST_BIND="${HOST_BIND:-127.0.0.1}"
GATEWAY_TOKEN="${RUSTDESK_GATEWAY_TOKEN:-}"
CONTAINER_NAME="${CONTAINER_NAME:-rustdesk-web-client}"
USER_PORT_EXPLICIT=0

print_usage() {
  cat <<'EOF'
Usage: deploy/deploy.sh [options]

Options:
  -p, --port <PORT>      Host port (default: 21120; skips 21114-21119)
  -b, --bind <IP>        Host interface (default: 127.0.0.1)
  -t, --token <TOKEN>    Gateway token. Required. Not printed and not baked into the image.
  -n, --name <NAME>      Container name (default: rustdesk-web-client)
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port) DEFAULT_PORT="$2"; USER_PORT_EXPLICIT=1; shift 2 ;;
    -b|--bind) HOST_BIND="$2"; shift 2 ;;
    -t|--token) GATEWAY_TOKEN="$2"; shift 2 ;;
    -n|--name) CONTAINER_NAME="$2"; shift 2 ;;
    -h|--help) print_usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; print_usage; exit 1 ;;
  esac
done

if [[ -z "$GATEWAY_TOKEN" || "$GATEWAY_TOKEN" == "CHANGE_ME" || "$GATEWAY_TOKEN" == "PLACEHOLDER" ]]; then
  echo "[ERROR] Set a real RUSTDESK_GATEWAY_TOKEN. Production mode will not start without one." >&2
  exit 1
fi

if ! [[ "$DEFAULT_PORT" =~ ^[0-9]+$ ]] || (( DEFAULT_PORT < 1 || DEFAULT_PORT > 65535 )); then
  echo "[ERROR] Invalid port number: $DEFAULT_PORT" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker is not installed." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "[ERROR] Docker Compose is not available." >&2
  exit 1
fi

is_port_in_use() {
  local port="$1"
  if (( port >= 21114 && port <= 21119 )); then
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\])${port}$"; then
      return 0
    fi
  fi
  return 1
}

SELECTED_PORT="$DEFAULT_PORT"
if is_port_in_use "$SELECTED_PORT"; then
  echo "[WARN] Port ${SELECTED_PORT} is unavailable."
  if (( USER_PORT_EXPLICIT == 0 )); then
    echo "[INFO] Searching for the next free port."
  fi
  candidate=$(( SELECTED_PORT < 21120 ? 21120 : SELECTED_PORT + 1 ))
  found=0
  for (( i = 0; i < 100; i++ )); do
    if (( candidate > 65535 )); then
      break
    fi
    if ! is_port_in_use "$candidate"; then
      SELECTED_PORT="$candidate"
      found=1
      break
    fi
    candidate=$(( candidate + 1 ))
  done
  if (( found == 0 )); then
    echo "[ERROR] No free port found. Pass --port." >&2
    exit 1
  fi
  echo "[INFO] Using host port ${SELECTED_PORT}."
fi

ENV_FILE="$ROOT/deploy/.env.docker"
umask 077
cat > "$ENV_FILE" <<EOF
HOST_BIND=${HOST_BIND}
HOST_PORT=${SELECTED_PORT}
CONTAINER_NAME=${CONTAINER_NAME}
RUSTDESK_GATEWAY_TOKEN=${GATEWAY_TOKEN}
RUSTDESK_ALLOWED_ORIGINS=${RUSTDESK_ALLOWED_ORIGINS:-}
EOF
chmod 600 "$ENV_FILE"

echo "[INFO] Building the local image and starting ${CONTAINER_NAME}."
"${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml" up -d --build --remove-orphans

HEALTH_URL="http://127.0.0.1:${SELECTED_PORT}/api/health"
for (( i = 1; i <= 40; i++ )); do
  if command -v curl >/dev/null 2>&1 && curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[INFO] Health check passed at ${HEALTH_URL}."
    echo "[INFO] Token was written only to deploy/.env.docker and was not printed."
    exit 0
  fi
  sleep 1
done

echo "[ERROR] The container did not become healthy. Check: docker logs ${CONTAINER_NAME}" >&2
exit 1
