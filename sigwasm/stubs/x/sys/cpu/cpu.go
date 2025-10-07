package cpu

// sha3 (x/crypto) checks this at init time.
// Defaulting to false is fine for browsers (WebAssembly is defined as little-endian).
var IsBigEndian bool = false
