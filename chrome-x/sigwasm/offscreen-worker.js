importScripts("wasm_exec.js");

let go;
let wasmReady;

self.onmessage = async (event) => {

    result = await offscreenWorkerVerify(event.data);

	postMessage(result);
}

async function offscreenWorkerVerify(objToVerify) {
	if (!objToVerify) {
		return { ok: false, error: "Received nothing for the validation."};
	}

	await initWasmOnce();

	try {
		let result = { ok: false, error: "Script doesn't have a valid email adress and/or OIDC issuer." };

		if (objToVerify?.email) {
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

async function initWasmOnce() {
	if (!wasmReady) {

		wasmReady = (async () => {
			go = new Go();

			const resp = await fetch("./sigverify.wasm");
			const { instance } = await WebAssembly.instantiateStreaming(resp, go.importObject);

			Promise.resolve().then(async () => {
				await go.run(instance);
			});
		})();
	}

	return wasmReady;
}