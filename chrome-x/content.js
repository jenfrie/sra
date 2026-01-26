const totalStartTime = performance.now() + performance.timeOrigin;

const validScriptsCached = [];
const invalidScriptsCached = [];

let lastTimestamp = 0;
let totalNumberOfScripts = 0;

if (document?.scripts) {
	totalNumberOfScripts = document.scripts.length;

	const thirdPartyScripts = Array.from(document.scripts);

    checkAllScripts(thirdPartyScripts);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.messageType === "SCRIPT_NUMBER" ) {
		const numberOfScripts = sendScriptInfo();

		sendResponse(numberOfScripts)

		return true;
	}
});

async function checkAllScripts(activeScripts) {
	activeScripts.forEach(async script => {	

		const emailVerify = {src: script.src, email: script.dataset.email, issuer: script.dataset.issuer};

		scriptLoader(emailVerify);
	});
}

async function scriptLoader(emailVerify) {
	try {
		const test = await chrome.runtime.sendMessage({
			messageType: "VERIFY_HASH",
			emailVerify: emailVerify,
		});

		if (test.statusCode === "VALID") {
			lastTimestamp = performance.now() + performance.timeOrigin;
			validScriptsCached.push({cached: test.cached});

		} else {
			lastTimestamp = performance.now() + performance.timeOrigin;
			invalidScriptsCached.push({cached: test.cached});
		}
	} catch (error) { 
		console.error(error.message);
	}
}

function sendScriptInfo() {

	const valid = validScriptsCached.length || 0;
	const invalid = invalidScriptsCached.length || 0;

	let cached = validScriptsCached.reduce(countCached, 0);
	cached = invalidScriptsCached.reduce(countCached, cached);

	const endValidation = (lastTimestamp - totalStartTime) / 1000.0;

	const number = {
		endValidation: endValidation.toFixed(3),
		valid: valid,
		invalid: invalid,
		cached: cached,
		validatedScripts: valid + invalid,
		totalScripts: totalNumberOfScripts	
	};

	return number;
}

function countCached(cachedTotal, scriptInfo) {
	if (scriptInfo.cached) { return ++cachedTotal; }

	return cachedTotal;
}