//go:build js || wasm

package unix

// Provide the minimal symbols referenced by in-toto on Unix platforms.
// These are NO-OPs under WASM (no real filesystem).

const W_OK = 2

// Match the real signature (on Linux it's 'func Access(path string, mode uint32) error').
// We accept either int or uint32 to be permissive across OSes; choose one that matches your error.
func Access(path string, mode uint32) error { return nil }
