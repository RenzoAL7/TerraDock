#!/bin/sh
# Builds a self-contained TerraDock binary per platform into dist/.
# Requires the frontend already built in web/dist (make build).
# Archive names carry no version so releases/latest/download/<name> stays stable.
set -eu

VERSION="${VERSION:-dev}"
TARGETS="${TARGETS:-darwin/arm64 darwin/amd64 linux/arm64 linux/amd64 windows/amd64 windows/arm64}"
OUT="${OUT:-dist}"
GO="${GO:-go}"

[ -f web/dist/index.html ] || { echo "Falta web/dist: ejecuta make build primero." >&2; exit 1; }
rm -rf "$OUT"
mkdir -p "$OUT"

for target in $TARGETS; do
  os="${target%/*}"
  arch="${target#*/}"
  name="terradock_${os}_${arch}"
  stage="$OUT/$name"
  bin="terradock"
  [ "$os" = windows ] && bin="terradock.exe"
  mkdir -p "$stage"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" "$GO" build -tags embed -trimpath \
    -ldflags "-s -w -X github.com/RenzoAL7/TerraDock/internal/server.Version=$VERSION" \
    -o "$stage/$bin" ./cmd/terradock
  cp LICENSE "$stage/"
  if [ "$os" = windows ]; then
    (cd "$stage" && zip -q "../$name.zip" "$bin" LICENSE)
  else
    tar -C "$stage" -czf "$OUT/$name.tar.gz" "$bin" LICENSE
  fi
  rm -rf "$stage"
  echo "$name"
done

cd "$OUT"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum terradock_* > checksums.txt
else
  shasum -a 256 terradock_* > checksums.txt
fi
