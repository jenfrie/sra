importScripts("wasm_exec.js");

let go;
let wasmReady;

self.onmessage = async (event) => {

    result = await offscreenWorkerVerify(event.data);

	postMessage(result);
}

/**
 * Validates if the given combination of scrip, bundle , email address and OIDC issuer is valid 
 * using the keyless new-bundle-format function of Sigstore that was compiled into WebAssembly
 * @param {object} objToVerify The combination of script, bundle, email address and OIDC issuer to be validated
 * @returns 
 */
async function offscreenWorkerVerify(objToVerify) {
	if (!objToVerify) {
		return { ok: false, error: "Received nothing for the validation."};
	}

	await initWasmOnce(); // To guarantee that a WebAssembly instance is active

	try {
		let result = { ok: false, error: "Script doesn't have a valid email adress and/or OIDC issuer." };

		if (objToVerify?.email) {
			// The new-bundle-format keyless verification function from Sigstore in WebAssembly
			result = await self.sigverifyWithID(
				new Uint8Array(objToVerify.artifact),
				objToVerify.issuer,
				objToVerify.email,
				new Uint8Array(objToVerify.bundle)
			);
		}

		return result;		

	} catch (error) {
		console.error(error.message);
		return { ok: false, error: error.message || "Unknown error during verification." };
	}

}

/**
 * Starts a WebAssembly instance
 * @returns True if a WebAssembly instance is active else False
 */
async function initWasmOnce() {
	if (!wasmReady) {

		wasmReady = (async () => {
			go = new Go();

			const resp = await fetch("./sigverify.wasm"); // Path to the keyless new-bundle-format function of Sigstore in WebAssembly
			const { instance } = await WebAssembly.instantiateStreaming(resp, go.importObject);

			Promise.resolve().then(async () => {
				await go.run(instance); // Safe since it runs after any queued messages has finished processing
			});
		})();
	}

	return wasmReady;
}