import "./sigwasm/wasm_exec.js";

chrome.runtime.onStartup.addListener(() => {
	ensureOffscreen();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
	ensureOffscreen();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.messageType === "VERIFY_HASH") {
		verification(message.emailVerify)
			.then(response => sendResponse(response))
			.catch(err => {
				console.error("Error verifying script:", err);
				sendResponse({ error: "Verification failed" });
			});

		return true;
	}
});

async function verification(emailVerify) {

	try {
		await ensureOffscreen();

		const trueScript = await fetch(emailVerify.src);

		if (!trueScript.ok) {
			throw new Error("Response status of loaded script: " + trueScript.status + " " + trueScript.statusText);
		}

		const trueBytes = await trueScript.text();

		const loadedBundle = await fetch(emailVerify.src + ".sigstore.json", {cache: 'no-store'});

		if (!loadedBundle.ok) {
			notify("INVALID", `Script can't be validated, no bundle was found \n${emailVerify.src}\n${loadedBundle.status}\n${loadedBundle.statusText}`);
			throw new Error("Response status of loaded bundle: " + loadedBundle.status + " " + loadedBundle.statusText);
		}

		const bundleBytes = await loadedBundle.text();

		const testSubjects = trueBytes + bundleBytes + emailVerify.email + emailVerify.issuer;
		const testSubjectsHash = await digestMessage(testSubjects);

		const validScriptPairList = await chrome.storage.local.get(testSubjectsHash);
		const validScriptPair = validScriptPairList[testSubjectsHash];

		if (validScriptPair?.valid === false) {
			notify("INVALID", `\n${emailVerify.src}\nSet as invalid in cache.`);

			return { statusCode: "INVALID", cached: true };
		}

		if (validScriptPair?.valid === true) { return { statusCode: "VALID", cached: true }; }

		const encoder = new TextEncoder();

		const artifactUint8Array = encoder.encode(trueBytes);
		const artifactArray = Array.from(artifactUint8Array);

		const bundleUint8Array = encoder.encode(bundleBytes);
		const bundleArray = Array.from(bundleUint8Array);

		const objToVerify = {
			artifact: artifactArray,
			bundle: bundleArray,
			email: emailVerify.email,
			issuer: emailVerify.issuer
		}

		const result = await chrome.runtime.sendMessage({ messageType: "OFFSCREEN_VERIFY", objToVerify: objToVerify });
	
		const verifiedScript = {};

		if (result.ok) {

			verifiedScript[testSubjectsHash] = { valid: true };

			chrome.storage.local.set(verifiedScript);

			return { statusCode: "VALID", cached: false };

		}

		notify("INVALID", `\n${emailVerify.src}\n${result.error}`);

		verifiedScript[testSubjectsHash] = { valid: false };

		chrome.storage.local.set(verifiedScript);

		return { statusCode: "INVALID", cached: false };

	} catch (error) {
		notify("INVALID", `THERE WAS AN ERROR: ${error.message}`);
		return { statusCode: "ERROR", cached: false };
	}
}

async function ensureOffscreen() {

	if (!(await chrome.offscreen?.hasDocument())) {
		await chrome.offscreen.createDocument({
			url: chrome.runtime.getURL("sigwasm/offscreen.html"),
			reasons: [chrome.offscreen.Reason.WORKERS],
			justification: "Keep GO WASM ready (in workers for parallelism) in the background for verification (of Sigstore)"
		});
	}
}

function notify(type, message) {

	let title = "No valid titel type was chosen."

	if (type === "INVALID") {
		title = "Script is INVALID!";
	}

	chrome.notifications.create({
		type: "basic",
		iconUrl: "./images/icon128.png",
		title: title,
		message: message
	});
}

async function digestMessage(message) {
	const msgUint8 = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return hashHex;
}