const totalStartTime = performance.now() + performance.timeOrigin;

const validScripts = [];
const invalidScripts = [];
const cachedScripts = [];

let otherTotal = 0;

const validScriptsTime = [];
const invalidScriptsTime = [];
const cachedScriptsTime = [];

let lastTimestamp = 0;
let totalNumberOfScripts = 0;

if (document?.scripts) {
	totalNumberOfScripts = document.scripts.length;

	const pageOrigin = window.location.origin;

	const thirdPartyScripts = Array.from(document.scripts).filter(s => {
		if (!s?.src) return false;
		if (!/^https?:\/\//i.test(s.src)) return false; 

		try {
		const u = new URL(s.src, pageOrigin);
		return u.origin !== pageOrigin;
		} catch {
		return false;
		}
	});

	checkAllScripts(thirdPartyScripts);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.messageType === "SCRIPT_NUMBER" ) {
		const numberOfScripts = sendScriptInfo(message);

		sendResponse(numberOfScripts)

		return true;
	}
});

async function checkAllScripts(activeScripts) {
	const promises = activeScripts.map(async script => {

		const localStartTime = performance.now() + performance.timeOrigin;	

		const emailVerify = {dummy: "https://d360kx62njor0k.cloudfront.net/ve0/ve0.js", email: "99sigitest99@gmail.com", issuer: "https://accounts.google.com"};

		const scriptChecked = await scriptLoader(script.src, emailVerify, localStartTime);

		return scriptChecked;
	});
	const checkedScripts = await Promise.all(promises);

	const filteredScripts = checkedScripts.filter(result => {
		if (result?.checked) {
			return result.checked === true;
		}

		return false;
	});

	const cleared = filteredScripts.length === activeScripts.length;
	let notification = `All ${filteredScripts.length} scripts were checked successfully!`;
	
	if (!cleared) {
		notification = `Only ${filteredScripts.length} of ${activeScripts.length} scripts were checked successfully!`;	
	}

	const clearedMessage = await chrome.runtime.sendMessage({
		messageType: "CLEARED",
		notification: notification
	});

	sendScriptInfo({ messageType: "SCRIPT_NUMBER" });

}

async function scriptLoader(scriptPath, emailVerify, localStartTime) {
	try {

		const test = await chrome.runtime.sendMessage({
			messageType: "VERIFY_HASH",
			scriptPath: scriptPath,
			emailVerify: emailVerify,
		});

		if (test.statusCode === "VALID") {
			if (test.cached === true) {
			    cachedScripts.push({ src: scriptPath, dummy: emailVerify.dummy, email: emailVerify.email, issuer: emailVerify.issuer });

                const timeStamp = performance.now() + performance.timeOrigin;
                lastTimestamp = timeStamp;
                cachedScriptsTime.push({finished: timeStamp, scriptPath: scriptPath});

			} else {
                validScripts.push({ src: scriptPath, dummy: emailVerify.dummy, email: emailVerify.email, issuer: emailVerify.issuer });

                const timeStamp = performance.now() + performance.timeOrigin;
                lastTimestamp = timeStamp;
                validScriptsTime.push({finished: timeStamp, scriptPath: scriptPath});
			}

		} else {
			invalidScripts.push({ src: scriptPath, dummy: emailVerify.dummy, email: emailVerify.email, issuer: emailVerify.issuer })

			const timeStamp = performance.now() + performance.timeOrigin;
			lastTimestamp = timeStamp;
			invalidScriptsTime.push({finished: timeStamp, scriptPath: scriptPath});
		}

		return { checked: true }

	} catch (error) { 
		console.error(error.message);
		return { checked: false, error: "Script could not be checked. Received Error: " + error.message}
	}
}

function sendScriptInfo(message) {

	if (message.messageType === "SCRIPT_NUMBER") {

		let validScriptsTotalTime = 0;
		let cachedScriptsTotalTime = 0;

		validScriptsTime.forEach(element => { validScriptsTotalTime += element.time });
		cachedScriptsTime.forEach(element => { cachedScriptsTotalTime += element.time });

		const number = {
			startValidation: totalStartTime,
			endValidation: lastTimestamp,
			validatedScripts: validScriptsTime.length,
			cachedScripts: cachedScriptsTime.length,
			totalScriptsInHtml: totalNumberOfScripts
		};

		const toJsonFile = { ...number };

		toJsonFile.validScriptsTime = validScriptsTime;
		toJsonFile.cachedScriptsTime = cachedScriptsTime;

		const address = window.location.href;

		const filename = address.substring(address.lastIndexOf('/') + 1);


		chrome.runtime.sendMessage({
			messageType: "DOWNLOAD_JSON",
			filename: "sigwasm_cache_no_block_" + filename + "_" + Math.trunc(totalStartTime) + ".json",
			payload: toJsonFile
		});

		return number;
	}
}