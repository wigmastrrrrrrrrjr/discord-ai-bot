package main

// theaichatbot v2 (beta) - runs on the owner's machine, tunnels publicly
// with cloudflared, and lets the AI chatbot worker run commands and create
// files locally.
//
// Env:
//
//	V2_TOKEN (required) shared secret the worker must send
//	V2_PORT  (optional, default 8818) local listen port
//	V2_ROOT  (optional, default ./theaichatbot-v2) jail for file writes
//
// Routes (all require Authorization: Bearer <V2_TOKEN>):
//
//	GET  /v2/health
//	POST /v2/command {command}
//	POST /opencode/run {prompt, session} - run the opencode agent (V2)
//	POST /v2/file {path, content}
import (
	"bytes"
	"context"
	"encoding/json"
	"sync"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var (
	opencodeModel = envDefault("V2_OPENCODE_MODEL", "opencode/iceman-free")
	// Iceman is currently broken upstream (reasoning_display unsupported);
	// fall back to this model when the primary errors out.
	opencodeFallback = envDefault("V2_OPENCODE_FALLBACK", "opencode/nemotron-3.5-lightning-free")
	opencodeRoot   = envDefault("V2_OPENCODE_ROOT", defaultOpencodeRoot())
	opencodeTmpDir = envDefault("V2_OPENCODE_TMPDIR", "/home/coder/tmp")
)

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func defaultOpencodeRoot() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, "theaichatbot-v2", "opencode-sessions")
}

type commandRequest struct {
	Command string `json:"command"`
}

type commandResponse struct {
	Output string `json:"output"`
	Exit   int    `json:"exit"`
}

type fileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type readRequest struct {
	Path      string `json:"path"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

type readResponse struct {
	Path   string `json:"path"`
	Total  int    `json:"totalLines"`
	Start  int    `json:"startLine"`
	End    int    `json:"endLine"`
	Numbered string `json:"numbered"`
}

type fileResponse struct {
	Path  string `json:"path"`
	Bytes int    `json:"bytes"`
}

type errorResponse struct {
	Error string `json:"error"`
}

var (
	authToken string
	rootDir   string
)

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Error: message})
}

func authorized(r *http.Request) bool {
	header := r.Header.Get("Authorization")
	return header != "" && header == "Bearer "+authToken
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		jsonError(w, http.StatusUnauthorized, "bad token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "v": "v2", "beta": "v2 beta test, bound to change"})
}

func handleCommand(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		jsonError(w, http.StatusUnauthorized, "bad token")
		return
	}
	var payload commandRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || strings.TrimSpace(payload.Command) == "" {
		jsonError(w, http.StatusBadRequest, "command is required")
		return
	}
	// Commands may take a while; the worker side allows 50 seconds.
	done := make(chan int, 1)
	go func() {
		// Sandbox every command: user+mount namespace, private /tmp, cwd
		// locked to the workspace. Root inside the ns has no host caps, so
		// system dirs are read-only by necessity.
		scriptPath := filepath.Join(rootDir, ".v2-cmd.sh")
		if err := os.WriteFile(scriptPath, []byte(payload.Command+"\n"), 0o700); err != nil {
			jsonError(w, http.StatusInternalServerError, "could not stage command: "+err.Error())
			return
		}
		sandbox := "mount --make-rprivate /\n" +
			"mount -t tmpfs none /tmp 2>/dev/null || true\n" +
			"cd \"$V2_WS\"\n" +
			"export PATH=\"$V2_WS/.venv/bin:$V2_WS/node-lib/node_modules/.bin:$PATH\"\n" +
			"exec /bin/bash \"$V2_CMD\"\n"
		cmd := exec.Command("unshare", "-Urm", "/bin/bash", "-c", sandbox)
		cmd.Env = append(os.Environ(),
			"V2_WS="+rootDir,
			"V2_CMD="+scriptPath,
		)
		cmd.Dir = rootDir
		out, err := cmd.CombinedOutput()
		code := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
				if code < 0 {
					code = 1
				}
			} else {
				out = append(out, []byte("\nspawn error: "+err.Error())...)
				code = 127
			}
		}
		truncated := string(out)
		if len(truncated) > 20000 {
			truncated = truncated[:20000]
		}
		done <- 1
		writeJSON(w, http.StatusOK, commandResponse{Output: truncated, Exit: code})
	}()
	select {
	case <-done:
	case <-time.After(50 * time.Second):
		jsonError(w, http.StatusOK, "command exceeded 50s; still running detached")
	}
}

// jailPath keeps every write inside rootDir even if the model gets creative.
func jailPath(requested string) (string, error) {
	cleaned := filepath.Clean("/" + strings.TrimPrefix(requested, "/"))
	joined := filepath.Join(rootDir, cleaned)
	if !strings.HasPrefix(joined, rootDir+string(os.PathSeparator)) && joined != rootDir {
		return "", fmt.Errorf("path escapes the v2 workspace")
	}
	return joined, nil
}

func handleFile(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		jsonError(w, http.StatusUnauthorized, "bad token")
		return
	}
	var payload fileRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		jsonError(w, http.StatusBadRequest, "path and content are required")
		return
	}
	target, err := jailPath(payload.Path)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		jsonError(w, http.StatusInternalServerError, "could not create directory: "+err.Error())
		return
	}
	if err := os.WriteFile(target, []byte(payload.Content), 0o644); err != nil {
		jsonError(w, http.StatusInternalServerError, "write failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, fileResponse{Path: target, Bytes: len(payload.Content)})
}

// handleRead returns a numbered line slice so the agent can page through
// files like "lines 100-200" without shipping the whole file over the wire.
func handleRead(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		jsonError(w, http.StatusUnauthorized, "bad token")
		return
	}
	var payload readRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}
	target, err := jailPath(payload.Path)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		jsonError(w, http.StatusNotFound, "read failed: "+err.Error())
		return
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	total := len(lines)
	start := payload.StartLine
	if start < 1 {
		start = 1
	}
	if start > total {
		writeJSON(w, http.StatusOK, readResponse{Path: target, Total: total, Start: start, End: start - 1, Numbered: "(empty: past EOF)"})
		return
	}
	end := payload.EndLine
	if end < start || end > total {
		end = total
	}
	capOff := start + 499
	endCap := end
	if endCap > capOff {
		endCap = capOff
	}
	var b strings.Builder
	for i := start; i <= endCap; i++ {
		fmt.Fprintf(&b, "%d: %s\n", i, lines[i-1])
	}
	note := ""
	if endCap < end {
		note = fmt.Sprintf("(truncated: showing %d-%d of requested %d-%d; request a narrower range)", start, endCap, start, end)
		b.WriteString(note)
	}
	writeJSON(w, http.StatusOK, readResponse{
		Path:  target,
		Total: total,
		Start: start,
		End:   endCap,
		Numbered: b.String(),
	})
}


// ---- opencode agent (V2) ----
// Each conversation gets its own directory; follow-ups continue the last
// opencode session in that directory, so the real opencode agent (with its
// own tools and session history) handles every turn.

func opencodeSessionDir(requested string) string {
	name := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, requested)
	if name == "" || len(name) > 80 {
		name = fmt.Sprintf("s%d", time.Now().UnixNano())
	}
	return filepath.Join(opencodeRoot, name)
}

type opencodeRequest struct {
	Prompt  string `json:"prompt"`
	Session string `json:"session,omitempty"`
	Timeout int    `json:"timeout,omitempty"`
}

func handleOpencodeRun(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		jsonError(w, http.StatusUnauthorized, "bad token")
		return
	}
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var payload opencodeRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		jsonError(w, http.StatusBadRequest, "bad JSON")
		return
	}
	if strings.TrimSpace(payload.Prompt) == "" {
		jsonError(w, http.StatusBadRequest, "prompt required")
		return
	}
	dir := opencodeSessionDir(payload.Session)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Continue the previous session so opencode keeps its own history.
	ls, _ := os.ReadDir(dir)
	hasSession := false
	for _, entry := range ls {
		if strings.HasPrefix(entry.Name(), ".opencode") || entry.Name() == "opencode.json" {
			hasSession = true
			break
		}
	}

	timeout := time.Duration(payload.Timeout) * time.Second
	if timeout <= 0 || timeout > 12*time.Minute {
		timeout = 12 * time.Minute
	}
	// Rebuild env so our TMPDIR wins (a stale TMPDIR=/tmp breaks bun).
	filteredEnv := make([]string, 0, len(os.Environ()))
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "TMPDIR=") && !strings.HasPrefix(kv, "OPENCODE") {
			filteredEnv = append(filteredEnv, kv)
		}
	}
	cmdEnv := append(filteredEnv, "TMPDIR="+opencodeTmpDir)

	// NDJSON streaming: chunk records {"t": "..."} then a final done record.
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	flusher, _ := w.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	var mu sync.Mutex
	streaming := true
	emit := func(t string) {
		mu.Lock()
		defer mu.Unlock()
		if !streaming {
			return
		}
		rec, _ := json.Marshal(map[string]string{"t": t})
		w.Write(append(rec, '\n'))
		if flusher != nil {
			flusher.Flush()
		}
	}
	finish := func(payload map[string]any) {
		mu.Lock()
		streaming = false
		mu.Unlock()
		rec, _ := json.Marshal(payload)
		w.Write(append(rec, '\n'))
		if flusher != nil {
			flusher.Flush()
		}
	}

	// Try the primary model; on upstream/model-level errors fall back.
	// Output is buffered for a short grace window so fast model-level
	// failures retry silently instead of leaking errors to the client.
	modelsToTry := []string{opencodeModel}
	if opencodeFallback != "" && opencodeFallback != opencodeModel {
		modelsToTry = append(modelsToTry, opencodeFallback)
	}
	started := time.Now()
	usedModel := opencodeModel
	for _, model := range modelsToTry {
		args := []string{"run", "-m", model}
		if hasSession {
			args = append(args, "--continue")
		}
		args = append(args, payload.Prompt)
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		cmd := exec.CommandContext(ctx, "opencode", args...)
		cmd.Dir = dir
		cmd.Env = cmdEnv

		var aw attemptWriter
		aw.emit = emit
		cmd.Stdout = &aw
		cmd.Stderr = &aw

		if err := cmd.Start(); err != nil {
			cancel()
			emit("opencode failed to start: " + err.Error())
			finish(map[string]any{"output": "", "error": err.Error(), "model": model})
			return
		}
		usedModel = model

		// Grace window: enable live streaming if nothing failed yet.
		timer := time.AfterFunc(10*time.Second, func() {
			aw.enable()
		})
		runErr := cmd.Wait()
		timer.Stop()
		cancel()
		aw.enable() // flush any remaining buffered text once finished

		if aw.bad && model != modelsToTry[len(modelsToTry)-1] {
			emit("") // separator between failed attempts
			continue
		}
		finish(map[string]any{
			"output":   "",
			"seconds":  time.Since(started).Seconds(),
			"session":  filepath.Base(dir),
			"model":    usedModel,
			"exit_err": errString(runErr),
			"done":     true,
		})
		return
	}
}

// attemptWriter buffers opencode output, only letting it stream to the
// client once the grace window passes without a model-level failure.
type attemptWriter struct {
	mu   sync.Mutex
	buf  bytes.Buffer
	bad  bool
	emit func(string)
	live bool
}

func badLine(s string) bool {
	return strings.Contains(s, "Upstream request failed") ||
		strings.Contains(s, "Unexpected server error") ||
		strings.Contains(s, "invalid_request_error") ||
		strings.Contains(s, "Model access is disabled")
}

func (a *attemptWriter) Write(p []byte) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.buf.Write(p)
	s := string(p)
	if badLine(s) {
		a.bad = true
	}
	if a.live && !a.bad && a.emit != nil {
		a.emit(s)
	}
	return len(p), nil
}

func (a *attemptWriter) enable() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.live || a.bad {
		return
	}
	a.live = true
	if a.emit != nil && a.buf.Len() > 0 {
		a.emit(a.buf.String())
	}
}

func errString(err error) string {
	if err != nil {
		return err.Error()
	}
	return ""
}

func main() {
	authToken = os.Getenv("V2_TOKEN")
	if authToken == "" {
		log.Fatal("V2_TOKEN is required (any long random string)")
	}
	port := os.Getenv("V2_PORT")
	if port == "" {
		port = "8818"
	}
	rootDir = os.Getenv("V2_ROOT")
	if rootDir == "" {
		rootDir = "./theaichatbot-v2"
	}
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		log.Fatalf("could not prepare workspace: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/v2/health", handleHealth)
	mux.HandleFunc("/opencode/run", handleOpencodeRun)
	mux.HandleFunc("/v2/read", handleRead)
	mux.HandleFunc("/v2/command", handleCommand)
	mux.HandleFunc("/v2/file", handleFile)

	log.Printf("theaichatbot v2 beta — workspace %s — listening on 127.0.0.1:%s", rootDir, port)
	log.Printf("tunnel it: cloudflared tunnel --url http://127.0.0.1:%s", port)
	server := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
