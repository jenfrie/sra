document.getElementById("demo").innerHTML = "HELP"; // Shows that popup script is running but not correctly

// Receives the parameter by Selenium if we test automatically. 
// Needs to be removed if extension is not in development anymore.
const URL_PARAMS  = new URLSearchParams(window.location.search);

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

  // Used for automated testing in Selenium, since Selenium opens the popup html in an seperate tab
  // Needs to be removed if extension is not in development anymore.
  if (URL_PARAMS.has("test")) {
    const neighbourTab = await getNeighbourTabIdSequential(tabs[0].id);
    
    return neighbourTab;
  }

  // The usual execution uses the Chrome tab of the active tab
  return tabs[0];
}

/**
 * Finds the left neighbour of given Chrome tab ID
 * @param {number} currentTabId - Chrome tab id of the popup HTML webpage
 * @returns The Chrome tab ID of its left neighbour. It should be the webpage in which the content script is running.
 * 
 * Needs to be removed if extension is not in development anymore.
 */
async function getNeighbourTabIdSequential(currentTabId) {
  // To Recieve the window ID and ID of the left neighbour we need the whole current tab
  const currentTab = await chrome.tabs.get(currentTabId);
  const windowId = currentTab.windowId;
  // Left neighbour, since we open the test popup always to the right
  const leftNeighborIndex = currentTab.index - 1;
  // To get all tabs in the window
  const tabs = await chrome.tabs.query({windowId: windowId});
  // Find Chrome left neighbours' Chrome Tab
  const leftNeighborTab = tabs.find(tab => tab.index === leftNeighborIndex);

  return leftNeighborTab;
}