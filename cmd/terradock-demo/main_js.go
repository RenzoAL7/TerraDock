//go:build js && wasm

package main

import (
	"syscall/js"

	"github.com/RenzoAL7/TerraDock/internal/publicdemo"
)

func main() {
	handler := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return `{"error":"Solicitud inválida."}`
		}
		return publicdemo.HandleJSON(args[0].String())
	})
	js.Global().Set("terradockDemo", handler)
	select {}
}
