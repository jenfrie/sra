//go:build js || wasm

package main

import (
	"bytes"
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"strings"
	"syscall/js"

	"github.com/sigstore/sigstore-go/pkg/bundle"
	"github.com/sigstore/sigstore-go/pkg/root"
	"github.com/sigstore/sigstore-go/pkg/verify"
)

// Embed the production trusted root JSON into the WASM.
// Place trusted_root.json next to this file.
//go:embed trusted_root.json
var trustedRootJSON []byte

// -------- utilities --------

// decode a modern Sigstore bundle (proto-JSON) into a SignedEntity
func decodeBundle(bundleBytes []byte) (*bundle.Bundle, error) {
	var b bundle.Bundle
	if err := json.Unmarshal(bundleBytes, &b); err != nil {
		return nil, err
	}
	return &b, nil
}

// build a verifier from embedded roots. If strict=true, require SCT/TLog/ITS.
func newVerifier(strict bool) (*verify.Verifier, error) {
	trustedRoot, err := root.NewTrustedRootFromJSON(trustedRootJSON)
	if err != nil {
		return nil, err
	}
        if !strict {
             	return verify.NewVerifier(
			trustedRoot,
			verify.WithTransparencyLog(1),
			verify.WithIntegratedTimestamps(1),
		)
        }
	return verify.NewVerifier(
		trustedRoot,
		verify.WithSignedCertificateTimestamps(1),
		verify.WithTransparencyLog(1),
		verify.WithIntegratedTimestamps(1),
	)
}

// return SPKI (PKIX) DER for a given PEM (supports PUBLIC KEY, RSA PUBLIC KEY, or CERTIFICATE)
func spkiDERFromPEM(pemBytes []byte) ([]byte, crypto.PublicKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, nil, errors.New("no PEM block found")
	}

	// 1) Plain PKIX PUBLIC KEY
	if pk, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		der, err2 := x509.MarshalPKIXPublicKey(pk)
		if err2 != nil {
			return nil, nil, err2
		}
		return der, pk, nil
	}

	// 2) RSA PKCS#1 PUBLIC KEY -> convert to PKIX
	if rsaPK, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		der, err2 := x509.MarshalPKIXPublicKey(rsaPK)
		if err2 != nil {
			return nil, nil, err2
		}
		return der, rsaPK, nil
	}

	// 3) CERTIFICATE containing a public key
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil && cert.PublicKey != nil {
		der, err2 := x509.MarshalPKIXPublicKey(cert.PublicKey)
		if err2 != nil {
			return nil, nil, err2
		}
		return der, cert.PublicKey, nil
	}

	return nil, nil, errors.New("unsupported PEM type")
}

// -------- JS functions --------

// sigverifyWithID(artifactBytes, issuer, subject, bundleJSON)
//   issuer  -> OIDC issuer (e.g. "https://github.com/login/oauth" or "https://token.actions.githubusercontent.com")
//   subject -> email or workflow URI (SAN value, WITHOUT "email:" prefix)
func sigverifyWithID(this js.Value, args []js.Value) any {
	if len(args) != 4 {
		return map[string]any{"ok": false, "error": "usage: sigverifyWithID(artifactBytes, issuer, subject, bundleJSON)"}
	}

	artifact := make([]byte, args[0].Length())
	js.CopyBytesToGo(artifact, args[0])
	issuer := args[1].String()
	subject := args[2].String()

	bundleBytes := make([]byte, args[3].Length())
	js.CopyBytesToGo(bundleBytes, args[3])

	if issuer == "" || subject == "" {
		return map[string]any{"ok": false, "error": "issuer and subject are required"}
	}

	verifier, err := newVerifier(true) // require SCT/TLog/ITS for cert-based identities
	if err != nil {
		return map[string]any{"ok": false, "error": "new verifier: " + err.Error()}
	}

	entity, err := decodeBundle(bundleBytes)
	if err != nil {
		return map[string]any{"ok": false, "error": "bundle decode: " + err.Error()}
	}

	art := verify.WithArtifact(bytes.NewReader(artifact))

	cid, err := verify.NewShortCertificateIdentity(
		issuer, "",  // exact issuer match
		subject, "", // exact subject (email or URI) match
	)
	if err != nil {
		return map[string]any{"ok": false, "error": "identity: " + err.Error()}
	}
	pol := verify.NewPolicy(art, verify.WithCertificateIdentity(cid))

	if _, err := verifier.Verify(entity, pol); err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	return map[string]any{"ok": true}
}

// sigverifyWithKey(artifactBytes, publicKeyPEM, bundleJSON)
//   publicKeyPEM -> ASCII-armored PEM ("-----BEGIN PUBLIC KEY----- ...")
//
// This verifies a *key-signed* bundle (created with `cosign sign-blob --key ...`).
// It cryptographically verifies the bundle, then pins the signing key to the provided PEM:
//   - If the bundle carries the public key bytes, we compare SPKI DER byte-for-byte.
//   - Else, if it only carries a 'hint', we match it to SHA-256(SPKI DER) hex (lowercase).
func sigverifyWithKey(this js.Value, args []js.Value) any {
	if len(args) != 3 {
		return map[string]any{"ok": false, "error": "usage: sigverifyWithKey(artifactBytes, publicKeyPEM, bundleJSON)"}
	}

	artifact := make([]byte, args[0].Length())
	js.CopyBytesToGo(artifact, args[0])

	pubPEM := []byte(args[1].String())

	bundleBytes := make([]byte, args[2].Length())
	js.CopyBytesToGo(bundleBytes, args[2])

	// Parse & normalize caller's public key to SPKI DER
	wantDER, _, err := spkiDERFromPEM(pubPEM)
	if err != nil {
		return map[string]any{"ok": false, "error": "public key: " + err.Error()}
	}

	// Build a non-strict verifier (key-signed bundles don't require SCT/ITS)
	verifier, err := newVerifier(false)
	if err != nil {
		return map[string]any{"ok": false, "error": "new verifier: " + err.Error()}
	}

	entity, err := decodeBundle(bundleBytes)
	if err != nil {
		return map[string]any{"ok": false, "error": "bundle decode: " + err.Error()}
	}

	// Require "key" signatures at policy level
	art := verify.WithArtifact(bytes.NewReader(artifact))
	pol := verify.NewPolicy(art, verify.WithKey())

	if _, err := verifier.Verify(entity, pol); err != nil {
		return map[string]any{"ok": false, "error": "verify: " + err.Error()}
	}

	// After cryptographic verify, pin to caller's key
	// Pull embedded key or hint from the bundle JSON (no need to rely on internal types here).
	type publicKeyContent struct {
		Content string `json:"content"` // base64 DER (SPKI)
	}
	type publicKeyIdentifier struct {
		Hint string `json:"hint"` // implementation-defined hint
	}
	type vmContent struct {
		PublicKey           *publicKeyContent    `json:"publicKey,omitempty"`
		PublicKeyIdentifier *publicKeyIdentifier `json:"publicKeyIdentifier,omitempty"`
	}
	type verificationMaterial struct {
		Content vmContent `json:"content"`
	}
	type rawBundle struct {
		VerificationMaterial verificationMaterial `json:"verificationMaterial"`
	}

	var rb rawBundle
	_ = json.Unmarshal(bundleBytes, &rb)

	if rb.VerificationMaterial.Content.PublicKey != nil && rb.VerificationMaterial.Content.PublicKey.Content != "" {
		gotDER, err := base64.StdEncoding.DecodeString(rb.VerificationMaterial.Content.PublicKey.Content)
		if err != nil {
			return map[string]any{"ok": false, "error": "bundle publicKey decode: " + err.Error()}
		}
		if !bytes.Equal(gotDER, wantDER) {
			return map[string]any{"ok": false, "error": "public key mismatch: bundle key != expected key"}
		}
	} else if rb.VerificationMaterial.Content.PublicKeyIdentifier != nil {
		hint := strings.ToLower(strings.TrimSpace(rb.VerificationMaterial.Content.PublicKeyIdentifier.Hint))
		sum := sha256.Sum256(wantDER) // SHA-256 of SPKI DER
		fingerprint := strings.ToLower(hex.EncodeToString(sum[:]))
		if hint != fingerprint {
			return map[string]any{"ok": false, "error": "key hint mismatch"}
		}
	} else {
		return map[string]any{"ok": false, "error": "bundle has no public key material to pin"}
	}

	return map[string]any{"ok": true}
}

func main() {
	js.Global().Set("sigverifyWithID", js.FuncOf(sigverifyWithID))
	js.Global().Set("sigverifyWithKey", js.FuncOf(sigverifyWithKey))
	// keep your original name as a convenience alias:
	js.Global().Set("sigverify", js.FuncOf(sigverifyWithID))
	<-make(chan struct{})
}
