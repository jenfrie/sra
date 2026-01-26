document.getElementById("demo").innerHTML = "HELP";

const URL_PARAMS  = new URLSearchParams(window.location.search);

scriptNumber();

async function scriptNumber () {
    const tab = await getActiveTab();
    const vInfo = await chrome.tabs.sendMessage(tab.id, {
                messageType: "SCRIPT_NUMBER"        
    });

    const validationTime = (vInfo.endValidation - vInfo.startValidation) / 1000.0;

    let html = `
    <p><b>${vInfo.validatedScripts + vInfo.cachedScripts}/${vInfo.totalScriptsInHtml} scripts validated in ${validationTime.toFixed(3)} sec. (${vInfo.cachedScripts} cached)</b></p>
    <p><b><span style="color:green">Valid: ${vInfo.validatedScripts}</span></b></p>
    `;

    document.getElementById("demo").innerHTML = html;
} 

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (URL_PARAMS.has("test")) {
    const neighbourTab = await getNeighbourTabIdSequential(tabs[0].id);
    
    return neighbourTab;
  }

  return tabs[0];
}

async function getNeighbourTabIdSequential(currentTabId) {b
  const currentTab = await chrome.tabs.get(currentTabId);
  const windowId = currentTab.windowId;

  const leftNeighborIndex = currentTab.index - 1;

  const tabs = await chrome.tabs.query({windowId: windowId});

  const leftNeighborTab = tabs.find(tab => tab.index === leftNeighborIndex);

  return leftNeighborTab;
}