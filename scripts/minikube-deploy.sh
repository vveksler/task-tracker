#!/usr/bin/env bash
# Rebuild local images inside minikube, upgrade the Helm release, restart
# pods (imagePullPolicy: Never + :latest), then run minikube tunnel.
#
# Usage (from repo root):
#   ./scripts/minikube-deploy.sh
#   ./scripts/minikube-deploy.sh --no-tunnel    # build + upgrade only
#   ./scripts/minikube-deploy.sh --skip-build   # upgrade + tunnel only
#
# Optional secrets: helm/task-tracker/values-local.yaml (gitignored).
# Copy from values-local.yaml.example and fill GOOGLE_* / MAIL_* / aiAssistant keys.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Homebrew (Apple Silicon) often isn't on PATH in non-login shells.
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

DO_BUILD=1
DO_TUNNEL=1
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) DO_TUNNEL=0 ;;
    --skip-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need minikube
need docker
need kubectl
need helm

HOST="${INGRESS_HOST:-task-tracker.local}"
NS="${NAMESPACE:-task-tracker}"
RELEASE="${RELEASE:-task-tracker}"

echo "==> Ensuring minikube is running"
if ! minikube status >/dev/null 2>&1; then
  minikube start --driver=docker --cpus=4 --memory=4096
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "==> Pointing Docker at minikube daemon"
  # shellcheck disable=SC2046
  eval $(minikube docker-env)

  echo "==> Building backend image"
  docker build -t task-tracker-backend:latest ./backend

  echo "==> Building AI Assistant image"
  docker build -t task-tracker-ai-assistant:latest ./ai-assistant

  echo "==> Building frontend image"
  docker build \
    --build-arg "NEXT_PUBLIC_API_URL=http://${HOST}/api" \
    --build-arg "NEXT_PUBLIC_WS_URL=http://${HOST}" \
    -t task-tracker-frontend:latest \
    ./frontend
else
  echo "==> Skipping image build (--skip-build)"
fi

echo "==> Ensuring namespace ${NS} exists"
kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl create namespace "$NS"

HELM_ARGS=(upgrade --install "$RELEASE" helm/task-tracker --namespace "$NS" -f helm/task-tracker/values.yaml)
if [[ -f helm/task-tracker/values-local.yaml ]]; then
  echo "==> Using values-local.yaml (Google/Mail/AI secrets)"
  HELM_ARGS+=(-f helm/task-tracker/values-local.yaml)
else
  echo "==> No values-local.yaml — OAuth/mail/AI keys stay unset (optional)"
fi

echo "==> Helm upgrade"
# Clear leftover kubectl-set env ownership that conflicts with Helm SSA
kubectl set env deployment/frontend -n "$NS" NEXT_PUBLIC_APP_URL- GOOGLE_CALLBACK_URL- >/dev/null 2>&1 || true
kubectl set env deployment/backend -n "$NS" FRONTEND_ORIGIN- GOOGLE_CALLBACK_URL- AI_ASSISTANT_URL- >/dev/null 2>&1 || true
helm "${HELM_ARGS[@]}"

echo "==> Restarting deployments to pick up :latest images"
DEPS=(deployment/backend deployment/frontend)
if kubectl get deployment/ai-assistant -n "$NS" >/dev/null 2>&1; then
  DEPS+=(deployment/ai-assistant)
fi
kubectl rollout restart "${DEPS[@]}" -n "$NS"
kubectl rollout status deployment/backend -n "$NS" --timeout=180s
kubectl rollout status deployment/frontend -n "$NS" --timeout=180s
if kubectl get deployment/ai-assistant -n "$NS" >/dev/null 2>&1; then
  kubectl rollout status deployment/ai-assistant -n "$NS" --timeout=180s
fi

echo "==> Pods"
kubectl get pods -n "$NS"

if ! grep -qE "[[:space:]]${HOST}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
  echo
  echo "NOTE: add this line to /etc/hosts if missing:"
  echo "  127.0.0.1 ${HOST}"
fi

echo
echo "App URL: http://${HOST}"

if [[ "$DO_TUNNEL" -eq 1 ]]; then
  echo "==> Starting minikube tunnel (Ctrl+C to stop; keep this terminal open)"
  echo "    May ask for your macOS password (ports 80/443)."
  exec minikube tunnel
fi

echo "==> Done (tunnel skipped). Run: minikube tunnel"
