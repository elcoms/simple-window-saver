// Full MV3 service worker port (best-effort from original background.js)
// Provides persistent state via chrome.storage.local and listens to window/tab events.

try {
  importScripts("./eventHandlers.js");
} catch (e) {
  console.log(e);
}

const DEFAULT_NAME = "Window";

/* BASIC STATE */
// an array of the names of all saved windows
let savedWindowNames = [];

// saved windows, keyed by name
// If the savedWindow has an id, it is currently open.
// Each savedWindow can only correspond to one open window at any given time.
let savedWindows = {}; // name -> savedWindow object

// map the ids of open windows to saved window names
// used to respond to events
let windowIdToName = {}; // open browser window id -> savedWindow name

/* EDGE CASES */
// saved windows that aren't currently open, keyed by name
// used to match new windows to saved windows that are still closed
let closedWindows = {}; // name -> savedWindow for closed windows

// Saved Windows that got deleted this session
let undoWindows = new Object();
;
// Custom SavedWindow object to save only what we need
function SavedWindow(browserWindow) {
  this.id = browserWindow.id;
  this.focused = browserWindow.focused;
  this.tabs = (browserWindow.tabs || []).map(t => ({ id: t.id, url: t.url, pinned: !!t.pinned, title: t.title || '', windowId: t.windowId }));
};

// helper to read/write chrome.storage.local
 async function getAllStorage() {
  const data = await chrome.storage.local.get(['savedWindowNames','savedWindows','windowIdToName','closedWindows']);
  return {
    savedWindowNames: data.savedWindowNames || [],
    savedWindows: data.savedWindows || {},
    windowIdToName: data.windowIdToName || {},
    closedWindows: data.closedWindows || {}
  };
}

 async function setAllStorage() {
  await chrome.storage.local.set({
    savedWindowNames,
    savedWindows,
    windowIdToName,
    closedWindows
  });
}

function getSavedWindowFromId(id) {
  return savedWindows[windowIdToName[id]];
}

// Initialize state from storage and current windows
async function initialize() {
  const s = await getAllStorage();
  const browserWindows = await chrome.windows.getAll({ populate: true });
  savedWindowNames = s.savedWindowNames;
  savedWindows = s.savedWindows;
  windowIdToName = s.windowIdToName;
  closedWindows = s.closedWindows;

  // Ensure savedWindowNames exists and savedWindows has entries
  if (!Array.isArray(savedWindowNames)) savedWindowNames = [];
  if (typeof savedWindows !== 'object') savedWindows = {};
  if (typeof closedWindows !== 'object') closedWindows = {};

  // Clear windows IDs from previous session
  windowIdToName = {};

  // Clean up orphan names and windows
  syncNamesToWindows();

  // Reconcile: check open windows and mark windows as open if necessary
  for (let i in savedWindowNames) {
    let name = savedWindowNames[i];
    let savedWindow = savedWindows[name];
    
    // all windows start as closed until verified
    closedWindows[name] = savedWindow;
    savedWindow.id = undefined;

    // let's check if it's one of the open windows and map their IDs to their names
    for (const bw of browserWindows) {
      if (windowsAreEqual(bw, savedWindow)) {
        markWindowAsOpen(bw, name);
        savedWindow = new SavedWindow(bw);
        break; // ignore duplicate windows with the same tabs
      }
    }
  }

  // updateBadgeForCurrentWindow();
  await setAllStorage();
  console.log("Service worker initialized. Saved windows:", savedWindowNames.length);
}

// ensure saved names and saved windows are synchronized, skip by checking length (not the best but if there's an orphaned name, most likely the length are different)
// clean up orphaned names or windows
async function syncNamesToWindows() {
  if (savedWindowNames.length == savedWindows.length)
    return;

  let updatedSavedWindows = {};
  for (let i in savedWindowNames) {
    let name = savedWindowNames[i];
    let savedWindow = savedWindows[name];

    // Clean up orphaned names with no windows, else mark as saved window
    if (!savedWindow) {
      savedWindowNames.splice(savedWindowNames.indexOf(name), 1);
    }
    else {
      updatedSavedWindows[name] = savedWindow;
      delete savedWindows[name];
    }
  }

  savedWindows = updatedSavedWindows;
  await setAllStorage();
}

// compares a current window to a saved window
// we are optimistic here: as long as the tabs of the new window
// match those of the saved window, we consider them equal
// even if the new window has more tabs
function windowsAreEqual(browserWindow, savedWindow) {
  if (!browserWindow.tabs || !savedWindow.tabs) {
    return false;
  }
  if (browserWindow.tabs.length < savedWindow.tabs.length || savedWindow.tabs.length == 0) {
    return false;
  }
  for (var i in savedWindow.tabs) {
    if (browserWindow.tabs[i].url != savedWindow.tabs[i].url) {
      return false;
    }
  }
  return true;
}

async function markWindowAsOpen(browserWindow, displayName) {
  delete closedWindows[displayName];
  windowIdToName[browserWindow.id] = displayName;
  savedWindows[displayName].id = browserWindow.id;
  updateBadgeForWindow(browserWindow);
}

async function saveWindow(browserWindow, displayName) {
  // we don't accept empty or duplicate names
  if (displayName == "" || savedWindows[displayName]) return;

  const newWindow = new SavedWindow(browserWindow);
  savedWindows[displayName] = newWindow;
  savedWindowNames.push(displayName);
  markWindowAsOpen(browserWindow, displayName);

  await setAllStorage();
  return browserWindow;
}

async function deleteSavedWindow(name) {
  // save info for undo
  const idx = savedWindowNames.indexOf(name);
  if (savedWindows[name]) {
    undoWindows[name] = { 
      savedWindow: savedWindows[name],
      index: idx,
      closedWindow: closedWindows[name]
    };
    delete savedWindows[name]; 
  }

  if (idx >= 0) savedWindowNames.splice(idx, 1);  

  
  // console.log(bw);
  // Also remove from windowIdToName and closedWindows if present
  for (const wid in windowIdToName) {
    if (windowIdToName[wid] === name) {
      // get browserwindow, delete from windowIdToName then update badge
      try {
        const bw = await chrome.windows.get(+wid, {
          populate: true,
          windowTypes: ['normal']
        });
        updateBadgeForWindow(bw);
      } catch (error) {
        console.error(error);
      }
      delete windowIdToName[wid];
      break;
    }
  }
  if (closedWindows[name]) delete closedWindows[name];

  await setAllStorage();
  return true;
}

// undo a deletion
// called when the user presse the undo button
async function undoDeleteSavedWindow(name) {
  var savedWindow = undoWindows[name].savedWindow;
  const index = undoWindows[name].index;

  // resave window in the same index
  savedWindows[name] = savedWindow;
  savedWindowNames.splice(index, 0, name);

  // mark it as closed or open
  if (undoWindows.closedWindow) { closedWindows[name] = savedWindow; console.log("Closed");}
  else markWindowAsOpen(savedWindow, name);

  
  // clean up
  delete undoWindows[name];
  
  await setAllStorage();
  return true;
}

async function openWindow(name) {

  // if the window was opened from a new tab, close the new tab
  await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: "chrome://newtab/" }, function (tab) {
    if (tab[0])
      chrome.tabs.remove(tab[0].id);
  });
  
  // compile the raw list of urls
  const saved = savedWindows[name];
  if (!saved) throw new Error("Window not found: " + name);
  const urls = saved.tabs.map(t => t.url || 'about:blank');

  // create a window and open the tabs in it.
  const createData = { url: urls };
  const win = await chrome.windows.create(createData);
  saved.id = win.id;
  windowIdToName[win.id] = name;
  markWindowAsOpen(win, name);

  // try pinning
  for (let i = 0; i < saved.tabs.length && i < win.tabs.length; i++) {
    if (saved.tabs[i].pinned) {
      try { chrome.tabs.update(win.tabs[i].id, { pinned: true }); } catch (e) { }
    }
  }
  
  // move the window to the end of the list (so it appears at the top of the popup)
  savedWindowNames.splice(savedWindowNames.indexOf(name), 1);
  savedWindowNames[savedWindowNames.length] = name;
  await setAllStorage();

  
  return {saved, win};
}

// message handling
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === 'getState') {
        const state = await getAllStorage();
        // Also include DEFAULT_NAME
        sendResponse({ DEFAULT_NAME, ...state });
        return;
      } else if (msg && msg.type === 'saveWindow') {
        // browserWindow may be an object from popup; ensure it has tabs if not, fetch
        let bw = msg.browserWindow;
        if (!bw || !bw.tabs) {
          try {
            bw = await chrome.windows.getCurrent({populate:true});
          } catch(e){}
        }
        const saved = await saveWindow(bw, msg.name || "");
        sendResponse({saved});
        return;
      } else if (msg && msg.type === 'deleteSavedWindow') {
        await deleteSavedWindow(msg.name);
        sendResponse({ok:true});
        return;
      } else if (msg && msg.type === 'undoSavedWindow') {
        console.log("undo msg");
        const res = await undoDeleteSavedWindow(msg.name);
        sendResponse(res);
        return;
      } else if (msg && msg.type === 'openWindow') {
        const res = await openWindow(msg.name);
        sendResponse({ok:true, res});
        return;
      } else if (msg && msg.type === 'updateMsgCount') {
        // stub: set badge text to msg.count
        try { chrome.action.setBadgeText({text: String(msg.count)}); } catch(e){}
        sendResponse({ok:true});
        return;
      } else {
        sendResponse({error:'unknown message'});
        return;
      }
    } catch (err) {
      sendResponse({error:err.message});
    }
  })();
  return true;
});

// Simple badge update stub (MV3 badges are only on action)
async function updateBadgeForTab(tabId, count) {
  try {
    // check if window is saved before updating badge
    if (count != "") {
      const tab = await chrome.tabs.get(tabId);
      if (!windowIdToName[tab.windowId]) count = "";
    }
    chrome.action.setBadgeText({ tabId, text: count });
    chrome.action.setBadgeBackgroundColor({ color: 'green' });
  } catch (e) { console.log(e); }
}

async function updateBadgeForWindow(browserWindow) {
  if (!browserWindow || !browserWindow.id) return;
  const count = windowIdToName[browserWindow.id] ? browserWindow.tabs.length.toString() : "";
  for (let i in browserWindow.tabs) {
    updateBadgeForTab(browserWindow.tabs[i].id, count);
  }
}

// Event listeners to track window/tab lifecycle
chrome.windows.onCreated.addListener((window) => {
  onWindowCreated(window).catch(console.error);
}, { windowTypes: ['normal'] });

chrome.windows.onRemoved.addListener((windowId) => {
  onWindowRemoved(windowId).catch(console.error);
}, { windowTypes: ['normal'] });

chrome.windows.onFocusChanged.addListener((windowId) => {
  onWindowFocusChanged(windowId).catch(console.error);
}, { windowTypes: ['normal'] });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  onTabUpdated(tabId, changeInfo, tab).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  onTabRemoved(tabId, removeInfo).catch(console.error);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  onTabActivated(activeInfo.tabId, activeInfo.windowId);
});

chrome.tabs.onDetached.addListener((tabId, detachedInfo) => {
  onTabDetached(tabId, detachedInfo);
});

chrome.tabs.onAttached.addListener((tabId, attachedInfo) => {
  onTabAttached(tabId, attachedInfo);
});

// initialize on startup
initialize().catch(console.error);