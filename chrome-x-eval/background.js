import "./sigwasm/wasm_exec.js";

chrome.runtime.onStartup.addListener(() => {
	ensureOffscreen();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
	ensureOffscreen();
});


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.messageType === "DOWNLOAD_JSON") {
    const url =
      "data:application/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(msg.payload, null, 2));

    chrome.downloads.download(
      {
        url,
        filename: msg.filename,   // relative to default downloads dir
        saveAs: false
      },
      (downloadId) => {
        sendResponse({ ok: true, downloadId, err: chrome.runtime.lastError?.message });
      }
    );

    return true; // keep sendResponse alive async
  }
});



// Waits for the request of content script, to verify the inclusion of a script in Rekor based on the digest and data-tag of the script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.messageType === "VERIFY_HASH") {
		verification(message.scriptPath, message.emailVerify)
			.then(response => sendResponse(response))
			.catch(err => {
				console.error("Error verifying script:", err);
				sendResponse({ error: "Verification failed" });
			});
		return true;
	}

	if(message.messageType === "CLEARED") {
		//console.log("message")
		notify("CLEARED", message.notification);
		sendResponse("NOTIFIED!!!");
	}
});

/**
 * Creates a notification that will be alerted to the user.
 * @param {string} message - Message that will be part of the notification.
 */
function notify(type, message) {

	let title = "No valid titel type was chosen."

	if (type === "INVALID") {
		title = "Script doesn't guarantee authenticity!";
	} else if (type === "CLEARED") {
		title = "Extension checked static scripts!";
	}
	
	chrome.notifications.create({
		type: "basic",
		iconUrl: "./images/icon128.png",
		title: title,
		message: message
	});
}

/**
 * Returns response stating either that script is VALID or INVALID
 * @param {string} scriptPath - Source of script to be verified
 * @param {object} emailVerify - Email with its issuer to be verified
 * @returns An object with status code stating one of two validation result of the verification. Where:
 * 			{
 * 				statusCode: The validation result. Either:
 * 					"VALID"- Represents a valid Script,
 * 					"INVALID" - Represents a invalid script
 * 			}
 */
async function verification(scriptPath, emailVerify) {
		/*
	- Step 1: We load the JavaScript and bundle from the given source (src)
	- Step 2: We compute the digest of both
	- Step 3: We hash the concatenation of both digests together with the given email address and issuer
	- Step 4: We check if a previous test has already added the resulting digest to the cache. If so:
		- Step 4.a: And it is set as INVALID then we return INVALID
		- Step 4.b: And it is set as VALID then we return VALID else:
	- Step 5: We send all the test parameter to offscreen and receive either
		- Step 5.a: That the combination of test parameter is valid then we add the resulting digest as VALID to the cache and return VALID
		- Step 5.b: That the combination is invalid then we add the resulting digest as INVALID to the cache and return INVALID
		  
		We only notify if a threat exists (INVALID) or all scripts were checked (CLEARED)
	*/

	try {

		await ensureOffscreen();

		/*
		// Loads script from source
		const loadedScript = await fetch(emailVerify.dummy);

		if (!loadedScript.ok) {
			throw new Error("Response status of loaded script: " + loadedScript.status + " " + loadedScript.statusText);
		}

		console.log(loadedScript);

		const dummyOLDBytes = await loadedScript.text();
		*/
		// DummyBytes are hardcoded into the Extension, since loading it would create a false higher overhead. But we still need the dummyBytes for the verification. 
		const dummyBytes = `// Using the structure (() => {...})(); to automatically call the function and to maintain constant "element" in its own scope\r
(() => {\r
    const element = document.getElementById("ve0");\r
    element.innerHTML = "This script still works: ve0!";\r
    element.style.fontSize = "130%";\r
    element.style.fontWeight = "bold";\r
    element.style.backgroundColor = "LightSeaGreen";\r
})();`;

		// With trueScript we are simulatimg the loading process of a script.
		const trueScript = await fetch(scriptPath);

		if (!trueScript.ok) {
			throw new Error("Response status of loaded script: " + trueScript.status + " " + trueScript.statusText);
		}

		const trueBytes = await trueScript.text();

		// Digest of the script to be verified
		//const dummyHash = await digestMessage(scriptBytes);

		// Loads bundle from source
		const loadedBundle = await fetch(emailVerify.dummy + ".sigstore.json", {cache: 'no-store'});

		if (!loadedBundle.ok) {
			notify("INVALID", `Script can't be validated no bundle was found \n${emailVerify.dummy}\n${loadedBundle.status}\n${loadedBundle.statusText}`);
			throw new Error("Response status of loaded bundle: " + loadedBundle.status + " " + loadedBundle.statusText);
		}

		const bundleBytes = await loadedBundle.text();
		// Digest of the script to be verified
		//const bundleHash = await digestMessage(bundleBytes);

		// We combine all test subjects and hash them to use the resulting digest as a key entry in the cache 
		//const testSubjects = dummyHash + bundleHash + emailVerify.email + emailVerify.issuer;
		const testSubjects = trueBytes;
		const testSubjectsHash = await digestMessage(testSubjects);

		const validScriptPairList = await chrome.storage.local.get(testSubjectsHash);
		const validScriptPair = validScriptPairList[testSubjectsHash];

		if (validScriptPair?.valid === false) { //Checks if it is a part of Cache and set as invalid
			notify("INVALID", `Script is INVALID:\n${scriptPath}\n Set as invalid in cache.`);

			return { statusCode: "INVALID" };
		}

		if (validScriptPair?.valid !== true) { //Checks if it is a part of Cache

			const encoder = new TextEncoder();

			// We need to do this since Uint8Arrays lose their types under sendMessage
			const artifactUint8Array = encoder.encode(dummyBytes);
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

			console.log("RESULT: ", result);

			// To use variable object property names		
			const verifiedScript = {};

			if (result.ok) {

				// The source of the script as the object property name and emails have a special structure
				verifiedScript[testSubjectsHash] = { valid: true };

				chrome.storage.local.set(verifiedScript).then(() => console.log(scriptPath + " was added as VALID!"));

				return { statusCode: "VALID", cached: false };

			} else {
				notify("INVALID", `Script is INVALID:\n${scriptPath}\n${result.error}`);

				verifiedScript[testSubjectsHash] = { valid: false };

				chrome.storage.local.set(verifiedScript).then(() => console.log(scriptPath + " was added as INVALID!"));

				return { statusCode: "INVALID" };
			}
		}
		// VALID since already included in Cache
		console.log(scriptPath + " WAS NOT ADDED!");

		return { statusCode: "VALID", cached: true };

	} catch (error) {
		notify("INVALID", `THERE WAS AN ERROR: ${error.message}`);
		console.error(error.message);
		return { statusCode: "ERROR" };
	}
}

/**
 * Inspired by MDN developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
 * We are using crypto instead of window.crypto, since service worker cannot access window parameter
 * 
 * Digests the message with SHA-256 hash function.
 * @param {string} message - Message to be hashed.
 * @returns Digest of the message.
 */
async function digestMessage(message) {
	const msgUint8 = new TextEncoder().encode(message); // encode as (utf-8) Uint8Array
	const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8); // hash the message
	const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join(""); // convert bytes to hex string

	return hashHex;
}

/**
 * We use an offscreen to have a persistent WebAssembly instance of the new bundles format verify function of Sigstore
 */
async function ensureOffscreen() {

	if (!(await chrome.offscreen?.hasDocument())) {
		await chrome.offscreen.createDocument({
			url: chrome.runtime.getURL("sigwasm/offscreen.html"),
			reasons: [chrome.offscreen.Reason.WORKERS],
			justification: "Keep GO WASM ready (in workers for parallelism) in the background for verification (of Sigstore)"
		});
		console.log("STARTED THE BACKGROUND!");
	}
}
