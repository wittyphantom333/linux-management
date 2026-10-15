package commands

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/gorilla/websocket"
)

// shellPty abstracts the platform PTY: creack/pty on Linux/FreeBSD,
// ConPTY on Windows. Both give a Read/Write/Resize/Close handle pair.
type shellPty interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

// localShellSession is one agent-spawned local shell streaming over the WS.
type localShellSession struct {
	pty       shellPty
	sessionID string
}

var (
	shellSessions   = make(map[string]*localShellSession)
	shellSessionsMu sync.Mutex
)

func normalizeShellDims(cols, rows int, term string) (int, int, string) {
	if cols < 2 || cols > 500 {
		cols = 80
	}
	if rows < 2 || rows > 500 {
		rows = 24
	}
	if term == "" {
		term = "xterm-256color"
	}
	return cols, rows, term
}

func sendShellMessage(conn *websocket.Conn, msgType string, sessionID string, data interface{}) {
	msg := map[string]interface{}{
		"type":       msgType,
		"session_id": sessionID,
	}
	if data != nil {
		msg["data"] = data
	}
	if msgType == "shell_error" {
		if errMsg, ok := data.(string); ok {
			msg["message"] = errMsg
		}
	}
	msgJSON, err := json.Marshal(msg)
	if err != nil {
		logger.WithError(err).Error("Failed to marshal shell message")
		return
	}
	if err := conn.WriteMessage(websocket.TextMessage, msgJSON); err != nil {
		logger.WithError(err).Warn("Failed to send shell message")
	}
}

// closeAllShellSessions kills every open local shell; called when the
// agent's WebSocket to the server drops so no orphaned PTYs survive.
func closeAllShellSessions() {
	shellSessionsMu.Lock()
	for id, s := range shellSessions {
		if err := s.pty.Close(); err != nil {
			logger.WithError(err).WithField("session_id", id).Warn("Failed to close shell on WS disconnect")
		}
		delete(shellSessions, id)
	}
	shellSessionsMu.Unlock()
}

// handleShellOpen spawns the local PTY shell and streams it over the WS.
func handleShellOpen(m wsMsg, conn *websocket.Conn) {
	sessionID := m.sshProxySessionID
	cols, rows, term := normalizeShellDims(m.sshProxyCols, m.sshProxyRows, m.sshProxyTerminal)

	shell, err := spawnShell(cols, rows, term)
	if err != nil {
		logger.WithError(err).Error("Failed to spawn local shell")
		sendShellMessage(conn, "shell_error", sessionID, fmt.Sprintf("Failed to spawn shell: %v", err))
		return
	}

	session := &localShellSession{pty: shell, sessionID: sessionID}
	shellSessionsMu.Lock()
	shellSessions[sessionID] = session
	shellSessionsMu.Unlock()

	sendShellMessage(conn, "shell_connected", sessionID, nil)
	logger.WithFields(map[string]interface{}{
		"session_id": sessionID,
		"cols":       cols,
		"rows":       rows,
	}).Info("Local shell session opened")

	// Pump PTY output to the server until the shell exits.
	go func() {
		buffer := make([]byte, 8192)
		for {
			n, err := shell.Read(buffer)
			if n > 0 {
				sendShellMessage(conn, "shell_data", sessionID, string(buffer[:n]))
			}
			if err != nil {
				break
			}
		}
		if err := shell.Close(); err != nil {
			logger.WithError(err).WithField("session_id", sessionID).Debug("Shell PTY closed with error")
		}
		shellSessionsMu.Lock()
		delete(shellSessions, sessionID)
		shellSessionsMu.Unlock()
		sendShellMessage(conn, "shell_closed", sessionID, nil)
	}()
}

func handleShellInput(m wsMsg) {
	shellSessionsMu.Lock()
	session, ok := shellSessions[m.sshProxySessionID]
	shellSessionsMu.Unlock()
	if !ok {
		return
	}
	if _, err := session.pty.Write([]byte(m.sshProxyData)); err != nil {
		logger.WithError(err).WithField("session_id", m.sshProxySessionID).Warn("Failed to write to shell")
	}
}

func handleShellResize(m wsMsg) {
	shellSessionsMu.Lock()
	session, ok := shellSessions[m.sshProxySessionID]
	shellSessionsMu.Unlock()
	if !ok {
		return
	}
	cols, rows, _ := normalizeShellDims(m.sshProxyCols, m.sshProxyRows, "")
	if err := session.pty.Resize(cols, rows); err != nil {
		logger.WithError(err).WithField("session_id", m.sshProxySessionID).Warn("Failed to resize shell")
	}
}

func handleShellClose(m wsMsg) {
	shellSessionsMu.Lock()
	session, ok := shellSessions[m.sshProxySessionID]
	if ok {
		delete(shellSessions, m.sshProxySessionID)
	}
	shellSessionsMu.Unlock()
	if !ok {
		return
	}
	if err := session.pty.Close(); err != nil {
		logger.WithError(err).WithField("session_id", m.sshProxySessionID).Warn("Failed to close shell")
	}
}
