package floci

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

// Layout describes how the staging copy redirects the project to Floci.
type Layout struct {
	Aliases           []string // aws provider aliases found ("" = default)
	GeneratedProvider bool     // no aws provider block existed
}

const valuesFile = "zz_terradock.auto.tfvars.json"

// Stage replaces the .tf and tfvars files in dir with the project files, the
// project's own tfvars, the values entered in TerraDock and the Floci
// overrides. State, lock and .terraform data in dir are kept between runs.
func Stage(dir string, files map[string]string, endpoint string, tfvars map[string]string, values map[string]string) (Layout, error) {
	layout, err := inspect(files)
	if err != nil {
		return layout, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return layout, errors.New("no se pudo preparar la copia de trabajo")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return layout, errors.New("no se pudo leer la copia de trabajo")
	}
	for _, entry := range entries {
		if !entry.IsDir() && (strings.HasSuffix(entry.Name(), ".tf") || strings.HasSuffix(entry.Name(), ".tf.json") || isTFVars(entry.Name())) {
			if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
				return layout, errors.New("no se pudo limpiar la copia de trabajo")
			}
		}
	}
	for name, body := range files {
		if name == overrideFile || name == providerFile || filepath.Base(name) != name {
			return layout, fmt.Errorf("nombre de archivo no permitido: %s", name)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			return layout, errors.New("no se pudo escribir la copia de trabajo")
		}
	}
	for name, body := range tfvars {
		if !isTFVars(name) || name == valuesFile || filepath.Base(name) != name {
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			return layout, errors.New("no se pudo copiar las variables del proyecto")
		}
	}
	if len(values) > 0 {
		encoded := map[string]any{}
		for name, value := range values {
			var parsed any
			// Numbers, booleans, lists and objects may be typed as JSON.
			if json.Unmarshal([]byte(value), &parsed) == nil {
				encoded[name] = parsed
			} else {
				encoded[name] = value
			}
		}
		body, _ := json.MarshalIndent(encoded, "", "  ")
		if err := os.WriteFile(filepath.Join(dir, valuesFile), body, 0o600); err != nil {
			return layout, errors.New("no se pudo escribir las variables")
		}
	}
	override, provider := Overrides(layout, endpoint)
	if err := os.WriteFile(filepath.Join(dir, overrideFile), []byte(override), 0o600); err != nil {
		return layout, errors.New("no se pudo escribir la configuración de Floci")
	}
	if provider != "" {
		if err := os.WriteFile(filepath.Join(dir, providerFile), []byte(provider), 0o600); err != nil {
			return layout, errors.New("no se pudo escribir la configuración de Floci")
		}
	}
	return layout, nil
}

func inspect(files map[string]string) (Layout, error) {
	layout := Layout{}
	aliases := map[string]bool{}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		parsed, diags := hclsyntax.ParseConfig([]byte(files[name]), name, hcl.InitialPos)
		if diags.HasErrors() || parsed == nil {
			return layout, fmt.Errorf("corrige los errores HCL de %s antes de usar Floci", name)
		}
		for _, block := range parsed.Body.(*hclsyntax.Body).Blocks {
			switch {
			case block.Type == "terraform":
				for _, nested := range block.Body.Blocks {
					if nested.Type == "cloud" {
						return layout, errors.New("el bloque terraform { cloud } no es compatible con Floci; usa un backend estándar")
					}
				}
			case block.Type == "provider" && len(block.Labels) == 1 && block.Labels[0] == "aws":
				alias := ""
				if attr, ok := block.Body.Attributes["alias"]; ok {
					value, diags := attr.Expr.Value(nil)
					if diags.HasErrors() || value.Type() != cty.String || !value.IsKnown() || value.IsNull() {
						return layout, errors.New("el alias del provider aws debe ser un texto literal")
					}
					alias = value.AsString()
				}
				aliases[alias] = true
			}
		}
	}
	if len(aliases) == 0 {
		layout.GeneratedProvider = true
		aliases[""] = true
	}
	for alias := range aliases {
		layout.Aliases = append(layout.Aliases, alias)
	}
	sort.Strings(layout.Aliases)
	return layout, nil
}

// Overrides renders the override file (backend + provider redirection) and,
// when the project has no aws provider, a standalone provider file.
func Overrides(layout Layout, endpoint string) (override, provider string) {
	var b strings.Builder
	b.WriteString("# Generado por TerraDock solo en la copia de trabajo de Floci.\n")
	b.WriteString("terraform {\n  backend \"local\" {\n    path = \"terraform.tfstate\"\n  }\n}\n")
	body := func(alias string, region bool) string {
		var p strings.Builder
		p.WriteString("provider \"aws\" {\n")
		if alias != "" {
			fmt.Fprintf(&p, "  alias = %s\n", strconv.Quote(alias))
		}
		if region {
			p.WriteString("  region = \"us-east-1\"\n")
		}
		p.WriteString("  access_key                  = \"test\"\n")
		p.WriteString("  secret_key                  = \"test\"\n")
		p.WriteString("  skip_credentials_validation = true\n")
		p.WriteString("  skip_metadata_api_check     = true\n")
		p.WriteString("  skip_requesting_account_id  = true\n")
		p.WriteString("  s3_use_path_style           = true\n")
		p.WriteString("  endpoints {\n")
		for _, service := range services {
			fmt.Fprintf(&p, "    %s = %s\n", service, strconv.Quote(endpoint))
		}
		p.WriteString("  }\n}\n")
		return p.String()
	}
	if layout.GeneratedProvider {
		return b.String(), "# Generado por TerraDock: el proyecto no declara provider \"aws\".\n" + body("", true)
	}
	for _, alias := range layout.Aliases {
		b.WriteString(body(alias, false))
	}
	return b.String(), ""
}

func isTFVars(name string) bool {
	return name == "terraform.tfvars" || name == "terraform.tfvars.json" ||
		strings.HasSuffix(name, ".auto.tfvars") || strings.HasSuffix(name, ".auto.tfvars.json")
}

// ReadTFVars loads the tfvars files Terraform reads automatically from a local
// project folder. Symlinks and oversized files are skipped.
func ReadTFVars(dir string) map[string]string {
	out := map[string]string{}
	if dir == "" {
		return out
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !isTFVars(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.Size() > 1<<20 {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err == nil {
			out[entry.Name()] = string(body)
		}
	}
	return out
}

// Variables lists root input variables and whether tfvars files set them.
func Variables(files map[string]string, tfvars map[string]string) []Variable {
	provided := map[string]bool{}
	for name, body := range tfvars {
		if strings.HasSuffix(name, ".json") {
			var parsed map[string]any
			if json.Unmarshal([]byte(body), &parsed) == nil {
				for key := range parsed {
					provided[key] = true
				}
			}
			continue
		}
		if parsed, diags := hclsyntax.ParseConfig([]byte(body), name, hcl.InitialPos); !diags.HasErrors() && parsed != nil {
			for key := range parsed.Body.(*hclsyntax.Body).Attributes {
				provided[key] = true
			}
		}
	}
	var out []Variable
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		parsed, diags := hclsyntax.ParseConfig([]byte(files[name]), name, hcl.InitialPos)
		if diags.HasErrors() || parsed == nil {
			continue
		}
		for _, block := range parsed.Body.(*hclsyntax.Body).Blocks {
			if block.Type != "variable" || len(block.Labels) != 1 {
				continue
			}
			v := Variable{Name: block.Labels[0], Provided: provided[block.Labels[0]]}
			_, hasDefault := block.Body.Attributes["default"]
			v.Required = !hasDefault
			if attr, ok := block.Body.Attributes["description"]; ok {
				if value, d := attr.Expr.Value(nil); !d.HasErrors() && value.Type() == cty.String && value.IsKnown() && !value.IsNull() {
					v.Description = value.AsString()
				}
			}
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	if out == nil {
		out = []Variable{}
	}
	return out
}
