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
          name = savedWindow.name;
          savedWindows[name] = new SavedWindow(browserWindow);
          markWindowAsOpen(browserWindow, name);
        }
      }
    }

    // update the changed tab if window is saved
    const count = name ? savedWindows[name].tabs.length.toString() : "";
    if (tabId && name) {
      updateBadgeForTab(tabId, count);
    }
  });


  await setAllStorage();
}

// When tabs are updated or created/moved, keep savedWindows in sync if they correspond
async function onTabUpdated(tabId, changeInfo, tab) {
  console.log("onTabUpdated");
  onTabChanged(tabId, tab.windowId);
}

async function onTabRemoved(tabId, removeInfo) {
  // skip if tab is closed with window
  if (removeInfo.isWindowClosing) return;
  onTabChanged(tabId, removeInfo.windowId);
}

async function onTabActivated(tabId, windowId) {
  const name = windowIdToName[windowId];
  console.log("onTabActivated");
  if (name) {
    const count = savedWindows[name].tabs.length.toString();
    updateBadgeForTab(tabId, count);
  }
}

async function onTabDetached(tabId, detachedInfo) {
  const oldWindowId = detachedInfo.oldWindowId;
  console.log("onTabDetached");
  await onTabChanged(tabId, oldWindowId);
  try {
    updateBadgeForTab(tabId, "");
    updateBadgeForWindow(getSavedWindowFromId(oldWindowId));
  } catch (e) {
    console.log("onTabDetached error:" + e);
  }
}

async function onTabAttached(tabId, attachedInfo) {
  const newWindowId = attachedInfo.newWindowId;

  try {
    onTabChanged(tabId, newWindowId);
  } catch (e) {
    console.log(e);
  }
}

// Update badges for new window
async function onWindowCreated(browserWindow) {
  updateBadgeForWindow(browserWindow);
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
  updateBadgeForWindow(getSavedWindowFromId(windowId));
  await setAllStorage();
}
