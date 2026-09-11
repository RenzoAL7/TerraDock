GO ?= go
GO_PACKAGES := ./cmd/... ./internal/... ./examples/...
GOFMT ?= $(shell $(GO) env GOROOT)/bin/gofmt
NPM ?= npm
ROOT ?= .
PORT ?= 7331
ASSETS ?= web/dist
DEV_ORIGIN ?= http://127.0.0.1:5173

.PHONY: help install build run dev-api dev-web check test e2e-install e2e

help:
	@echo 'install      Instalar dependencias Go y frontend'
	@echo 'build        Compilar frontend y bin/terradock'
	@echo 'run          Servir el build local en 127.0.0.1:7331'
	@echo 'dev-api      Iniciar API Go de desarrollo'
	@echo 'dev-web      Iniciar Vite en otra terminal'
	@echo 'check        Verificar formato, lint, tipos y go vet'
	@echo 'test         Ejecutar pruebas Go y frontend'
	@echo 'e2e-install  Instalar navegador Chromium para las pruebas'
	@echo 'e2e          Ejecutar escenarios Playwright'

install:
	$(GO) mod download
	$(NPM) --prefix web ci

build:
	$(NPM) --prefix web run build
	mkdir -p bin
	$(GO) build -trimpath -o bin/terradock ./cmd/terradock

run:
	./bin/terradock --root "$(ROOT)" --assets "$(ASSETS)" --port "$(PORT)"

dev-api:
	$(GO) run ./cmd/terradock --root "$(ROOT)" --port "$(PORT)" --dev-origin "$(DEV_ORIGIN)"

dev-web:
	$(NPM) --prefix web run dev

check:
	GOFMT="$(GOFMT)" sh scripts/check-go-format.sh
	$(GO) vet $(GO_PACKAGES)
	$(NPM) --prefix web run format:check
	$(NPM) --prefix web run lint
	$(NPM) --prefix web run typecheck

test:
	$(GO) test -race $(GO_PACKAGES)
	$(NPM) --prefix web run test

e2e-install:
	cd web && $(NPM) exec playwright install chromium

e2e:
	GO="$(GO)" $(NPM) --prefix web run test:e2e
