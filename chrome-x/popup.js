document.getElementById("demo").innerHTML = "HELP"; // Shows that popup script is running but not correctly

scriptNumber();

// Adds summary received from the content script into the popup
async function scriptNumber () {
    const tab = await getActiveTab();
    // Request from content script a summary of the validation results
    const scriptNumber = await chrome.tabs.sendMessage(tab.id, {
                messageType: "SCRIPT_NUMBER"        
    });

    let html = `<p>
                    Number of Scripts:<ul> 
                        <li>Total: ${scriptNumber.totalScripts}</li>
                        <li>Total in HTML: ${scriptNumber.totalScriptsInHtml}</li>
                        <li>Valid: ${scriptNumber.valid}</li>
                        <li>Blocked: ${scriptNumber.blocked}</li>
                        <li>Other: ${scriptNumber.other}</li>
                    </ul>
                    Average Times:<ul>
                        <li>Total: ${scriptNumber.averageTotal}ms</li>
                        <li>Valid: ${scriptNumber.averageValid}ms</li>
                        <li>Blocked: ${scriptNumber.averageBlocked}ms</li>                   
                    </ul>
                    Median Times:<ul>
                        <li>Total: ${scriptNumber.medianTotal}ms</li>
                        <li>Valid: ${scriptNumber.medianValid}ms</li>
                        <li>Blocked: ${scriptNumber.medianBlocked}ms</li>                   
                    </ul>
                    <li>Total Time: ${scriptNumber.totalTime}ms</li>
                </p>`;

    document.getElementById("demo").innerHTML = html;
} 

/**
 * Searches the tab with webpage where the content script is running
 * @returns The tab ID of the webpage in which the content script is running 
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  // The usual execution uses the Chrome tab of the active tab
  return tabs[0];
}