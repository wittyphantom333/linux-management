//go:build !windows

package commands

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixShellPty struct {
	tty *os.File
	cmd *exec.Cmd
}

func (u *unixShellPty) Read(p []byte) (int, error)  { return u.tty.Read(p) }
func (u *unixShellPty) Write(p []byte) (int, error) { return u.tty.Write(p) }

func (u *unixShellPty) Resize(cols, rows int) error {
	return pty.Setsize(u.tty, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (u *unixShellPty) Close() error {
	// Closing the controlling tty sends SIGHUP to the shell session;
	// reap the child so it doesn't linger as a zombie.
	err := u.tty.Close()
	_ = u.cmd.Wait()
	return err
}

func spawnShell(cols, rows int, term string) (shellPty, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	if _, err := os.Stat(shell); err != nil {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM="+term)
	tty, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, err
	}
	return &unixShellPty{tty: tty, cmd: cmd}, nil
}
