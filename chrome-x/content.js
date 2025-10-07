// Represents the start of the test. Will be a part of the filename of the JSON file.
const totalStartTime = performance.now() + performance.timeOrigin;

/*
Both log the results of validated scripts. Array of objects with object structure:
{
	src {string} - Source of the logged script
	email {string} - Used email address to be verified
	issuer {string} - OIDC issuer for given email
}
*/
const validScripts = [];
const blockedScripts = [];

// Represents scripts that don't state an email-address and/or an issuer
let otherTotal = 0;

/*
Both log the performance overhead of each validated script. Array of objects with object structure:
{
	objType {string} - Always EMAIL since we only used the keyless methods of sigstore. (in future could also contain KEY)
	time {number} - Performance overhead of script in ms
	scriptPath {string} - Source of the script
}
*/
const validScriptsTime = [];
const blockedScriptsTime = [];

// Logs the time of last verified script
let lastTimestamp = 0;

/*
Observer that catches script tags present in the HTML. 
Each new script with an email and issuer tag will be blocked, verified and unblocked if proven valid.
*/
const observer = new MutationObserver(mutations => {
	mutations.forEach(({ addedNodes }) => {
		addedNodes.forEach(node => {
			if (node.nodeType === 1 && node.tagName === "SCRIPT") {

				// To guarantee that src is defined
				const src = node.src || "";

				const backupNode = node.cloneNode(true);

				// Making sure that there is a source and the script states an email-address and its issuer for verification
				if (src && node.dataset.email && node.dataset.issuer) {
					const emailVerify = {email: node.dataset.email, issuer: node.dataset.issuer};

					// Start time of script in ms
					const localStartTime = performance.now() + performance.timeOrigin;

					// Checks if script was already added once to prevent infinit validation loops
					if (!validScripts.find(e => e.src === src && e.email === emailVerify.email && e.issuer === emailVerify.issuer)) {
						// Type "javascript/blocked" prevents webpage to load the src elements, since it is not "text/javascript"
						node.type = "javascript/blocked";

						scriptLoader(src, backupNode, emailVerify, localStartTime);

						// Removing node since it's blocked
						node.parentElement.removeChild(node);
					}

				} else {
					otherTotal++;
				}
			}
		})
	})
})

// Starts the observer
observer.observe(document.documentElement, {
	childList: true,
	subtree: true
})

// Waits for requests of popup script, to return the summary of the logged timestamps back to the popup script for the evaluation.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

	if (message.messageType === "SCRIPT_NUMBER") {
		const numberOfScripts = sendScriptInfo(message);

		sendResponse(numberOfScripts)

		return true;
	}
});

/**
 * Sends the information of tested script to background scripts for verification and logs the created overhead.
 * @param {string} scriptPath - Source of script
 * @param {object} backupNode - Backup of script node
 * @param {object} emailVerify - Email with its issuer for verification
 * @param {number} localStartTime - Start time of the script in ms
 */
async function scriptLoader(scriptPath, backupNode, emailVerify, localStartTime) {
	try {

		// Sends validation object to the background script that will verify the inclusion of given attributes in Rekor.
		const test = await chrome.runtime.sendMessage({
			messageType: "VERIFY_HASH",
			scriptPath: scriptPath,
			emailVerify: emailVerify
		});

		if (test.statusCode === "VALID") {
			validScripts.push({ src: scriptPath, email: emailVerify.email, issuer: emailVerify.issuer });

			// Valid scripts are unblocked by reintroducing them back to the webpage 
			createScriptHtml(scriptPath, backupNode, localStartTime);

		} else {
			blockedScripts.push({ src: scriptPath, email: emailVerify.email, issuer: emailVerify.issuer });

			// End time of the of invalid scripts
			const timeStamp = performance.now() + performance.timeOrigin;
			lastTimestamp = timeStamp - totalStartTime;
			blockedScriptsTime.push({ objType: "EMAIL", time: timeStamp - localStartTime, scriptPath: scriptPath });
		}

	} catch (error) {
		console.error(error.message);
	}
}


/**
 * Reintroduces a valid script back to the head of the webpage, therefore, unblocking it.
 * @param {string} scriptPath - Source of the script
 * @param {object} backupNode - Backup of all attributes of the script
 * @param {number} localStartTime - Start time of the script in ms
 */
function createScriptHtml(scriptPath, backupNode, localStartTime) {
	const scriptHtml = document.createElement("script");

	for (const attr of backupNode.attributes) {
		scriptHtml.setAttribute(attr.name, attr.value);
	}
	// Reintroduced into the head of the webpage
	document.head.appendChild(scriptHtml);

	// End time of valid scripts
	const timeStamp = performance.now() + performance.timeOrigin;
	lastTimestamp = timeStamp - totalStartTime;
	validScriptsTime.push({ objType: "EMAIL", time: timeStamp - localStartTime, scriptPath: scriptPath });
}

/**
 * Creates JSON file that can be downloaded for evaluation and sends a summary of the results to the popup script.
 * @param {object} message - Object that contains the message type
 * @returns A summary of the results for the popup script.
 */
function sendScriptInfo(message) {

	if (message.messageType === "SCRIPT_NUMBER") {

		let validScriptsTotalTime = 0;
		let blockedScriptsTotalTime = 0;

		validScriptsTime.forEach(element => { validScriptsTotalTime += element.time });
		blockedScriptsTime.forEach(element => { blockedScriptsTotalTime += element.time });

		/*
		Even though, the timestamps should already be sorted based on time, 
		there are some instances in which a later time stands before an 
		earlier time. Therefore, we sort to make sure.
		*/
		const sortedValid = validScriptsTime.toSorted((a, b) => { a - b });
		const sortedBlocked = blockedScriptsTime.toSorted((a, b) => { a - b });

		const totalScripts = sortedValid.concat(sortedBlocked);
		const sortedTotal = totalScripts.toSorted((a, b) => { a - b });

		// || 0 is used to make sure that all constants will be defined.
		const medianValidElement = sortedValid[Math.floor(validScriptsTime.length / 2)] || 0;
		const medianBlockedElement = sortedBlocked[Math.floor(blockedScriptsTime.length / 2)] || 0;
		const medianTotalElement = sortedTotal[Math.floor(sortedTotal.length / 2)] || 0;

		const date = new Date(totalStartTime);

		// The response that the popup script will display.
		const number = {
			startTime: date.toISOString(),
			valid: validScriptsTime.length,
			blocked: blockedScriptsTime.length,
			other: otherTotal,
			totalScripts: validScriptsTime.length + blockedScriptsTime.length,
			totalScriptsInHtml: document.scripts.length, // To see how many scripts were added back to the webpage
			totalTime: parseInt(lastTimestamp), // Represents the last validated script
			averageTotal: parseInt(
				(validScriptsTotalTime + blockedScriptsTotalTime) /
				(validScriptsTime.length + blockedScriptsTime.length)
			) || 0,
			averageValid: parseInt(validScriptsTotalTime / validScriptsTime.length) || 0,
			averageBlocked: parseInt(blockedScriptsTotalTime / blockedScripts.length) || 0,
			medianTotal: parseInt(medianTotalElement.time) || 0,
			medianValid: parseInt(medianValidElement.time) || 0,
			medianBlocked: parseInt(medianBlockedElement.time) || 0
		};

		// The response to popup script is also a part of the JSON file.
		const toJsonFile = { ...number };

		// All overheads of the validation are part of the JSON file. They will be used to create boxplots.
		toJsonFile.validScriptsTime = validScriptsTime;
		toJsonFile.blockedScriptsTime = blockedScriptsTime;

		const address = window.location.href;
		// Represents the used HTML test file
		const filename = address.substring(address.lastIndexOf('/') + 1);

		// The start time is used in the filename to automatically create new filenames
		// Needs to be removed if the extension is no longer in development, as well as all the over JSON variables.
		downloadObjectAsJson(toJsonFile, "sigwasm_cache_block_" + filename + "_" + parseInt(totalStartTime));


		return number;
	}
}

/**
 * Taken from an answer in https://stackoverflow.com/questions/19721439/download-json-object-as-a-file-from-browser
 * Creates an JSON file of given object that can be downloaded.
 * @param {object} exportObj - JavaScript object to be converted into JSON
 * @param {string} exportName - Chosen filename of the JSON file
 */
function downloadObjectAsJson(exportObj, exportName) {
	let dataStr = "data:text/json; charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
	let downloadAnchorNode = document.createElement("a");
	downloadAnchorNode.setAttribute("href", dataStr);
	downloadAnchorNode.setAttribute("download", exportName + ".json");
	document.body.appendChild(downloadAnchorNode); //required for firefox
	downloadAnchorNode.click();
	downloadAnchorNode.remove();
}