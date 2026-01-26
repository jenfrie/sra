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
        filename: msg.filename,
        saveAs: false
      },
      (downloadId) => {
        sendResponse({ ok: true, downloadId, err: chrome.runtime.lastError?.message });
      }
    );

    return true;
  }
});

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
		notify("CLEARED", message.notification);
		sendResponse("NOTIFIED!!!");
	}
});

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

async function verification(scriptPath, emailVerify) {

	try {

		await ensureOffscreen();

		const dummyBytes = `// Using the structure (() => {...})(); to automatically call the function and to maintain constant "element" in its own scope\r
(() => {\r
    const element = document.getElementById("ve0");\r
    element.innerHTML = "This script still works: ve0!";\r
    element.style.fontSize = "130%";\r
    element.style.fontWeight = "bold";\r
    element.style.backgroundColor = "LightSeaGreen";\r
})();`;

		const trueScript = await fetch(scriptPath);

		if (!trueScript.ok) {
			throw new Error("Response status of loaded script: " + trueScript.status + " " + trueScript.statusText);
		}

		const trueBytes = await trueScript.text();

		const loadedBundle = await fetch(emailVerify.dummy + ".sigstore.json", {cache: 'no-store'});

		if (!loadedBundle.ok) {
			notify("INVALID", `Script can't be validated no bundle was found \n${emailVerify.dummy}\n${loadedBundle.status}\n${loadedBundle.statusText}`);
			throw new Error("Response status of loaded bundle: " + loadedBundle.status + " " + loadedBundle.statusText);
		}

		const bundleBytes = await loadedBundle.text();

		const testSubjects = trueBytes;
		const testSubjectsHash = await digestMessage(testSubjects);

		const validScriptPairList = await chrome.storage.local.get(testSubjectsHash);
		const validScriptPair = validScriptPairList[testSubjectsHash];

		if (validScriptPair?.valid === false) {
			notify("INVALID", `Script is INVALID:\n${scriptPath}\n Set as invalid in cache.`);

			return { statusCode: "INVALID" };
		}

		if (validScriptPair?.valid !== true) {

			const encoder = new TextEncoder();

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
		
			const verifiedScript = {};

			if (result.ok) {

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
		console.log(scriptPath + " WAS NOT ADDED!");

		return { statusCode: "VALID", cached: true };

	} catch (error) {
		notify("INVALID", `THERE WAS AN ERROR: ${error.message}`);
		console.error(error.message);
		return { statusCode: "ERROR" };
	}
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