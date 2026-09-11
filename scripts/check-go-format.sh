#!/bin/sh
set -eu

# Limit formatting checks to first-party Go code, excluding local toolchains.
gofmt_bin=${GOFMT:-gofmt}
unformatted=$("$gofmt_bin" -l cmd internal)
if [ -n "$unformatted" ]; then
  printf 'Run gofmt on these files:\n%s\n' "$unformatted" >&2
  exit 1
fi
