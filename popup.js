// Popup rewritten to use chrome.runtime messaging (MV3-compatible)

let savedWindowListEl, formEl, nameInput, template;
// let undoInfo = {};
function $(id){ return document.getElementById(id); }
document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log("popup init");
  // initialize variables we'll need
  savedWindowListEl = $('savedWindowList');
  formEl = $('form');
  nameInput = $('nameInput');
  template = $('template');

  // initialize links
  formEl.addEventListener('submit', saveWindowHandler);

  // refresh UI
  refresh();
}

async function refresh() {
  const state = await getState();
  const savedWindows = state.savedWindows || {};
  const savedWindowNames = state.savedWindowNames || [];

  chrome.windows.getCurrent({ populate: true }, async (currentWindow) => {
    const currentWindowName = state.windowIdToName[currentWindow.id];
    
    // display form if current window is not saved or in incognito
    if (!currentWindowName) {
      if (currentWindow.incognito)
        $('incognitoMsg').style.display = "block";

      {
        nameInput.value = state.DEFAULT_NAME;
        formEl.style.display = "block";
        nameInput.focus();
        nameInput.select();
      }
    }
    else {
      formEl.style.display = "none";
    }

    // populate list of windows
    savedWindowListEl.innerHTML = '';
    for (let i = savedWindowNames.length - 1; i >= 0; i--) {
      const name = savedWindowNames[i];
      const savedWindow = savedWindows[name];
      if (!savedWindow) continue;
      appendWindowToList(name, currentWindowName);
    }
  });
}

async function getState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({type:'getState'}, (resp) => resolve(resp));
  });
}

async function saveWindowHandler(e) {
  e.preventDefault();
  const displayName = nameInput.value || "";
  
  // gather current window via chrome.windows.getCurrent
  chrome.windows.getCurrent({ populate: true }, async (currentWindow) => {
    const msg = { type: 'saveWindow', browserWindow: currentWindow, name: displayName };
    chrome.runtime.sendMessage(msg, (resp) => {
      // refresh UI
      refresh();
      nameInput.value = "";
    });
  });
}

async function appendWindowToList(displayName, currentWindowName) {
  // get state again in case it got updated
  const state = await getState();
  const savedWindows = state.savedWindows || {};

  const savedWindow = savedWindows[displayName];
  const li = template.cloneNode(true);
  li.removeAttribute(("id"));
  li.setAttribute("data-name", displayName);
  
  var undoInfo = {};
  li.querySelector(".delete").addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    chrome.runtime.sendMessage({ type: 'deleteSavedWindow', name: displayName }, (resp) => {  });

    undoInfo = {
      class: li.className,
      text: getText(li)
    };
    
    li.className = "deleted";
    setText(li, "<b>" + displayName + "<\/b> was deleted.");

    // show the form if current window
    if (displayName == currentWindowName) {
      nameInput.value = state.DEFAULT_NAME;
      formEl.style.display = "block";
      nameInput.focus();
      nameInput.select();
    }
  });

  li.querySelector(".undo").addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await chrome.runtime.sendMessage({ type: 'undoSavedWindow', name: displayName }, async (resp) => { 
      if (resp) {
        const state = await getState();

        chrome.windows.getCurrent({ populate: true }, async (currentWindow) => {
          const currentWindowName = state.windowIdToName[currentWindow.id];
          
          // display form and update list item if current window is not saved and opened
          if (!currentWindowName) {
            nameInput.value = state.DEFAULT_NAME;
            formEl.style.display = "block";
            nameInput.focus();
            nameInput.select();
          } else formEl.style.display = "none";
        });
        
        // undo UI
        li.className = undoInfo.class;
        setText(li, undoInfo.text);
      }
    });
});
  
  var count = savedWindow.tabs.length;
  var text = displayName + " (" + count + ")";
  // current - not clickable
  if (displayName == currentWindowName) {
    li.className = "current";
    text = "This is <b>" + text + "<\/b>.";
  } 
  // closed saved window - focus
  else if (savedWindow.id && state.windowIdToName[savedWindow.id]) {
    li.className = "open";
    li.addEventListener('click', (e) => {
      e.preventDefault();

      chrome.windows.update(savedWindow.id, {focused: true});
    });
  } 
  // opened saved window - open
  else {
    li.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openWindow', name: displayName }, (resp) => { refresh(); });
    });
  }

  setText(li, text);
  savedWindowListEl.insertBefore(li, savedWindowListEl.firstChild);
}

// given a list element, sets the text
function setText(element, text) {
  element.childNodes[1].innerHTML = text;
}

// given a list element, gets the text
function getText(element) {
  return element.childNodes[1].innerHTML;
}



