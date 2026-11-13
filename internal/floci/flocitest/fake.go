// Package flocitest provides fake Terraform and Floci executables that record
// how they were invoked, so tests can prove when they run and with which
// environment.
package flocitest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// FakeTool writes a shell script that appends its arguments and environment to
// log, waits until gate exists (when gate is not empty), prints stdout and
// exits with code. Each invocation is recorded as "args: …", the environment
// and a "--" separator.
func FakeTool(t *testing.T, name, log, gate, stdout string, code int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	script := fmt.Sprintf(`#!/bin/sh
{ echo "args: $*"; env; echo "--"; } >> %q
i=0
while [ -n %q ] && [ ! -f %q ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done
printf '%%s' %q
exit %d
`, log, gate, gate, stdout, code)
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

// ReadLog returns everything recorded so far, or "" when the tool never ran.
func ReadLog(path string) string {
	data, _ := os.ReadFile(path)
	return string(data)
}

// Invocations counts how many times the tool ran.
func Invocations(path string) int {
	return strings.Count(ReadLog(path), "args: ")
}

// AssertSanitizedEnv checks that no AWS_* or TF_* variable reached the tool,
// that the "real-secret" marker is absent and that CHECKPOINT_DISABLE=1 is set.
func AssertSanitizedEnv(t *testing.T, log string) {
	t.Helper()
	for _, line := range strings.Split(log, "\n") {
		upper := strings.ToUpper(line)
		if strings.HasPrefix(upper, "AWS_") || strings.HasPrefix(upper, "TF_") {
			t.Fatalf("tool received %q", line)
		}
	}
	if strings.Contains(log, "real-secret") {
		t.Fatal("real credentials reached the tool")
	}
	if !strings.Contains(log, "\nCHECKPOINT_DISABLE=1\n") {
		t.Fatal("CHECKPOINT_DISABLE=1 missing from the tool environment")
	}
}
