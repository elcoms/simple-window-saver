// Popup rewritten to use chrome.runtime messaging (MV3-compatible)

let savedWindowListEl, formEl, nameInput, template;
let undo = {};
function $(id){ return document.getElementById(id); }
document.addEventListener('DOMContentLoaded', init);

function init() {
  console.log("init");
  // initialize variables we'll need
  savedWindowListEl = $('savedWindowList');
  formEl = $('form');
  nameInput = $('nameInput');
  template = $('template');

  // initialize links
  formEl.addEventListener('submit', saveWindowHandler);

  // populate list of windows
  refresh();
}

async function refresh() {
  const state = await getState();
  const savedWindows = state.savedWindows || {};
  const savedWindowNames = state.savedWindowNames || [];
  savedWindowListEl.innerHTML = '';
  for (let i = savedWindowNames.length - 1; i >= 0; i--) {
    const name = savedWindowNames[i];
    const savedWindow = savedWindows[name];
    if (!savedWindow) continue;

    savedWindowListEl.appendChild(makeListItem(name, savedWindow));
  }
  
  // display form if current window is not saved or in incognito
  const window = getCurrentWindow();
  const name = state.windowIdToName[window.id];
  if (!name)
    if (window.incognito)
      $('incognitoMsg').style.display = "block";
    else {
      nameInput.value = state.DEFAULT_NAME;
      formEl.style.display = "block";
      nameInput.focus();
      nameInput.select();
    }
}

async function getState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({type:'getState'}, (resp) => resolve(resp));
  });
}

// gather current window via chrome.windows.getCurrent
async function getCurrentWindow() {
  return new Promise((resolve) => {
    chrome.windows.getCurrent({populate:true});
  });
}

async function saveWindowHandler(e) {
  e.preventDefault();
  const displayName = nameInput.value || "";
  const currentWindow = getCurrentWindow();
  console.log("saveWindowHandler");
  const msg = {type:'saveWindow', browserWindow: currentWindow, displayName};
  chrome.runtime.sendMessage(msg, (resp) => {
    // refresh UI
    refresh();
    nameInput.value = "";
  });
}

function makeListItem(name, saved) {
  const li = document.createElement('li');
  li.className = 'savedWindow';
  li.dataset.name = name;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = saved.displayName || name;
  li.appendChild(title);

  const openBtn = document.createElement('button');
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({type:'openWindow', name}, (resp) => { refresh(); });
  });
  li.appendChild(openBtn);

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({type:'deleteSavedWindow', name}, (resp) => { refresh(); });
  });
  li.appendChild(delBtn);

  return li;
}




