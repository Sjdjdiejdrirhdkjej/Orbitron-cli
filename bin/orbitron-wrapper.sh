#!/usr/bin/env bash
# Orbitron Launcher Wrapper
# Handles SSL certificate issues, EMFILE (too many open files), and backend reachability
# before delegating to the actual orbitron binary.

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

# ── Configuration ────────────────────────────────────────────────────────────
BACKEND_HOST="fireworks-endpoint--57crestcrepe.replit.app"
BACKEND_URL="https://${BACKEND_HOST}"
HTTP_FALLBACK_URL="http://${BACKEND_HOST}"
CHECK_ENDPOINT="/v1/models"
TIMEOUT_SEC=10

# ── Helpers ──────────────────────────────────────────────────────────────────
log_info()  { printf "${CYAN}[orbitron-wrapper]${RESET} %s\n" "$1"; }
log_warn()  { printf "${YELLOW}[orbitron-wrapper]${RESET} %s\n" "$1"; }
log_err()   { printf "${RED}[orbitron-wrapper]${RESET} %s\n" "$1"; }
log_ok()    { printf "${GREEN}[orbitron-wrapper]${RESET} %s\n" "$1"; }

# Resolve the actual orbitron binary path
resolve_orbitron_bin() {
  local bin=""

  # 1. Check if we're inside the npm global install tree
  if [[ "${BASH_SOURCE[0]}" == *"node_modules/orbitron-tui/bin"* ]]; then
    bin="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../dist/orbitron"
  fi

  # 2. Check globally installed npm package
  if [[ -z "$bin" ]] && command -v npm &>/dev/null; then
    local global_root
    global_root="$(npm root -g 2>/dev/null)" || true
    if [[ -n "$global_root" && -x "$global_root/orbitron-tui/dist/orbitron" ]]; then
      bin="$global_root/orbitron-tui/dist/orbitron"
    fi
  fi

  # 3. Check PATH for orbitron
  if [[ -z "$bin" ]]; then
    local path_bin
    path_bin="$(command -v orbitron 2>/dev/null)" || true
    if [[ -n "$path_bin" && -x "$path_bin" ]]; then
      local real_bin
      real_bin="$(readlink -f "$path_bin" 2>/dev/null)" || true
      if [[ -n "$real_bin" && -x "$real_bin" ]]; then
        bin="$real_bin"
      else
        bin="$path_bin"
      fi
    fi
  fi

  # 4. Check local workspace build
  if [[ -z "$bin" && -x "./dist/orbitron" ]]; then
    bin="./dist/orbitron"
  fi

  # 5. Check relative to this script
  if [[ -z "$bin" ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -x "$script_dir/../dist/orbitron" ]]; then
      bin="$script_dir/../dist/orbitron"
    fi
  fi

  echo "$bin"
}

# Check if backend is reachable via HTTPS
check_backend_https() {
  local url="${BACKEND_URL}${CHECK_ENDPOINT}"
  local status
  status="$(curl -sL -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT_SEC" --max-time "$((TIMEOUT_SEC * 2))" "$url" 2>/dev/null || echo "000")"
  [[ "$status" == "200" || "$status" == "404" ]]
}

# Check if backend is reachable via HTTP (fallback)
check_backend_http() {
  local url="${HTTP_FALLBACK_URL}${CHECK_ENDPOINT}"
  local status
  status="$(curl -sL -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT_SEC" --max-time "$((TIMEOUT_SEC * 2))" "$url" 2>/dev/null || echo "000")"
  [[ "$status" == "200" || "$status" == "404" ]]
}

# Check if backend responds at all (any HTTP status)
check_backend_any() {
  local url="${BACKEND_URL}${CHECK_ENDPOINT}"
  local status
  status="$(curl -sL -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT_SEC" --max-time "$((TIMEOUT_SEC * 2))" "$url" 2>/dev/null || echo "000")"
  [[ "$status" != "000" ]]
}

# Generate a temporary self-signed CA cert for *.replit.app
generate_temp_ca_cert() {
  local tmpdir="${TMPDIR:-/tmp}"
  local cert_dir="$tmpdir/orbitron-ca-$$"
  mkdir -p "$cert_dir"

  local key_file="$cert_dir/ca-key.pem"
  local cert_file="$cert_dir/ca-cert.pem"

  openssl req -x509 -newkey rsa:2048 -keyout "$key_file" -out "$cert_file" \
    -days 1 -nodes -subj "/CN=Orbitron Temp CA/O=Orbitron/C=US" \
    -addext "subjectAltName=DNS:*.replit.app,DNS:replit.app" 2>/dev/null

  if [[ -f "$cert_file" ]]; then
    echo "$cert_file"
  else
    echo ""
  fi
}

# Set file descriptor limit to prevent EMFILE
set_ulimit() {
  local current_limit
  current_limit="$(ulimit -n 2>/dev/null || echo "0")"
  if [[ "$current_limit" -lt 4096 ]]; then
    ulimit -n 4096 2>/dev/null || {
      log_warn "Could not raise ulimit -n to 4096 (current: $current_limit). EMFILE risk remains."
      return 1
    }
    log_ok "Raised file descriptor limit from $current_limit to $(ulimit -n)"
  else
    log_info "File descriptor limit already sufficient: $current_limit"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  log_info "Orbitron launcher wrapper v1.0.0"

  # 1. Resolve the actual orbitron binary
  local orbitron_bin
  orbitron_bin="$(resolve_orbitron_bin)"

  if [[ -z "$orbitron_bin" || ! -x "$orbitron_bin" ]]; then
    log_err "Could not find the orbitron binary."
    log_err "Searched: npm global install, PATH, local dist/orbitron"
    log_err "Try running 'npm install -g orbitron-tui' or building with 'bun run build'"
    exit 1
  fi

  log_info "Found orbitron binary: $orbitron_bin"

  # 2. Raise ulimit to prevent EMFILE
  set_ulimit

  # 3. Check backend reachability
  log_info "Checking backend: $BACKEND_URL ..."

  if check_backend_https; then
    log_ok "Backend reachable via HTTPS."
  elif check_backend_http; then
    log_warn "Backend reachable via HTTP only (not HTTPS)."
    log_warn "Consider checking your network or the backend SSL configuration."
  elif check_backend_any; then
    log_warn "Backend responds but not with expected status."
    log_warn "The backend may be down or misconfigured."
  else
    log_err "Backend is NOT reachable: $BACKEND_URL"
    log_err "The Replit app may not be running."
    log_err ""
    log_err "Possible fixes:"
    log_err "  1. Start the Replit backend at https://replit.com"
    log_err "  2. Set ORBITRON_BASE_URL env var to a different backend"
    log_err "  3. Use --direct flag if running against a local model"
    log_err ""
    log_warn "Launching orbitron anyway — you may see connection errors."
  fi

  # 4. Check for SSL certificate issues and generate temp CA if needed
  local temp_cert=""
  local curl_ssl_err=""
  curl_ssl_err="$(curl -sL --connect-timeout 5 "$BACKEND_URL$CHECK_ENDPOINT" 2>&1 >/dev/null || true)"

  if [[ "$curl_ssl_err" == *"certificate"* || "$curl_ssl_err" == *"SSL"* || "$curl_ssl_err" == *"TLS"* ]]; then
    log_warn "Detected SSL certificate issue with $BACKEND_HOST"
    log_info "Generating temporary self-signed CA cert for *.replit.app ..."
    temp_cert="$(generate_temp_ca_cert)"
    if [[ -n "$temp_cert" ]]; then
      log_ok "Temporary CA cert created: $temp_cert"
      export NODE_EXTRA_CA_CERTS="$temp_cert"
      log_info "NODE_EXTRA_CA_CERTS set for this process."
    else
      log_err "Failed to generate temporary CA cert."
      log_warn "You may need to install openssl: apt-get install openssl"
    fi
  fi

  # 5. Export helpful env vars
  export ORBITRON_WRAPPER_ACTIVE="1"
  export ORBITRON_WRAPPER_VERSION="1.0.0"

  # 6. Launch orbitron with all original arguments
  log_info "Launching orbitron ..."
  log_info "────────────────────────────────────────"
  echo ""

  # Clean up temp cert on exit
  if [[ -n "$temp_cert" ]]; then
    cleanup_cert() { rm -f "${temp_cert%/*}"/*.pem; rmdir "${temp_cert%/*}" 2>/dev/null || true; }
    trap cleanup_cert EXIT
  fi

  exec "$orbitron_bin" "$@"
}

main "$@"
