//go:build windows

package commands

import (
	"fmt"
	"os/exec"

	"github.com/UserExistsError/conpty"
)

type winShellPty struct {
	cpty *conpty.ConPty
}

func (w *winShellPty) Read(p []byte) (int, error)  { return w.cpty.Read(p) }
func (w *winShellPty) Write(p []byte) (int, error) { return w.cpty.Write(p) }

func (w *winShellPty) Resize(cols, rows int) error {
	return w.cpty.Resize(cols, rows)
}

func (w *winShellPty) Close() error {
	// ClosePseudoConsole terminates the attached process.
	return w.cpty.Close()
}

func spawnShell(cols, rows int, _ string) (shellPty, error) {
	if !conpty.IsConPtyAvailable() {
		return nil, conpty.ErrConPtyUnsupported
	}
	// Prefer PowerShell (matches the AI assistant's Windows guidance),
	// fall back to cmd.exe.
	commandLine := "cmd.exe"
	if _, err := exec.LookPath("pwsh.exe"); err == nil {
		commandLine = "pwsh.exe -NoLogo"
	} else if _, err := exec.LookPath("powershell.exe"); err == nil {
		commandLine = "powershell.exe -NoLogo"
	}
	handle, err := conpty.Start(commandLine, conpty.ConPtyDimensions(cols, rows))
	if err != nil {
		return nil, fmt.Errorf("ConPTY start failed: %w", err)
	}
	return &winShellPty{cpty: handle}, nil
}
