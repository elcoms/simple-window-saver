// Full MV3 service worker port (best-effort from original background.js)
// Provides persistent state via chrome.storage.local and listens to window/tab events.

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
  this.tabs = (browserWindow.tabs || []).map(t => ({ url: t.url, pinned: !!t.pinned, title: t.title || '', windowId: t.windowId }));
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

    // let's check if it's one of the open windows and map their IDs to their names
    for (const bw of browserWindows) {
      if (windowsAreEqual(bw, savedWindow)) {
        markWindowAsOpen(bw, name);
        savedWindow = new SavedWindow(bw);
        break; // ignore duplicate windows with the same tabs
      }
    }
  }
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
  if (browserWindow.incognito) {
    return false;
  }
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

  // updateBadgeForWindow(savedWindow.id);
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
    
  // Also remove from windowIdToName and closedWindows if present
  for (const wid in windowIdToName) {
    if (windowIdToName[wid] === name) delete windowIdToName[wid];
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
  
  // backgroundPage._gaq.push(['_trackEvent', 'popup', 'undoDeleteWindow', 'Value is tab count.', savedWindow.tabs.length]);
  
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

// Update internal mapping when a window is removed
async function onWindowRemoved(windowId) {
  const name = windowIdToName[windowId];
  if (name && savedWindows[name]) {
    // mark as closed: keep the savedWindow but clear id
    savedWindows[name].id = undefined;
    closedWindows[name] = savedWindows[name];
    delete windowIdToName[windowId];
    await setAllStorage();
  }
}

// updates a window in response to a tab event
async function onTabChanged(tabId, windowId) {
  chrome.windows.get(windowId, { populate: true }, function(browserWindow) {
    // if the window is saved, we update it
    if (windowIdToName[windowId]) {
      var name = windowIdToName[windowId];
      savedWindows[name] = new SavedWindow(browserWindow);
    } else {
      // otherwise we double check that it's not saved
      for (let i in closedWindows) {
        var savedWindow = closedWindows[i];
        if (windowsAreEqual(browserWindow, savedWindow)) {
          var name = savedWindow.name;
          savedWindows[name] = new SavedWindow(browserWindow); 
          markWindowAsOpen(browserWindow, name);
        }
      }
    }
    if (tabId) {
      // updateBadgeForTab({ id: tabId, windowId: windowId });
    }
  });

  await setAllStorage();
}

// When tabs are updated or created/moved, keep savedWindows in sync if they correspond
async function onTabUpdated(tabId, changeInfo, tab) {
  onTabChanged(tabId, tab.windowId); 
}

async function onTabRemoved(tabId, removeInfo) {
  // skip if tab is closed with window
  if (removeInfo.isWindowClosing) return;

  onTabChanged(tabId, removeInfo.windowId);
}

async function onWindowFocusChanged(windowId) {
  // update savedWindow focused flags
  for (const name of Object.keys(savedWindows)) {
    const s = savedWindows[name];
    s.focused = (s.id === windowId);
  }
  await setAllStorage();
}

// Simple badge update stub (MV3 badges are only on action)
async function updateBadgeForAllWindows() {
  // If you want per-window badges, Chrome MV3 supports chrome.action.setBadgeText only globally.
  // We'll set a count = number of saved windows
  try {
    const count = savedWindowNames.length.toString();
    chrome.action.setBadgeText({text: count});
  } catch (e) {}
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
      } else if (msg && msg.type === 'updateBadgeForAllWindows') {
        await updateBadgeForAllWindows();
        sendResponse({ok:true});
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

// Event listeners to track window/tab lifecycle
chrome.windows.onRemoved.addListener((windowId) => {
  onWindowRemoved(windowId).catch(console.error);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  onWindowFocusChanged(windowId).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  onTabUpdated(tabId, changeInfo, tab).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  onTabRemoved(tabId, removeInfo).catch(console.error);
});

// initialize on startup
initialize().catch(console.error);