document.getElementById("demo").innerHTML = "HELP";

scriptNumber();

async function scriptNumber () {
    const tab = await getActiveTab();
    const vInfo = await chrome.tabs.sendMessage(tab.id, {
                messageType: "SCRIPT_NUMBER"        
    });

    let html = `
    <p><b>${vInfo.validatedScripts}/${vInfo.totalScripts} scripts validated in ${vInfo.endValidation} sec. (${vInfo.cached} cached)</b></p>
    <p><b><span style="color:green">Valid: ${vInfo.valid}</span>, <span style="color:red">Invalid: ${vInfo.invalid}</span></b></p>
    `;

    document.getElementById("demo").innerHTML = html;
} 

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}