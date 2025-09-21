/* TAB EVENTS */
// For most tab events, we simply resave the entire window.
// While more wasteful, this makes the code much more robust.

// updates a window in response to a tab event
async function onTabChanged(tabId, windowId) {
  chrome.windows.get(windowId, { populate: true }, function (browserWindow) {
    // if the window is saved, we update it
    var name = windowIdToName[windowId];
    if (name) {
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

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tab) => {
      if (tabId || tab[0].id != tabId) {
        const count = savedWindows[name].tabs.length.toString();
        updateBadgeForTab(tab[0].id, count);
      }
    });
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

async function onTabActivated(tabId, windowId) {
  const name = windowIdToName[windowId];
  if (name) {
    const count = savedWindows[name].tabs.length.toString();
    updateBadgeForTab(tabId, count);
  }
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

async function onWindowFocusChanged(windowId) {
  // update savedWindow focused flags
  for (const name of Object.keys(savedWindows)) {
    const s = savedWindows[name];
    s.focused = (s.id === windowId);
  }
  updateBadgeForWindow(savedWindows[windowIdToName[windowId]]);
  await setAllStorage();
}

// Simple badge update stub (MV3 badges are only on action)
async function updateBadgeForTab(tabId, count) {
  try {
    chrome.action.setBadgeText({ tabId, text: count });
    chrome.action.setBadgeBackgroundColor({ color: 'green' });
  } catch (e) { console.log(e); }
}

async function updateBadgeForWindow(window) {
  try {
    const count = window.tabs.length.toString();
    for (let i in window.tabs) {
      updateBadgeForTab(window.tabs[i].id, count);
    }
  } catch (e) { console.log(e); }
}

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

chrome.tabs.onActivated.addListener((activeInfo) => {
  onTabActivated(activeInfo.tabId, activeInfo.windowId);
});