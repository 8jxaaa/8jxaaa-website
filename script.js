(function () {
  var navLinks = document.querySelectorAll(".nav-link");
  var tabContents = document.querySelectorAll(".tab-content");
  var tabDropdown = document.getElementById("tabDropdown");
  var websiteGroup = document.getElementById("websiteGroup");
  var websiteToggle = document.getElementById("websiteToggle");
  var themeToggleBtn = document.getElementById("themeToggleBtn");
  var appContainer = document.getElementById("appContainer");
  var desktopShell = document.getElementById("desktopShell");
  var desktopAppsGrid = document.getElementById("desktopAppsGrid");
  var appTitle = document.getElementById("downloadArchiveTitle");
  var prefersReducedMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var tabTransitionMs = prefersReducedMotion ? 0 : 340;
  var articleViewTransitionMs = prefersReducedMotion ? 0 : 320;
  var activeTab = null;
  var tabCleanupTimer = null;
  var tabSwitchToken = 0;
  var themeShiftTimer = null;
  var snackbarTimer = null;
  var scrollObserver = null;
  var revealObserverProfile = "";
  var revealRefreshTimer = null;
  var desktopUnlocked = false;
  var NOTES_FILES_KEY = "archNotesFilesV1";
  var pendingNotesPayload = null;
  var systemWindowZ = 90;
  var systemWindowOffset = 0;
  var articleViewController = null;
  var terminalCommandRunner = null;
  var FORCE_UI_KEY = "archForcedUiMode";
  var UPDATE_REMINDER_DISABLED_KEY = "archUpdateReminderDisabled";
  var UPDATE_REMINDER_SESSION_KEY = "archUpdateReminderDismissed";
  var revealSelector = ".content-item, .content-item-2, .content-item-3, .content-item-39, .server-status-row, .math-button, .math-instructions, .equation-help, .math-form, .math-result, .math-steps, .calculator-content, .update-header, .update-item, .float-appear";
  var STATUS_TEXT_BY_COLOR = {
    green: "Working",
    yellow: "Corrupted",
    red: "Not Working"
  };

  function getTabTransitionDuration() {
    if (prefersReducedMotion) {
      return 0;
    }
    return document.body.classList.contains("arch-upgraded") ? 420 : tabTransitionMs;
  }

  function getForcedUiMode() {
    if (document.body.classList.contains("force-mobile-ui")) {
      return "mobile";
    }
    if (document.body.classList.contains("force-pc-ui")) {
      return "pc";
    }
    return "";
  }

  function applyForcedUiMode(mode) {
    var normalized = mode === "mobile" || mode === "pc" ? mode : "";
    document.body.classList.toggle("force-mobile-ui", normalized === "mobile");
    document.body.classList.toggle("force-pc-ui", normalized === "pc");
    try {
      if (normalized) {
        window.localStorage.setItem(FORCE_UI_KEY, normalized);
      } else {
        window.localStorage.removeItem(FORCE_UI_KEY);
      }
    } catch (error) {
    }
  }

  function applyStoredUiMode() {
    try {
      applyForcedUiMode(window.localStorage.getItem(FORCE_UI_KEY) || "");
    } catch (error) {
      applyForcedUiMode("");
    }
  }

  function setWebsiteGroupOpen(isOpen) {
    if (!websiteGroup || !websiteToggle) {
      return;
    }
    websiteGroup.classList.toggle("open", isOpen);
    websiteToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function syncServerStateRow(rowElement) {
    if (!rowElement) {
      return;
    }

    var dot = rowElement.querySelector(".status-dot");
    var state = rowElement.querySelector(".server-state");
    if (!dot || !state) {
      return;
    }

    if (dot.classList.contains("green")) {
      state.textContent = STATUS_TEXT_BY_COLOR.green;
      return;
    }
    if (dot.classList.contains("yellow")) {
      state.textContent = STATUS_TEXT_BY_COLOR.yellow;
      return;
    }
    if (dot.classList.contains("red")) {
      state.textContent = STATUS_TEXT_BY_COLOR.red;
    }
  }

  function syncAllServerStates() {
    var rows = document.querySelectorAll(".server-status-row");
    rows.forEach(function (row) {
      syncServerStateRow(row);
    });
  }

  function watchServerStateDotChanges() {
    var dots = document.querySelectorAll(".server-status-row .status-dot");
    dots.forEach(function (dot) {
      var observer = new MutationObserver(function () {
        var row = dot.closest(".server-status-row");
        syncServerStateRow(row);
      });
      observer.observe(dot, { attributes: true, attributeFilter: ["class"] });
    });
  }

  function getSnackbarElement() {
    var el = document.getElementById("snackbar");
    if (el) {
      return el;
    }
    el = document.createElement("div");
    el.id = "snackbar";
    el.className = "snackbar";
    document.body.appendChild(el);
    return el;
  }

  function showSnackbarFallback(message) {
    var el = getSnackbarElement();
    el.textContent = message;
    el.classList.add("show");
    if (snackbarTimer) {
      window.clearTimeout(snackbarTimer);
    }
    snackbarTimer = window.setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  }

  function notifySnackbar(message) {
    if (typeof window.showSnackbar === "function") {
      window.showSnackbar(message);
      return;
    }
    showSnackbarFallback(message);
  }

  function setDesktopVisible(isVisible) {
    if (!desktopShell || !appContainer) {
      return;
    }
    desktopShell.classList.toggle("is-active", isVisible);
    document.body.classList.toggle("desktop-mode", isVisible);
    desktopShell.setAttribute("aria-hidden", isVisible ? "false" : "true");
    appContainer.setAttribute("aria-hidden", isVisible ? "true" : "false");
  }

  function enterDesktop() {
    setDesktopVisible(true);
  }

  function exitDesktop() {
    setDesktopVisible(false);
  }

  function setupDesktopGate() {
    if (!appTitle) {
      return;
    }
    appTitle.addEventListener("click", function () {
      desktopUnlocked = true;
      enterDesktop();
    });
  }

  function loadNotesFiles() {
    try {
      var raw = localStorage.getItem(NOTES_FILES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveNotesFiles(files) {
    localStorage.setItem(NOTES_FILES_KEY, JSON.stringify(files));
  }

  function upsertNotesFile(name, content) {
    var clean = (name || "").trim();
    if (!clean) return { ok: false, message: "Filename required" };
    var files = loadNotesFiles();
    var now = new Date().toISOString();
    var existing = files.find(function(f) { return f.name.toLowerCase() === clean.toLowerCase(); });
    if (existing) {
      existing.content = content;
      existing.updatedAt = now;
    } else {
      files.unshift({ name: clean, content: content, createdAt: now, updatedAt: now });
    }
    saveNotesFiles(files);
    return { ok: true, file: existing || files[0] };
  }

  function deleteNotesFile(name) {
    var clean = (name || "").trim();
    if (!clean) return;
    var files = loadNotesFiles().filter(function(f) { return f.name.toLowerCase() !== clean.toLowerCase(); });
    saveNotesFiles(files);
  }

  function downloadTextFile(name, content) {
    var blob = new Blob([content], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name.endsWith(".txt") ? name : name + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function createUtilityWindow(id, title, html, onMount) {
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var isMobile = window.innerWidth <= 768;

    var win = document.createElement("div");
    win.id = id;
    win.className = "app-window-shell utility-window" + (isMobile ? " mobile-fullscreen" : "");
    win.style.zIndex = ++systemWindowZ;
    win.style.transform = "none";

    var header = document.createElement("div");
    header.className = "app-window-header";
    var titleEl = document.createElement("div");
    titleEl.className = "app-window-title";
    titleEl.textContent = title;
    var close = document.createElement("button");
    close.className = "app-window-close";
    close.type = "button";
    close.textContent = "X";
    header.appendChild(titleEl);
    header.appendChild(close);

    var body = document.createElement("div");
    body.className = "app-window-body";
    body.innerHTML = html;

    var resize = document.createElement("div");
    resize.className = "app-window-resize-handle";

    win.appendChild(header);
    win.appendChild(body);
    win.appendChild(resize);
    document.body.appendChild(win);

    if (isMobile) {
      close.addEventListener("click", function() { 
        win.classList.add("closing");
        win.addEventListener("animationend", function() { win.remove(); }, { once: true });
      });
      win.addEventListener("mousedown", function() { win.style.zIndex = ++systemWindowZ; });
    } else {
      var w = Math.min(500, window.innerWidth - 20);
      var h = Math.min(400, window.innerHeight - 100);
      win.style.width = w + "px";
      win.style.height = h + "px";
      win.style.left = Math.max(0, (window.innerWidth - w) / 2) + "px";
      win.style.top = Math.max(60, (window.innerHeight - h) / 2) + "px";

      bindWindowInteractions({
        windowEl: win,
        headerEl: header,
        closeBtn: close,
        resizeHandleEl: resize,
        minWidth: 300,
        minHeight: 200,
        onClose: function() { 
          win.classList.add("closing");
          win.addEventListener("animationend", function() { win.remove(); }, { once: true });
        },
        onActivate: function() { win.style.zIndex = ++systemWindowZ; },
        activateOnMouseDown: true
      });
    }

    if (onMount) onMount(body);
  }

  function openNotesWindow() {
    var html = 
      '<div class="notes-shell">' +
        '<div class="notes-toolbar">' +
          '<input class="notes-filename" type="text" placeholder="Filename" value="Untitled">' +
          '<div class="notes-actions">' +
            '<button class="notes-action-btn" data-action="new">New</button>' +
            '<button class="notes-action-btn" data-action="save">Save</button>' +
            '<button class="notes-action-btn" data-action="dl">Download</button>' +
          '</div>' +
        '</div>' +
        '<textarea class="notes-editor" placeholder="Type notes..."></textarea>' +
        '<div class="notes-status">Ready</div>' +
      '</div>';

    createUtilityWindow("notesWin", "Quick Notes", html, function(body) {
      var nameInput = body.querySelector(".notes-filename");
      var editor = body.querySelector(".notes-editor");
      var status = body.querySelector(".notes-status");
      
      if (pendingNotesPayload) {
        nameInput.value = pendingNotesPayload.name;
        editor.value = pendingNotesPayload.content;
        pendingNotesPayload = null;
      }

      body.addEventListener("click", function(e) {
        if (!e.target.dataset.action) return;
        var action = e.target.dataset.action;
        if (action === "new") {
          nameInput.value = "Untitled";
          editor.value = "";
          status.textContent = "New note created";
        } else if (action === "save") {
          var res = upsertNotesFile(nameInput.value, editor.value);
          if (res.ok) {
            status.textContent = "Saved as " + res.file.name;
            notifySnackbar("Saved " + res.file.name);
            var filesWin = document.getElementById("filesWin");
            if (filesWin) openFilesWindow();
          } else {
            notifySnackbar(res.message);
          }
        } else if (action === "dl") {
          downloadTextFile(nameInput.value, editor.value);
        }
      });
    });
  }

  function openFilesWindow() {
    var html = 
      '<div class="files-shell">' +
        '<div class="files-toolbar">' +
          '<button class="files-action-btn" id="refreshFiles">Refresh</button>' +
        '</div>' +
        '<div class="files-list"></div>' +
        '<div class="files-empty" style="display:none">No files found</div>' +
      '</div>';

    createUtilityWindow("filesWin", "Files", html, function(body) {
      var list = body.querySelector(".files-list");
      var empty = body.querySelector(".files-empty");
      
      function render() {
        list.innerHTML = "";
        var files = loadNotesFiles();
        if (files.length === 0) {
          empty.style.display = "block";
          return;
        }
        empty.style.display = "none";
        files.forEach(function(f) {
          var item = document.createElement("div");
          item.className = "files-item";
          item.innerHTML = 
            '<div class="files-meta">' +
              '<div class="files-name">' + f.name + '</div>' +
              '<div class="files-time">' + new Date(f.updatedAt).toLocaleString() + '</div>' +
            '</div>' +
            '<div class="files-actions">' +
              '<button class="files-action-btn" data-open="' + f.name + '">Open</button>' +
              '<button class="files-action-btn" data-del="' + f.name + '">Delete</button>' +
            '</div>';
          list.appendChild(item);
        });
      }

      body.querySelector("#refreshFiles").onclick = render;
      
      list.addEventListener("click", function(e) {
        if (e.target.dataset.open) {
          var f = loadNotesFiles().find(function(x) { return x.name === e.target.dataset.open; });
          if (f) {
            pendingNotesPayload = { name: f.name, content: f.content };
            openNotesWindow();
          }
        } else if (e.target.dataset.del) {
          if (confirm("Delete " + e.target.dataset.del + "?")) {
            deleteNotesFile(e.target.dataset.del);
            render();
          }
        }
      });

      render();
    });
  }

  function setupDesktopShell() {
    if (!desktopShell) {
      return;
    }
    var clocks = document.querySelectorAll("[data-desktop-clock]");
    var dates = document.querySelectorAll("[data-desktop-date]");
    var taskbarClock = document.getElementById("desktopTaskbarClock");
    var calendars = document.querySelectorAll("[data-desktop-calendar]");
    var desktopWidgets = document.getElementById("desktopWidgets");
    var exitBtn = document.getElementById("desktopExitBtn");
    var compactToggle = document.getElementById("desktopCompactToggle");
    var widgetToggle = document.getElementById("desktopWidgetToggle");
    var motionToggle = document.getElementById("desktopMotionToggle");
    var settingsOpenFiles = document.getElementById("settingsOpenFiles");
    var settingsOpenNotes = document.getElementById("settingsOpenNotes");
    var settingsOpenTerminal = document.getElementById("settingsOpenTerminal");
    var settingsExitDesktop = document.getElementById("settingsExitDesktop");
    var systemOverlay = document.getElementById("systemAppOverlay");
    var systemClose = document.getElementById("systemAppClose");

    function shouldUseSystemOverlay() {
      var forcedMode = getForcedUiMode();
      if (forcedMode === "mobile") {
        return true;
      }
      if (forcedMode === "pc") {
        return false;
      }
      if (window.matchMedia) {
        return window.matchMedia("(max-width: 540px)").matches;
      }
      return window.innerWidth <= 540;
    }

    function runDesktopApp(appName) {
      if (appName === "download") {
        exitDesktop();
        return;
      }
      if (appName === "settings") {
        var openBtn = document.getElementById("appsSettingsBtn");
        if (openBtn) {
          openBtn.click();
        }
        return;
      }
      if (appName === "files") {
        openFilesWindow();
        return;
      }
      if (appName === "notes") {
        openNotesWindow();
        return;
      }
      if (appName === "terminal") {
        if (typeof window.openArchTerminalLauncher === "function") {
          window.openArchTerminalLauncher();
        } else {
          exitDesktop();
          showTab("terminal");
        }
        return;
      }
      if (appName === "system") {
        if (shouldUseSystemOverlay() && systemOverlay) {
          systemOverlay.classList.add("is-open");
          systemOverlay.setAttribute("aria-hidden", "false");
          return;
        }
        if (desktopWidgets) {
          desktopWidgets.classList.remove("is-focused");
          void desktopWidgets.offsetWidth;
          desktopWidgets.classList.add("is-focused");
          if (typeof desktopWidgets.scrollIntoView === "function") {
            desktopWidgets.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
          }
        }
      }
    }

    function renderCalendar(calendarEl, now) {
      if (!calendarEl) {
        return;
      }
      var today = now || new Date();
      var year = today.getFullYear();
      var month = today.getMonth();
      var firstDay = new Date(year, month, 1);
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var html = '<div class="desktop-calendar-month">' + today.toLocaleDateString([], { month: "long", year: "numeric" }) + '</div>';
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (day) {
        html += '<div class="desktop-calendar-day is-label">' + day + '</div>';
      });
      for (var i = 0; i < firstDay.getDay(); i += 1) {
        html += '<div class="desktop-calendar-day is-empty"></div>';
      }
      for (var dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
        html += '<div class="desktop-calendar-day' + (dayNum === today.getDate() ? ' is-today' : '') + '">' + dayNum + '</div>';
      }
      calendarEl.innerHTML = html;
    }

    function updateDesktopDateTime() {
      var now = new Date();
      var timeText = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      clocks.forEach(function (clock) {
        clock.textContent = timeText;
      });
      if (taskbarClock) taskbarClock.textContent = timeText;
      dates.forEach(function (date) {
        date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      });
      calendars.forEach(function (calendarEl) {
        renderCalendar(calendarEl, now);
      });
    }

    desktopShell.addEventListener("click", function (event) {
      var trigger = event.target && event.target.closest ? event.target.closest("[data-app]") : null;
      if (trigger) {
        runDesktopApp(trigger.dataset.app);
      }
    });

    if (exitBtn) exitBtn.addEventListener("click", exitDesktop);
    if (taskbarClock) taskbarClock.addEventListener("click", function () { runDesktopApp("system"); });
    if (systemClose) {
      systemClose.addEventListener("click", function () {
        if (!systemOverlay) return;
        systemOverlay.classList.remove("is-open");
        systemOverlay.setAttribute("aria-hidden", "true");
      });
    }
    if (systemOverlay) {
      systemOverlay.addEventListener("click", function (event) {
        if (event.target === systemOverlay && systemClose) {
          systemClose.click();
        }
      });
    }
    if (settingsOpenFiles) settingsOpenFiles.addEventListener("click", function () { runDesktopApp("files"); });
    if (settingsOpenNotes) settingsOpenNotes.addEventListener("click", function () { runDesktopApp("notes"); });
    if (settingsOpenTerminal) settingsOpenTerminal.addEventListener("click", function () { runDesktopApp("terminal"); });
    if (settingsExitDesktop) settingsExitDesktop.addEventListener("click", exitDesktop);
    if (compactToggle) {
      compactToggle.addEventListener("change", function () {
        desktopShell.classList.toggle("desktop-compact", compactToggle.checked);
      });
    }
    if (widgetToggle) {
      widgetToggle.addEventListener("change", function () {
        desktopShell.classList.toggle("desktop-hide-widgets", !widgetToggle.checked);
      });
    }
    if (motionToggle) {
      motionToggle.addEventListener("change", function () {
        desktopShell.classList.toggle("desktop-reduced-motion", !motionToggle.checked);
      });
    }
    updateDesktopDateTime();
    window.setInterval(updateDesktopDateTime, 30000);
  }

  function clampValue(value, min, max) {
    return Math.min(Math.max(min, value), max);
  }

  function bindWindowInteractions(config) {
    var windowEl = config.windowEl;
    if (!windowEl) {
      return;
    }
    var headerEl = config.headerEl;
    var closeBtn = config.closeBtn;
    var resizeHandleEl = config.resizeHandleEl;
    var minWidth = typeof config.minWidth === "number" ? config.minWidth : 320;
    var minHeight = typeof config.minHeight === "number" ? config.minHeight : 240;
    var onClose = typeof config.onClose === "function" ? config.onClose : function () {};
    var onActivate = typeof config.onActivate === "function" ? config.onActivate : function () {};
    var boundsProvider = typeof config.boundsProvider === "function" ? config.boundsProvider : function (rect) {
      return {
        minLeft: 8,
        minTop: 8,
        maxLeft: Math.max(8, window.innerWidth - rect.width - 8),
        maxTop: Math.max(8, window.innerHeight - rect.height - 8)
      };
    };
    var sizeBoundsProvider = typeof config.sizeBoundsProvider === "function" ? config.sizeBoundsProvider : function (state) {
      return {
        maxW: Math.max(minWidth, window.innerWidth - state.left - 8),
        maxH: Math.max(minHeight, window.innerHeight - state.top - 8)
      };
    };

    var dragState = null;
    var resizeState = null;

    function stopDrag() {
      dragState = null;
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
    }

    function onDrag(event) {
      if (!dragState) return;
      if (event.buttons !== 1) {
        stopDrag();
        return;
      }
      var rect = windowEl.getBoundingClientRect();
      var bounds = boundsProvider(rect);
      var left = event.clientX - dragState.offsetX;
      var top = event.clientY - dragState.offsetY;
      windowEl.style.left = clampValue(left, bounds.minLeft, bounds.maxLeft) + "px";
      windowEl.style.top = clampValue(top, bounds.minTop, bounds.maxTop) + "px";
    }

    function startDrag(event) {
      if (!headerEl || event.button !== 0) return;
      if (event.target === closeBtn) return;
      var rect = windowEl.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      onActivate();
      windowEl.style.transform = "none";
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", stopDrag);
      event.preventDefault();
    }

    function stopResize() {
      resizeState = null;
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", stopResize);
    }

    function onResize(event) {
      if (!resizeState) return;
      if (event.buttons !== 1) {
        stopResize();
        return;
      }
      var dx = event.clientX - resizeState.startX;
      var dy = event.clientY - resizeState.startY;
      var bounds = sizeBoundsProvider(resizeState);
      var nextW = Math.min(bounds.maxW, Math.max(minWidth, resizeState.startW + dx));
      var nextH = Math.min(bounds.maxH, Math.max(minHeight, resizeState.startH + dy));
      windowEl.style.width = nextW + "px";
      windowEl.style.height = nextH + "px";
    }

    function startResize(event) {
      if (!resizeHandleEl || event.button !== 0) return;
      var rect = windowEl.getBoundingClientRect();
      resizeState = {
        startX: event.clientX,
        startY: event.clientY,
        startW: rect.width,
        startH: rect.height,
        left: rect.left,
        top: rect.top
      };
      onActivate();
      document.addEventListener("mousemove", onResize);
      document.addEventListener("mouseup", stopResize);
      event.preventDefault();
    }

    if (headerEl) {
      headerEl.addEventListener("mousedown", startDrag);
    }
    if (resizeHandleEl) {
      resizeHandleEl.addEventListener("mousedown", startResize);
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        onClose();
      });
    }
    if (config.activateOnMouseDown) {
      windowEl.addEventListener("mousedown", function (event) {
        if (event.button === 0) {
          onActivate();
        }
      });
    }
  }

  function getRevealTargets(scope) {
    if (!scope) {
      return [];
    }
    return Array.prototype.slice.call(scope.querySelectorAll(revealSelector));
  }

  function getViewportMetrics() {
    var docEl = document.documentElement;
    return {
      width: window.innerWidth || (docEl ? docEl.clientWidth : 0) || 0,
      height: window.innerHeight || (docEl ? docEl.clientHeight : 0) || 0
    };
  }

  function getRevealObserverConfig() {
    var viewport = getViewportMetrics();
    if (viewport.width <= 540 || viewport.height <= 620) {
      return { key: "compact", threshold: 0.01, rootMargin: "0px 0px 160px 0px", delayStep: 0.02 };
    }
    if (viewport.width <= 960) {
      return { key: "mobile", threshold: 0.04, rootMargin: "0px 0px 120px 0px", delayStep: 0.03 };
    }
    return { key: "desktop", threshold: 0.08, rootMargin: "0px 0px 48px 0px", delayStep: 0.04 };
  }

  function applyStagger(targets) {
    var delayStep = getRevealObserverConfig().delayStep;
    var groups = new Map();
    targets.forEach(function (element) {
      var group = typeof element.closest === "function" ? element.closest(".tab-content") : null;
      group = group || document.body;
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group).push(element);
    });

    groups.forEach(function (items) {
      items.forEach(function (element, index) {
        var delay = index * delayStep;
        element.style.animationDelay = delay.toFixed(2) + "s";
      });
    });
  }

  function prepareRevealTargets(scope) {
    var targets = getRevealTargets(scope);
    targets.forEach(function (element) {
      element.classList.add("reveal-on-scroll");
    });
    applyStagger(targets);
    if (scrollObserver) {
      targets.forEach(function (element) {
        scrollObserver.observe(element);
      });
    }
    return targets;
  }

  function setupScrollAnimations() {
    if (scrollObserver && typeof scrollObserver.disconnect === "function") {
      scrollObserver.disconnect();
    }
    scrollObserver = null;

    var targets = prepareRevealTargets(document);
    var observerConfig = getRevealObserverConfig();
    revealObserverProfile = observerConfig.key;
    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (element) {
        element.classList.add("is-visible");
      });
      return;
    }

    scrollObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          scrollObserver.unobserve(entry.target);
        }
      });
    }, { threshold: observerConfig.threshold, rootMargin: observerConfig.rootMargin });

    targets.forEach(function (element) {
      scrollObserver.observe(element);
    });
  }

  function resetRevealForTab(tabElement) {
    if (!tabElement) {
      return;
    }
    var targets = prepareRevealTargets(tabElement);
    if (!scrollObserver) {
      targets.forEach(function (element) {
        element.classList.add("is-visible");
      });
      return;
    }
    targets.forEach(function (element) {
      if (isElementInViewport(element, 140)) {
        element.classList.add("is-visible");
        scrollObserver.unobserve(element);
        return;
      }
      element.classList.remove("is-visible");
      scrollObserver.observe(element);
    });

    window.setTimeout(function () {
      targets.forEach(function (element) {
        if (!element.classList.contains("is-visible") && isElementInViewport(element, 220)) {
          element.classList.add("is-visible");
          scrollObserver.unobserve(element);
        }
      });
    }, 420);
  }

  function isElementInViewport(element, margin) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return false;
    }
    var rect = element.getBoundingClientRect();
    var viewport = getViewportMetrics();
    var extra = Number(margin) || 0;
    return rect.bottom >= -extra && rect.top <= viewport.height + extra;
  }

  function refreshRevealAnimationsForViewport() {
    if (!("IntersectionObserver" in window)) {
      return;
    }
    var config = getRevealObserverConfig();
    if (config.key === revealObserverProfile) {
      return;
    }
    setupScrollAnimations();
    if (activeTab) {
      resetRevealForTab(activeTab);
    }
  }

  function resetScrollPosition() {
    var scrollingElement = document.scrollingElement || document.documentElement || document.body;
    if (!scrollingElement) {
      return;
    }
    scrollingElement.scrollTop = 0;
    scrollingElement.scrollLeft = 0;
  }

  function showTab(tabId) {
    var targetTab = document.getElementById(tabId);
    if (!targetTab) {
      return;
    }

    if (activeTab && activeTab.id === tabId) {
      return;
    }

    var isUpdateTab = tabId === "update";
    document.body.classList.toggle("update-theme", isUpdateTab);
    if (themeShiftTimer) {
      window.clearTimeout(themeShiftTimer);
      themeShiftTimer = null;
    }
    document.body.classList.remove("theme-shift");

    tabSwitchToken += 1;
    var currentToken = tabSwitchToken;
    var transitionMs = getTabTransitionDuration();

    navLinks.forEach(function (link) {
      link.classList.toggle("active", link.dataset.tab === tabId);
    });

    if (tabId === "ver-sta" || tabId === "web-sta") {
      setWebsiteGroupOpen(true);
    }

    if (tabDropdown) {
      var hasOption = Array.prototype.some.call(tabDropdown.options || [], function (option) {
        return option.value === tabId;
      });
      if (hasOption) {
        tabDropdown.value = tabId;
      }
    }

    if (tabCleanupTimer) {
      window.clearTimeout(tabCleanupTimer);
      tabCleanupTimer = null;
    }

    var contentHost = typeof targetTab.closest === "function" ? targetTab.closest(".content") : null;
    var stableHeight = contentHost ? contentHost.getBoundingClientRect().height : 0;

    function clearTabTransitionState(tabContent) {
      if (!tabContent) {
        return;
      }
      tabContent.classList.remove("tab-enter");
      tabContent.classList.remove("tab-enter-active");
      tabContent.classList.remove("tab-leave");
      tabContent.classList.remove("tab-layer-active");
      tabContent.classList.remove("tab-layer-leave");
      tabContent.style.removeProperty("top");
      tabContent.style.removeProperty("left");
      tabContent.style.removeProperty("right");
      tabContent.style.removeProperty("width");
    }

    function hideTab(tabContent) {
      if (!tabContent) {
        return;
      }
      clearTabTransitionState(tabContent);
      tabContent.classList.add("hidden");
      tabContent.style.display = "none";
    }

    tabContents.forEach(function (tabContent) {
      if (tabContent !== targetTab) {
        hideTab(tabContent);
      }
    });

    function finalizeTabVisibility() {
      if (currentToken !== tabSwitchToken) {
        return;
      }
      tabContents.forEach(function (tabContent) {
        if (tabContent !== activeTab) {
          tabContent.classList.add("hidden");
          tabContent.style.display = "none";
        } else {
          tabContent.style.display = "";
        }
        clearTabTransitionState(tabContent);
      });
      if (contentHost) {
        contentHost.style.minHeight = "";
      }
      document.body.classList.remove("tab-switching");
    }

    resetScrollPosition();

    if (transitionMs === 0) {
      tabContents.forEach(function (tabContent) {
        if (tabContent === targetTab) {
          tabContent.classList.remove("hidden");
          tabContent.style.display = "";
        } else {
          tabContent.classList.add("hidden");
          tabContent.style.display = "none";
        }
        clearTabTransitionState(tabContent);
      });

      activeTab = targetTab;
      resetRevealForTab(targetTab);
      if (tabId === "article" && articleViewController && typeof articleViewController.showList === "function") {
        articleViewController.showList(true);
      }
      return;
    }

    targetTab.classList.remove("hidden");
    targetTab.style.display = "";
    clearTabTransitionState(targetTab);
    targetTab.classList.add("tab-layer-active");
    targetTab.classList.add("tab-enter");

    if (contentHost) {
      var targetHeight = targetTab.offsetHeight;
      contentHost.style.minHeight = Math.max(stableHeight, targetHeight, contentHost.offsetHeight) + "px";
    }

    document.body.classList.add("tab-switching");
    void targetTab.offsetWidth;

    window.requestAnimationFrame(function () {
      if (currentToken !== tabSwitchToken) {
        return;
      }
      targetTab.classList.add("tab-enter-active");
      targetTab.classList.remove("tab-enter");
    });

    window.setTimeout(function () {
      if (currentToken !== tabSwitchToken) {
        return;
      }
      targetTab.classList.remove("tab-enter-active");
    }, transitionMs);

    activeTab = targetTab;
    resetRevealForTab(targetTab);
    if (tabId === "article" && articleViewController && typeof articleViewController.showList === "function") {
      articleViewController.showList(true);
    }

    tabCleanupTimer = window.setTimeout(function () {
      finalizeTabVisibility();
    }, transitionMs);
  }

  function resolveTabId(tabId) {
    if (!tabId) {
      return null;
    }
    return document.getElementById(tabId) ? tabId : null;
  }

  function getInitialTabId() {
    var bodyDefault = document.body && document.body.dataset ? document.body.dataset.defaultTab : null;
    var activeLink = document.querySelector(".nav-link.active[data-tab]");
    var activeTab = activeLink ? activeLink.dataset.tab : null;
    var dropdownValue = tabDropdown ? tabDropdown.value : null;
    return (
      resolveTabId(bodyDefault) ||
      resolveTabId(activeTab) ||
      resolveTabId(dropdownValue) ||
      resolveTabId("home") ||
      (tabContents[0] ? tabContents[0].id : null)
    );
  }

  navLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      showTab(this.dataset.tab);
    });
  });

  if (tabDropdown) {
    tabDropdown.addEventListener("change", function () {
      showTab(tabDropdown.value);
    });
  }

  if (websiteToggle) {
    websiteToggle.addEventListener("click", function () {
      var isOpen = websiteGroup.classList.contains("open");
      setWebsiteGroupOpen(!isOpen);
    });
  }

  function setupResourceSearch() {
    var searchConfigs = [
      {
        searchBox: document.getElementById("searchBox"),
        scopeId: "resources",
        noun: "resources",
        ariaLabel: "Search resources"
      },
      {
        searchBox: document.getElementById("articleSearchBox"),
        scopeId: "articleListView",
        noun: "articles",
        ariaLabel: "Search articles"
      }
    ];

    function normalizeText(value) {
      var lowered = String(value || "").toLowerCase();
      if (typeof lowered.normalize === "function") {
        lowered = lowered.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      }
      return lowered.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    }

    function stripToAlnum(value) {
      return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function normalizeDigits(value) {
      var digits = String(value || "").replace(/[^0-9]/g, "");
      return digits.replace(/^0+(?=\d)/, "");
    }

    function normalizeCode(value) {
      var raw = stripToAlnum(value);
      if (!raw) {
        return "";
      }
      var match = raw.match(/^([a-z]+)?(\d+)?([a-z]+)?$/);
      if (!match) {
        return raw;
      }
      var prefix = match[1] || "";
      var digits = match[2] || "";
      var suffix = match[3] || "";
      if (digits) {
        digits = digits.replace(/^0+(?=\d)/, "");
      }
      return prefix + digits + suffix;
    }

    function extractLeadingCode(text) {
      var match = String(text || "").match(/^\s*([a-zA-Z]{0,3}\d{1,6}[a-zA-Z]{0,3})\b/);
      return match ? match[1] : "";
    }

    function isEditableTarget(target) {
      if (!target) return false;
      var tag = target.tagName ? target.tagName.toLowerCase() : "";
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    }

    function isScopeVisible(scope) {
      if (!scope) {
        return false;
      }
      return !scope.classList.contains("hidden") && scope.style.display !== "none";
    }

    searchConfigs.forEach(function (config) {
      var searchBox = config.searchBox;
      if (!searchBox) {
        return;
      }

      var scope = document.getElementById(config.scopeId);
      if (!scope && typeof searchBox.closest === "function") {
        scope = searchBox.closest(".tab-content");
      }
      scope = scope || document;
      var items = Array.prototype.slice.call(scope.querySelectorAll(".content-item"));
      if (!items.length) {
        return;
      }

      var existingStatus = searchBox.nextElementSibling && searchBox.nextElementSibling.classList.contains("search-status")
        ? searchBox.nextElementSibling
        : null;
      var statusLine = existingStatus || document.createElement("div");
      statusLine.className = "search-status";
      statusLine.setAttribute("role", "status");
      statusLine.setAttribute("aria-live", "polite");
      if (!existingStatus) {
        searchBox.insertAdjacentElement("afterend", statusLine);
      }

      var itemsData = items.map(function (item) {
        var link = item.querySelector("a");
        var text = (link ? link.textContent : item.textContent || "").trim();
        var codeRaw = extractLeadingCode(text);
        var defaultHidden = item.classList.contains("hidden-result") || item.style.display === "none" || item.hasAttribute("hidden");
        item.dataset.defaultHidden = defaultHidden ? "true" : "false";
        return {
          element: item,
          text: text,
          searchText: normalizeText(text),
          codeNormalized: normalizeCode(codeRaw),
          codeDigits: normalizeDigits(codeRaw)
        };
      });

      var defaultVisibleCount = itemsData.filter(function (entry) {
        return entry.element.dataset.defaultHidden !== "true";
      }).length;

      function setItemVisible(entry, visible) {
        entry.element.style.display = visible ? "" : "none";
      }

      function updateStatus(matchCount, query) {
        if (!statusLine) {
          return;
        }
        var trimmed = String(query || "").trim();
        var clipped = trimmed.length > 60 ? trimmed.slice(0, 60) + "..." : trimmed;
        if (!trimmed) {
          statusLine.textContent = "Showing " + defaultVisibleCount + " " + config.noun;
          statusLine.classList.remove("search-empty");
          searchBox.classList.remove("search-no-results");
          return;
        }
        if (matchCount === 0) {
          statusLine.textContent = "No matches for \"" + clipped + "\"";
          statusLine.classList.add("search-empty");
          searchBox.classList.add("search-no-results");
          return;
        }
        statusLine.textContent = "Found " + matchCount + " of " + itemsData.length + " " + config.noun;
        statusLine.classList.remove("search-empty");
        searchBox.classList.remove("search-no-results");
      }

      function matchesEntry(entry, queryText, queryTokens, queryCode, queryDigits) {
        if (!queryText) {
          return entry.element.dataset.defaultHidden !== "true";
        }

        if (queryCode) {
          if (entry.codeNormalized && entry.codeNormalized.indexOf(queryCode) === 0) {
            return true;
          }
          if (queryDigits && entry.codeDigits && entry.codeDigits.indexOf(queryDigits) === 0) {
            return true;
          }
        }

        for (var i = 0; i < queryTokens.length; i++) {
          if (entry.searchText.indexOf(queryTokens[i]) === -1) {
            return false;
          }
        }
        return true;
      }

      function applyFilter(rawQuery) {
        var queryText = normalizeText(rawQuery);
        var queryTokens = queryText ? queryText.split(" ") : [];
        var queryCode = normalizeCode(rawQuery);
        var queryDigits = normalizeDigits(rawQuery);
        var matchCount = 0;

        itemsData.forEach(function (entry) {
          var isMatch = matchesEntry(entry, queryText, queryTokens, queryCode, queryDigits);
          setItemVisible(entry, isMatch);
          if (isMatch) {
            matchCount += 1;
          }
        });

        updateStatus(matchCount, rawQuery);
      }

      searchBox.setAttribute("autocomplete", "off");
      searchBox.setAttribute("aria-label", config.ariaLabel);
      searchBox.placeholder = "Search by number or name";

      searchBox.addEventListener("input", function () {
        applyFilter(searchBox.value);
      });

      searchBox.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          searchBox.value = "";
          applyFilter("");
          searchBox.blur();
        }
      });

      document.addEventListener("keydown", function (event) {
        if (event.key === "/" && !isEditableTarget(document.activeElement) && isScopeVisible(scope)) {
          event.preventDefault();
          searchBox.focus();
        }
      });

      applyFilter(searchBox.value);
    });
  }

  function setupArticleView() {
    var articleSection = document.getElementById("article");
    if (!articleSection) {
      return null;
    }

    var listView = document.getElementById("articleListView");
    var detailView = document.getElementById("articleDetailView");
    var backBtn = document.getElementById("articleBackBtn");
    var openButtons = Array.prototype.slice.call(articleSection.querySelectorAll(".article-open-btn[data-article-target]"));
    var detailCards = Array.prototype.slice.call(articleSection.querySelectorAll(".article-detail-card"));
    if (!listView || !detailView || !openButtons.length) {
      return null;
    }

    var articleMotionTimer = null;

    function restoreArticleListItemsWhenUnfiltered() {
      var articleSearchInput = document.getElementById("articleSearchBox");
      if (!articleSearchInput) {
        return;
      }
      var rawQuery = String(articleSearchInput.value || "").trim();
      if (rawQuery) {
        return;
      }

      var listItems = Array.prototype.slice.call(listView.querySelectorAll(".content-item"));
      listItems.forEach(function (item) {
        var shouldStayHidden =
          item.dataset.defaultHidden === "true" ||
          item.classList.contains("hidden-result") ||
          item.hasAttribute("hidden");
        if (!shouldStayHidden) {
          item.style.display = "";
        }
      });
    }

    function hideAllDetailCards() {
      detailCards.forEach(function (card) {
        card.classList.add("hidden");
        card.style.display = "none";
      });
    }

    function forceRevealVisible(scope) {
      if (!scope) {
        return;
      }
      var targets = getRevealTargets(scope);
      targets.forEach(function (element) {
        element.classList.add("reveal-on-scroll");
        element.classList.add("is-visible");
        if (scrollObserver) {
          scrollObserver.unobserve(element);
        }
      });
    }

    function clearArticleMotion() {
      if (articleMotionTimer) {
        window.clearTimeout(articleMotionTimer);
        articleMotionTimer = null;
      }
      listView.classList.remove("view-enter", "view-leave", "view-layer-active", "view-layer-leave");
      detailView.classList.remove("view-enter", "view-leave", "view-layer-active", "view-layer-leave");
      if (!backBtn) {
        return;
      }
      backBtn.classList.remove("is-fading-in");
      backBtn.classList.remove("is-fading-out");
    }

    function runBackButtonFade(type) {
      if (!backBtn || articleViewTransitionMs === 0) {
        return;
      }
      backBtn.classList.remove("is-fading-in", "is-fading-out");
      if (type === "in") {
        backBtn.classList.add("is-fading-in");
      } else if (type === "out") {
        backBtn.classList.add("is-fading-out");
      } else {
        return;
      }
      window.setTimeout(function () {
        if (!backBtn) {
          return;
        }
        backBtn.classList.remove("is-fading-in");
        backBtn.classList.remove("is-fading-out");
      }, articleViewTransitionMs);
    }

    function scrollArticleTop() {
      var headerOffset = 92;
      var targetTop = articleSection.getBoundingClientRect().top + window.pageYOffset - headerOffset;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: prefersReducedMotion ? "auto" : "smooth" });
    }

    function showArticleCard(targetId) {
      detailCards.forEach(function (card) {
        var isTarget = card.id === targetId;
        card.classList.toggle("hidden", !isTarget);
        card.style.display = isTarget ? "" : "none";
      });
    }

    function showList(forceImmediate) {
      clearArticleMotion();
      hideAllDetailCards();
      detailView.classList.add("hidden");
      detailView.style.display = "none";
      listView.classList.remove("hidden");
      listView.style.display = "";
      restoreArticleListItemsWhenUnfiltered();
      forceRevealVisible(listView);
      runBackButtonFade("out");
      if (!forceImmediate && articleViewTransitionMs > 0) {
        listView.classList.add("view-enter");
        window.requestAnimationFrame(function () {
          listView.classList.remove("view-enter");
        });
      }
      scrollArticleTop();
    }

    function openArticle(targetId) {
      if (!targetId || !document.getElementById(targetId)) {
        return;
      }
      clearArticleMotion();
      showArticleCard(targetId);
      listView.classList.add("hidden");
      listView.style.display = "none";
      detailView.classList.remove("hidden");
      detailView.style.display = "";
      forceRevealVisible(detailView);
      runBackButtonFade("in");
      if (articleViewTransitionMs > 0) {
        detailView.classList.add("view-enter");
        window.requestAnimationFrame(function () {
          detailView.classList.remove("view-enter");
        });
      }
      scrollArticleTop();
    }

    openButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        openArticle(btn.dataset.articleTarget);
      });
    });

    if (backBtn) {
      backBtn.addEventListener("click", function () {
        showList(false);
      });
    }

    showList(true);
    return {
      showList: function (forceImmediate) {
        showList(Boolean(forceImmediate));
      }
    };
  }

  function setupMathCalculator() {
    var mathHome = document.getElementById("mathHome");
    if (!mathHome) {
      return;
    }

    var pages = {
      linear1: document.getElementById("linearOneVarPage"),
      quad1: document.getElementById("quadraticOneVarPage"),
      linear2: document.getElementById("linearTwoVarPage"),
      expr: document.getElementById("quadraticExprPage")
    };

    var btns = {
      linear1: document.getElementById("linearOneVarBtn"),
      quad1: document.getElementById("quadraticOneVarBtn"),
      linear2: document.getElementById("linearTwoVarBtn"),
      expr: document.getElementById("quadraticExprBtn")
    };

    var backBtns = {
      linear1: document.getElementById("linearOneVarBackBtn"),
      quad1: document.getElementById("quadraticOneVarBackBtn"),
      linear2: document.getElementById("linearTwoVarBackBtn"),
      expr: document.getElementById("quadraticExprBackBtn")
    };

    var hideAll = function () {
      if (mathHome) {
        mathHome.classList.add("hidden");
      }
      Object.keys(pages).forEach(function (key) {
        var page = pages[key];
        if (page) {
          page.classList.add("hidden");
        }
      });
    };

    Object.keys(btns).forEach(function (key) {
      var btn = btns[key];
      if (btn) {
        btn.addEventListener("click", function () {
          hideAll();
          if (pages[key]) {
            pages[key].classList.remove("hidden");
          }
        });
      }
    });

    Object.keys(backBtns).forEach(function (key) {
      var btn = backBtns[key];
      if (btn) {
        btn.addEventListener("click", function () {
          hideAll();
          if (mathHome) {
            mathHome.classList.remove("hidden");
          }
        });
      }
    });

    var safeVal = function (id) {
      var el = document.getElementById(id);
      return el ? parseFloat(el.value) : NaN;
    };

    var setHTML = function (id, html) {
      var el = document.getElementById(id);
      if (el) {
        el.innerHTML = html;
      }
    };

    var clearInputs = function (ids) {
      ids.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          el.value = "";
        }
      });
    };

    var refreshMathJax = function () {
      if (window.MathJax && typeof window.MathJax.typeset === "function") {
        window.MathJax.typeset();
      }
    };

    var notify = function (message) {
      if (typeof window.showSnackbar === "function") {
        window.showSnackbar(message);
        return;
      }
      console.warn(message);
    };

    var fmtNum = function (num, precision) {
      var prec = typeof precision === "number" ? precision : 6;
      if (!Number.isFinite(num)) {
        return String(num);
      }
      var safeNum = Math.abs(num) < 1e-12 ? 0 : num;
      var nearestInt = Math.round(safeNum);
      if (Math.abs(safeNum - nearestInt) < 1e-10) {
        return String(nearestInt);
      }
      return parseFloat(safeNum.toFixed(prec)).toString();
    };

    var isNearZero = function (num) {
      return Math.abs(num) < 1e-10;
    };

    var factorPrefix = function (coef) {
      if (Math.abs(coef - 1) < 1e-10) return "";
      if (Math.abs(coef + 1) < 1e-10) return "-";
      return fmtNum(coef);
    };

    var factorTermFromRoot = function (root) {
      if (isNearZero(root)) return "(x)";
      var absRoot = fmtNum(Math.abs(root));
      return root < 0 ? "(x + " + absRoot + ")" : "(x - " + absRoot + ")";
    };

    var isNearInteger = function (num) {
      return Math.abs(num - Math.round(num)) < 1e-10;
    };

    var signedFactors = function (num) {
      var abs = Math.abs(num);
      var factors = new Set();
      for (var i = 1; i <= Math.sqrt(abs); i += 1) {
        if (abs % i !== 0) continue;
        var j = abs / i;
        factors.add(i);
        factors.add(-i);
        factors.add(j);
        factors.add(-j);
      }
      return Array.from(factors).sort(function (x, y) {
        var ax = Math.abs(x);
        var ay = Math.abs(y);
        if (ax === ay) return x - y;
        return ax - ay;
      });
    };

    var formatLinearFactor = function (A, B) {
      var aPart = A === 1 ? "x" : (A === -1 ? "-x" : A + "x");
      if (B === 0) return "(" + aPart + ")";
      return B > 0 ? "(" + aPart + " + " + Math.abs(B) + ")" : "(" + aPart + " - " + Math.abs(B) + ")";
    };

    var factoriseIntegerQuadratic = function (a, b, c) {
      if (!isNearInteger(a) || !isNearInteger(b) || !isNearInteger(c)) return null;
      var ai = Math.round(a);
      var bi = Math.round(b);
      var ci = Math.round(c);
      if (ai === 0) return null;

      if (ci === 0) {
        var A = ai;
        var B = bi;
        var sign = "";
        if (A < 0) {
          A = -A;
          B = -B;
          sign = "-";
        }
        return sign + "(x)" + formatLinearFactor(A, B);
      }

      var aFactors = signedFactors(ai);
      var cFactors = signedFactors(ci);

      for (var aiIndex = 0; aiIndex < aFactors.length; aiIndex += 1) {
        var a1 = aFactors[aiIndex];
        if (ai % a1 !== 0) continue;
        var a2 = ai / a1;

        for (var ciIndex = 0; ciIndex < cFactors.length; ciIndex += 1) {
          var b1 = cFactors[ciIndex];
          if (ci % b1 !== 0) continue;
          var b2 = ci / b1;
          if (a1 * b2 + a2 * b1 !== bi) continue;

          var f1 = { A: a1, B: b1 };
          var f2 = { A: a2, B: b2 };
          var signPrefix = "";

          if (f1.A < 0) {
            f1.A *= -1;
            f1.B *= -1;
            signPrefix = signPrefix === "-" ? "" : "-";
          }
          if (f2.A < 0) {
            f2.A *= -1;
            f2.B *= -1;
            signPrefix = signPrefix === "-" ? "" : "-";
          }

          if (Math.abs(f1.A) < Math.abs(f2.A)) {
            var temp = f1;
            f1 = f2;
            f2 = temp;
          }

          return signPrefix + formatLinearFactor(f1.A, f1.B) + formatLinearFactor(f2.A, f2.B);
        }
      }

      return null;
    };

    var l1Calc = document.getElementById("linearOneVarCalcBtn");
    var l1Clear = document.getElementById("linearOneVarClearBtn");
    if (l1Calc) {
      l1Calc.addEventListener("click", function () {
        var a = safeVal("linearA");
        var b = safeVal("linearB");
        var c = safeVal("linearC");
        if (isNaN(a) || isNaN(b) || isNaN(c)) {
          notify("Invalid numbers");
          return;
        }

        if (a === 0) {
          if (b === c) {
            setHTML("linearOneVarResult", "Infinite solutions");
            setHTML("linearOneVarSteps", "a = 0, b = c.");
          } else {
            setHTML("linearOneVarResult", "No solution");
            setHTML("linearOneVarSteps", "a = 0, b != c.");
          }
        } else {
          var x = (c - b) / a;
          setHTML("linearOneVarResult", "x = " + fmtNum(x));
          setHTML(
            "linearOneVarSteps",
            "<div class=\"step-number\">1</div> Given: \\(" + a + "x + " + b + " = " + c + "\\)<br>" +
            "<div class=\"step-number\">2</div> \\(" + a + "x = " + (c - b) + "\\)<br>" +
            "<div class=\"step-number\">3</div> \\(x = \\frac{" + (c - b) + "}{" + a + "} = " + fmtNum(x) + "\\)"
          );
        }
        refreshMathJax();
      });
    }
    if (l1Clear) {
      l1Clear.addEventListener("click", function () {
        clearInputs(["linearA", "linearB", "linearC"]);
        setHTML("linearOneVarResult", "");
        setHTML("linearOneVarSteps", "");
      });
    }

    var qFactor = document.getElementById("quadraticOneVarFactorBtn");
    var qClear = document.getElementById("quadraticOneVarClearBtn");

    function gcdInt(a, b) {
      var x = Math.abs(a);
      var y = Math.abs(b);
      while (y) {
        var t = y;
        y = x % y;
        x = t;
      }
      return x || 1;
    }

    function formatSignedTerm(value, suffix, isFirst) {
      if (value === 0) return "";
      var abs = Math.abs(value);
      var coeff = abs === 1 && suffix ? "" : String(abs);
      var term = coeff + suffix;
      if (isFirst) {
        return (value < 0 ? "-" : "") + term;
      }
      return value < 0 ? " - " + term : " + " + term;
    }

    function buildExpression(terms) {
      var parts = "";
      terms.forEach(function (term) {
        if (term.coeff === 0) return;
        parts += formatSignedTerm(term.coeff, term.suffix, parts === "");
      });
      return parts || "0";
    }

    function formatPolynomial(a, b, c) {
      return buildExpression([
        { coeff: a, suffix: "x<sup>2</sup>" },
        { coeff: b, suffix: "x" },
        { coeff: c, suffix: "" }
      ]);
    }

    function formatSplitPolynomial(a, m, n, c) {
      return buildExpression([
        { coeff: a, suffix: "x<sup>2</sup>" },
        { coeff: m, suffix: "x" },
        { coeff: n, suffix: "x" },
        { coeff: c, suffix: "" }
      ]);
    }

    function formatLinearFactor(a, b) {
      var xPart = a === 1 ? "x" : (a === -1 ? "-x" : a + "x");
      if (b === 0) return "(" + xPart + ")";
      return "(" + xPart + (b < 0 ? " - " : " + ") + Math.abs(b) + ")";
    }

    function formatGroupMultiplier(coeff, binomial) {
      var abs = Math.abs(coeff);
      var sign = coeff < 0 ? " - " : " + ";
      if (abs === 1) {
        return sign + binomial;
      }
      return sign + abs + " * " + binomial;
    }

    function stepBlock(title, body, note) {
      return (
        "<div class=\"step-block\">" +
        "<div class=\"step-title\">" + title + "</div>" +
        "<div class=\"step-math\">" + body + "</div>" +
        (note ? "<div class=\"step-note\">" + note + "</div>" : "") +
        "</div>"
      );
    }

    function findFactorPair(product, sum) {
      var abs = Math.abs(product);
      if (abs === 0) {
        return [0, sum];
      }
      for (var i = 1; i <= Math.sqrt(abs); i += 1) {
        if (abs % i !== 0) continue;
        var j = abs / i;
        var pairs = [
          [i, j],
          [-i, -j],
          [j, i],
          [-j, -i]
        ];
        for (var p = 0; p < pairs.length; p += 1) {
          if (pairs[p][0] + pairs[p][1] === sum) {
            return pairs[p];
          }
        }
      }
      return null;
    }

    function factoriseQuadraticExpression(a, b, c) {
      var steps = [];
      steps.push(stepBlock("Step 1: Identify a, b, c", "a = " + a + ", b = " + b + ", c = " + c));

      var ac = a * c;
      steps.push(stepBlock("Step 2: Multiply a * c", a + " * " + c + " = " + ac));

      var pair = findFactorPair(ac, b);
      if (!pair) {
        return {
          steps: steps,
          factor: null,
          message: "No integer factors found that multiply to " + ac + " and add to " + b + "."
        };
      }

      var m = pair[0];
      var n = pair[1];
      steps.push(stepBlock("Step 3: Find two numbers that multiply to " + ac + " and add to " + b, "The numbers are " + m + " and " + n + "."));

      steps.push(stepBlock("Step 4: Rewrite the middle term", formatSplitPolynomial(a, m, n, c)));

      var firstGroup = buildExpression([
        { coeff: a, suffix: "x<sup>2</sup>" },
        { coeff: m, suffix: "x" }
      ]);
      var secondGroup = buildExpression([
        { coeff: n, suffix: "x" },
        { coeff: c, suffix: "" }
      ]);
      steps.push(stepBlock("Step 5: Group terms", "(" + firstGroup + ") + (" + secondGroup + ")"));

      var g1 = gcdInt(a, m);
      var g2 = gcdInt(n, c);
      if (g1 < 0) g1 *= -1;
      if (g2 < 0) g2 *= -1;

      var commonA = a / g1;
      var commonB = m / g1;
      var commonC = n / g2;
      var commonD = c / g2;
      if (commonA !== commonC || commonB !== commonD) {
        g2 = -g2;
        commonC = n / g2;
        commonD = c / g2;
      }
      if (commonA !== commonC || commonB !== commonD) {
        return {
          steps: steps,
          factor: null,
          message: "Grouping did not yield a common binomial. Try different coefficients."
        };
      }

      var commonBinomial = formatLinearFactor(commonA, commonB);
      var firstFactor = (g1 === 1 ? "x" : g1 + "x") + " * " + commonBinomial;
      var secondFactor = formatGroupMultiplier(g2, commonBinomial);
      steps.push(stepBlock("Step 6: Factor each group", firstFactor + secondFactor));

      var factor1 = formatLinearFactor(g1, g2);
      var factor2 = commonBinomial;
      steps.push(stepBlock("Step 7: Factor out common binomial", factor1 + factor2));

      return {
        steps: steps,
        factor: factor1 + factor2,
        message: null
      };
    }

    if (qFactor) {
      qFactor.addEventListener("click", function () {
        var a = safeVal("quadA");
        var b = safeVal("quadB");
        var c = safeVal("quadC");
        if (isNaN(a) || isNaN(b) || isNaN(c)) {
          notify("Invalid numbers");
          return;
        }
        if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
          setHTML("quadraticOneVarResult", "Please use integer coefficients for this method.");
          setHTML("quadraticOneVarSteps", "");
          return;
        }
        if (a === 0) {
          setHTML("quadraticOneVarResult", "This is not a quadratic (a = 0).");
          setHTML("quadraticOneVarSteps", "");
          return;
        }

        var result = factoriseQuadraticExpression(a, b, c);
        if (result.factor) {
          setHTML("quadraticOneVarResult", "Final Answer: " + result.factor);
        } else {
          setHTML("quadraticOneVarResult", result.message || "Unable to factorise.");
        }
        setHTML("quadraticOneVarSteps", result.steps.join(""));
        refreshMathJax();
      });
    }
    if (qClear) {
      qClear.addEventListener("click", function () {
        clearInputs(["quadA", "quadB", "quadC"]);
        setHTML("quadraticOneVarResult", "");
        setHTML("quadraticOneVarSteps", "");
      });
    }

    var l2Calc = document.getElementById("linearTwoVarCalcBtn");
    var l2Clear = document.getElementById("linearTwoVarClearBtn");
    if (l2Calc) {
      l2Calc.addEventListener("click", function () {
        var a1 = safeVal("eq1A");
        var b1 = safeVal("eq1B");
        var c1 = safeVal("eq1C");
        var a2 = safeVal("eq2A");
        var b2 = safeVal("eq2B");
        var c2 = safeVal("eq2C");
        if ([a1, b1, c1, a2, b2, c2].some(isNaN)) {
          notify("Invalid numbers");
          return;
        }

        var det = a1 * b2 - a2 * b1;
        if (det === 0) {
          setHTML("linearTwoVarResult", "No unique solution (parallel or coincident).");
          setHTML("linearTwoVarSteps", "Determinant is 0.");
        } else {
          var dx = c1 * b2 - c2 * b1;
          var dy = a1 * c2 - a2 * c1;
          var x = dx / det;
          var y = dy / det;
          setHTML("linearTwoVarResult", "x = " + fmtNum(x) + ", y = " + fmtNum(y));
          setHTML("linearTwoVarSteps", "Cramer's Rule: D=" + fmtNum(det) + ", Dx=" + fmtNum(dx) + ", Dy=" + fmtNum(dy));
        }
        refreshMathJax();
      });
    }
    if (l2Clear) {
      l2Clear.addEventListener("click", function () {
        clearInputs(["eq1A", "eq1B", "eq1C", "eq2A", "eq2B", "eq2C"]);
        setHTML("linearTwoVarResult", "");
        setHTML("linearTwoVarSteps", "");
      });
    }

    var exprInput = document.getElementById("quadraticExprInput");
    var exprSimplify = document.getElementById("quadraticExprSimplifyBtn");
    var exprSpecial = document.getElementById("quadraticExprSpecialBtn");
    var exprExpand = document.getElementById("quadraticExprExpandBtn");
    var exprClear = document.getElementById("quadraticExprClearBtn");
    var exprResult = document.getElementById("quadraticExprResult");
    var exprAction = document.getElementById("quadraticExprAction");
    var exprFractionToggle = document.getElementById("quadraticExprFractionMode");

    function gcd(a, b) {
      var x = Math.abs(a);
      var y = Math.abs(b);
      while (y) {
        var t = y;
        y = x % y;
        x = t;
      }
      return x || 1;
    }

    function makeFraction(n, d) {
      if (d === 0) {
        throw new Error("Division by zero");
      }
      var sign = d < 0 ? -1 : 1;
      var num = Math.round(n * sign);
      var den = Math.round(Math.abs(d));
      var g = gcd(num, den);
      return { n: num / g, d: den / g };
    }

    function fracAdd(a, b) {
      return makeFraction(a.n * b.d + b.n * a.d, a.d * b.d);
    }

    function fracSub(a, b) {
      return makeFraction(a.n * b.d - b.n * a.d, a.d * b.d);
    }

    function fracMul(a, b) {
      return makeFraction(a.n * b.n, a.d * b.d);
    }

    function fracDiv(a, b) {
      return makeFraction(a.n * b.d, a.d * b.n);
    }

    function fracNeg(a) {
      return { n: -a.n, d: a.d };
    }

    function fracIsZero(a) {
      return a.n === 0;
    }

    function fracToString(a, useFraction) {
      if (a.d === 1) {
        return String(a.n);
      }
      if (useFraction) {
        return a.n + "/" + a.d;
      }
      return fmtNum(a.n / a.d);
    }

    function parseNumberToken(value) {
      if (value.indexOf(".") === -1) {
        return makeFraction(parseInt(value, 10), 1);
      }
      var parts = value.split(".");
      var whole = parts[0] || "0";
      var frac = parts[1] || "";
      var scale = Math.pow(10, frac.length);
      var num = parseInt(whole + frac, 10);
      return makeFraction(num, scale);
    }

    function tokenizeExpression(input) {
      var raw = String(input || "").replace(/\s+/g, "");
      if (!raw) {
        return [];
      }
      var tokens = [];
      var i = 0;

      while (i < raw.length) {
        var ch = raw[i];
        if (/[0-9.]/.test(ch)) {
          var start = i;
          i += 1;
          while (i < raw.length && /[0-9.]/.test(raw[i])) {
            i += 1;
          }
          var numStr = raw.slice(start, i);
          if ((numStr.match(/\./g) || []).length > 1) {
            throw new Error("Invalid number: " + numStr);
          }
          tokens.push({ type: "number", value: parseNumberToken(numStr) });
          continue;
        }
        if (/[a-zA-Z]/.test(ch)) {
          tokens.push({ type: "var", value: ch.toLowerCase() });
          i += 1;
          continue;
        }
        if ("+-*/^()".indexOf(ch) >= 0) {
          if (ch === "(" || ch === ")") {
            tokens.push({ type: "paren", value: ch });
          } else {
            tokens.push({ type: "op", value: ch });
          }
          i += 1;
          continue;
        }
        throw new Error("Unsupported character: " + ch);
      }

      var withMul = [];
      var isValueToken = function (tok) {
        return tok.type === "number" || tok.type === "var" || (tok.type === "paren" && tok.value === ")");
      };
      var isValueStart = function (tok) {
        return tok.type === "number" || tok.type === "var" || (tok.type === "paren" && tok.value === "(");
      };

      for (var t = 0; t < tokens.length; t += 1) {
        var current = tokens[t];
        var next = tokens[t + 1];
        withMul.push(current);
        if (next && isValueToken(current) && isValueStart(next)) {
          withMul.push({ type: "op", value: "*" });
        }
      }

      var finalTokens = [];
      for (var j = 0; j < withMul.length; j += 1) {
        var token = withMul[j];
        var prev = finalTokens[finalTokens.length - 1];
        if (token.type === "op" && token.value === "-") {
          var isUnary = !prev || (prev.type === "op") || (prev.type === "paren" && prev.value === "(");
          if (isUnary) {
            finalTokens.push({ type: "number", value: makeFraction(0, 1) });
          }
        }
        finalTokens.push(token);
      }

      return finalTokens;
    }

    function toRpn(tokens) {
      var output = [];
      var ops = [];
      var precedence = { "+": 2, "-": 2, "*": 3, "/": 3, "^": 4 };
      var rightAssoc = { "^": true };

      tokens.forEach(function (token) {
        if (token.type === "number" || token.type === "var") {
          output.push(token);
          return;
        }
        if (token.type === "op") {
          while (ops.length) {
            var top = ops[ops.length - 1];
            if (top.type !== "op") break;
            var precTop = precedence[top.value];
            var precTok = precedence[token.value];
            if (precTop > precTok || (precTop === precTok && !rightAssoc[token.value])) {
              output.push(ops.pop());
              continue;
            }
            break;
          }
          ops.push(token);
          return;
        }
        if (token.type === "paren" && token.value === "(") {
          ops.push(token);
          return;
        }
        if (token.type === "paren" && token.value === ")") {
          while (ops.length && !(ops[ops.length - 1].type === "paren" && ops[ops.length - 1].value === "(")) {
            output.push(ops.pop());
          }
          if (!ops.length) {
            throw new Error("Mismatched parentheses");
          }
          ops.pop();
        }
      });

      while (ops.length) {
        var op = ops.pop();
        if (op.type === "paren") {
          throw new Error("Mismatched parentheses");
        }
        output.push(op);
      }

      return output;
    }

    function varsToKey(vars) {
      var names = Object.keys(vars).sort();
      return names
        .map(function (name) {
          var exp = vars[name];
          return exp === 1 ? name : name + "^" + exp;
        })
        .join("*");
    }

    var varsCache = new Map();

    function keyToVars(key) {
      if (varsCache.has(key)) {
        return varsCache.get(key);
      }
      var vars = {};
      if (key) {
        key.split("*").forEach(function (part) {
          var pieces = part.split("^");
          var name = pieces[0];
          var exp = pieces[1] ? parseInt(pieces[1], 10) : 1;
          vars[name] = (vars[name] || 0) + exp;
        });
      }
      varsCache.set(key, vars);
      return vars;
    }

    function polyFromConstant(frac) {
      var poly = new Map();
      if (!fracIsZero(frac)) {
        poly.set("", frac);
      }
      return poly;
    }

    function polyFromVariable(name) {
      var poly = new Map();
      poly.set(name, makeFraction(1, 1));
      return poly;
    }

    function polyAdd(a, b) {
      var out = new Map(a);
      b.forEach(function (coeff, key) {
        var existing = out.get(key);
        var next = existing ? fracAdd(existing, coeff) : coeff;
        if (fracIsZero(next)) {
          out.delete(key);
        } else {
          out.set(key, next);
        }
      });
      return out;
    }

    function polySub(a, b) {
      var out = new Map(a);
      b.forEach(function (coeff, key) {
        var existing = out.get(key);
        var next = existing ? fracSub(existing, coeff) : fracNeg(coeff);
        if (fracIsZero(next)) {
          out.delete(key);
        } else {
          out.set(key, next);
        }
      });
      return out;
    }

    function polyMul(a, b) {
      var out = new Map();
      a.forEach(function (coeffA, keyA) {
        var varsA = keyToVars(keyA);
        b.forEach(function (coeffB, keyB) {
          var varsB = keyToVars(keyB);
          var vars = {};
          Object.keys(varsA).forEach(function (name) {
            vars[name] = varsA[name];
          });
          Object.keys(varsB).forEach(function (name) {
            vars[name] = (vars[name] || 0) + varsB[name];
          });
          var key = varsToKey(vars);
          var coeff = fracMul(coeffA, coeffB);
          var existing = out.get(key);
          var next = existing ? fracAdd(existing, coeff) : coeff;
          if (fracIsZero(next)) {
            out.delete(key);
          } else {
            out.set(key, next);
          }
        });
      });
      return out;
    }

    function polyIsConstant(poly) {
      if (poly.size === 0) return true;
      if (poly.size === 1 && poly.has("")) return true;
      return false;
    }

    function polyGetConstant(poly) {
      return poly.get("") || makeFraction(0, 1);
    }

    function polyPow(poly, exp) {
      if (exp === 0) return polyFromConstant(makeFraction(1, 1));
      if (exp === 1) return poly;
      var result = polyFromConstant(makeFraction(1, 1));
      var base = poly;
      var power = exp;
      while (power > 0) {
        if (power % 2 === 1) {
          result = polyMul(result, base);
        }
        base = polyMul(base, base);
        power = Math.floor(power / 2);
      }
      return result;
    }

    function evalRpn(tokens) {
      var stack = [];
      tokens.forEach(function (token) {
        if (token.type === "number") {
          stack.push(polyFromConstant(token.value));
          return;
        }
        if (token.type === "var") {
          stack.push(polyFromVariable(token.value));
          return;
        }
        if (token.type === "op") {
          var right = stack.pop();
          var left = stack.pop();
          if (!left || !right) {
            throw new Error("Invalid expression");
          }
          if (token.value === "+") {
            stack.push(polyAdd(left, right));
          } else if (token.value === "-") {
            stack.push(polySub(left, right));
          } else if (token.value === "*") {
            stack.push(polyMul(left, right));
          } else if (token.value === "/") {
            if (!polyIsConstant(right)) {
              throw new Error("Division is only supported by constants.");
            }
            var divisor = polyGetConstant(right);
            stack.push(polyMul(left, polyFromConstant(fracDiv(makeFraction(1, 1), divisor))));
          } else if (token.value === "^") {
            if (!polyIsConstant(right)) {
              throw new Error("Exponent must be a constant.");
            }
            var expFrac = polyGetConstant(right);
            if (expFrac.d !== 1) {
              throw new Error("Exponent must be an integer.");
            }
            var expVal = expFrac.n;
            if (expVal < 0) {
              throw new Error("Exponent must be non-negative.");
            }
            stack.push(polyPow(left, expVal));
          }
        }
      });
      if (stack.length !== 1) {
        throw new Error("Invalid expression");
      }
      return stack[0];
    }

    function formatMonomial(key) {
      if (!key) return "";
      return key.split("*").map(function (part) {
        var pieces = part.split("^");
        if (pieces.length === 1) return pieces[0];
        return pieces[0] + "^" + pieces[1];
      }).join("");
    }

    function polyToString(poly, useFraction) {
      if (poly.size === 0) return "0";
      var terms = [];
      poly.forEach(function (coeff, key) {
        var degree = 0;
        if (key) {
          key.split("*").forEach(function (part) {
            var pieces = part.split("^");
            degree += pieces[1] ? parseInt(pieces[1], 10) : 1;
          });
        }
        terms.push({ key: key, coeff: coeff, degree: degree });
      });

      terms.sort(function (a, b) {
        if (a.degree !== b.degree) return b.degree - a.degree;
        return a.key.localeCompare(b.key);
      });

      var output = "";
      terms.forEach(function (term, index) {
        var coeff = term.coeff;
        var isNegative = coeff.n < 0;
        var absCoeff = isNegative ? fracNeg(coeff) : coeff;
        var coeffStr = fracToString(absCoeff, useFraction);
        var monomial = formatMonomial(term.key);

        var prefix = "";
        if (index === 0) {
          prefix = isNegative ? "-" : "";
        } else {
          prefix = isNegative ? " - " : " + ";
        }

        if (monomial) {
          if (coeffStr === "1") {
            output += prefix + monomial;
          } else {
            output += prefix + coeffStr + monomial;
          }
        } else {
          output += prefix + coeffStr;
        }
      });

      return output;
    }

    function polyScale(poly, frac) {
      return polyMul(poly, polyFromConstant(frac));
    }

    function normalizeExprString(value) {
      return String(value || "").replace(/\s+/g, "");
    }

    function normalizeTermString(value) {
      return normalizeExprString(value).replace(/\*/g, "");
    }

    function parseSpecialProduct(raw) {
      var cleaned = normalizeExprString(raw);
      if (!cleaned) return null;

      var squareMatch = cleaned.match(/^\(([^()+-]+)([+-])([^()+-]+)\)\^2$/);
      if (squareMatch) {
        return {
          type: squareMatch[2] === "+" ? "square-plus" : "square-minus",
          a: squareMatch[1],
          b: squareMatch[3]
        };
      }

      var diffMatch = cleaned.match(/^\(([^()+-]+)\+([^()+-]+)\)\(([^()+-]+)-([^()+-]+)\)$/);
      if (diffMatch) {
        var a1 = normalizeTermString(diffMatch[1]);
        var b1 = normalizeTermString(diffMatch[2]);
        var a2 = normalizeTermString(diffMatch[3]);
        var b2 = normalizeTermString(diffMatch[4]);
        if (a1 === a2 && b1 === b2) {
          return {
            type: "diff-squares",
            a: diffMatch[1],
            b: diffMatch[2]
          };
        }
      }

      return null;
    }

    function renderExpressionSteps(html) {
      if (exprAction) {
        exprAction.innerHTML = html || "";
      }
    }

    function renderExpressionResult(text) {
      if (exprResult) {
        exprResult.textContent = text || "";
      }
    }

    function expandSpecialProduct(raw) {
      var special = parseSpecialProduct(raw);
      if (!special) {
        return { error: "Not a special product. Try the regular Expand button." };
      }

      var aPoly = evalRpn(toRpn(tokenizeExpression(special.a)));
      var bPoly = evalRpn(toRpn(tokenizeExpression(special.b)));
      var useFraction = exprFractionToggle ? exprFractionToggle.checked : false;

      var formula = "";
      var substitute = "";
      var finalPoly = null;

      if (special.type === "square-plus") {
        formula = "(a + b)^2 = a^2 + 2ab + b^2";
        substitute = "(" + special.a + ")^2 + 2(" + special.a + ")(" + special.b + ") + (" + special.b + ")^2";
        var a2 = polyMul(aPoly, aPoly);
        var b2 = polyMul(bPoly, bPoly);
        var twoab = polyScale(polyMul(aPoly, bPoly), makeFraction(2, 1));
        finalPoly = polyAdd(polyAdd(a2, twoab), b2);
      } else if (special.type === "square-minus") {
        formula = "(a - b)^2 = a^2 - 2ab + b^2";
        substitute = "(" + special.a + ")^2 - 2(" + special.a + ")(" + special.b + ") + (" + special.b + ")^2";
        var a2m = polyMul(aPoly, aPoly);
        var b2m = polyMul(bPoly, bPoly);
        var twoabm = polyScale(polyMul(aPoly, bPoly), makeFraction(2, 1));
        finalPoly = polyAdd(polySub(a2m, twoabm), b2m);
      } else if (special.type === "diff-squares") {
        formula = "(a + b)(a - b) = a^2 - b^2";
        substitute = "(" + special.a + ")^2 - (" + special.b + ")^2";
        var a2d = polyMul(aPoly, aPoly);
        var b2d = polyMul(bPoly, bPoly);
        finalPoly = polySub(a2d, b2d);
      }

      var steps = [];
      steps.push(stepBlock("Step 1: Recognise the identity", formula));
      steps.push(stepBlock("Step 2: Identify a and b", "a = " + special.a + ", b = " + special.b));
      steps.push(stepBlock("Step 3: Substitute into the formula", substitute));
      steps.push(stepBlock("Step 4: Simplify", polyToString(finalPoly, useFraction)));

      return {
        steps: steps.join(""),
        result: polyToString(finalPoly, useFraction)
      };
    }

    function evaluateExpression(raw, mode) {
      var tokens = tokenizeExpression(raw);
      if (!tokens.length) {
        throw new Error("Enter an expression first.");
      }
      var rpn = toRpn(tokens);
      var poly = evalRpn(rpn);
      return poly;
    }

    function inferAction(raw) {
      return String(raw || "").indexOf("(") >= 0 ? "expand" : "simplify";
    }

    function runExpression(mode) {
      if (!exprInput) return;
      var raw = exprInput.value.trim();
      if (!raw) {
        notify("Enter an expression.");
        return;
      }
      try {
        var poly = evaluateExpression(raw, mode);
        var useFraction = exprFractionToggle ? exprFractionToggle.checked : false;
        var inferred = inferAction(raw);
        var actionNote = "";
        if (mode === "simplify" && inferred === "expand") {
          actionNote = "Detected parentheses. Expanded, then simplified.";
        } else if (mode === "expand" && inferred === "simplify") {
          actionNote = "No expansion needed. Simplified instead.";
        } else {
          actionNote = mode === "expand" ? "Expanded and simplified." : "Simplified.";
        }
        renderExpressionSteps(stepBlock("Action", actionNote));
        renderExpressionResult(polyToString(poly, useFraction));
      } catch (err) {
        renderExpressionSteps(stepBlock("Error", err.message));
        renderExpressionResult("");
      }
    }

    if (exprSimplify) {
      exprSimplify.addEventListener("click", function () {
        runExpression("simplify");
      });
    }

    if (exprExpand) {
      exprExpand.addEventListener("click", function () {
        runExpression("expand");
      });
    }

    if (exprSpecial) {
      exprSpecial.addEventListener("click", function () {
        if (!exprInput) return;
        var raw = exprInput.value.trim();
        if (!raw) {
          notify("Enter an expression.");
          return;
        }
        var result = expandSpecialProduct(raw);
        if (result.error) {
          renderExpressionSteps(stepBlock("Not a special product", result.error));
          renderExpressionResult("");
        } else {
          renderExpressionSteps(result.steps);
          renderExpressionResult(result.result);
        }
        refreshMathJax();
      });
    }

    if (exprClear) {
      exprClear.addEventListener("click", function () {
        if (exprInput) exprInput.value = "";
        renderExpressionSteps("");
        renderExpressionResult("");
      });
    }
  }

  function setupAppsWindow() {
    var openBtn = document.getElementById("appsSettingsBtn");
    var windowEl = document.getElementById("appsSettingsWindow");
    var header = document.getElementById("appsSettingsHeader");
    var closeBtn = document.getElementById("appsSettingsClose");
    var resizeHandle = document.getElementById("appsSettingsResize");
    var themeToggle = document.getElementById("appThemeToggle");
    var switchText = windowEl ? windowEl.querySelector(".app-switch-text") : null;

    if (!openBtn || !windowEl) {
      return;
    }

    function applyTheme(isDark) {
      var switchingToLight = !isDark && !document.body.classList.contains("light-theme");
      document.body.classList.toggle("dark-theme", isDark);
      document.body.classList.toggle("light-theme", !isDark);
      document.body.classList.add("theme-shift");
      if (themeShiftTimer) {
        window.clearTimeout(themeShiftTimer);
      }
      themeShiftTimer = window.setTimeout(function () {
        document.body.classList.remove("theme-shift");
      }, 500);

      if (switchingToLight) {
        document.body.classList.remove("theme-light-fade");
        void document.body.offsetWidth;
        document.body.classList.add("theme-light-fade");
        if (applyTheme.fadeTimer) {
          window.clearTimeout(applyTheme.fadeTimer);
        }
        applyTheme.fadeTimer = window.setTimeout(function () {
          document.body.classList.remove("theme-light-fade");
        }, 660);
      }
    }

    function syncToggle() {
      if (!themeToggle) return;
      var isDark = document.body.classList.contains("dark-theme");
      themeToggle.checked = isDark;
      if (switchText) {
        switchText.textContent = isDark ? "Dark Mode" : "Light Mode";
      }
    }

    function openWindow() {
      if (windowEl.parentNode !== document.body) {
        document.body.appendChild(windowEl);
      }
      var isMobile = window.innerWidth <= 768;
      if (isMobile) {
        windowEl.classList.add("mobile-fullscreen");
      } else {
        windowEl.classList.remove("mobile-fullscreen");
      }
      windowEl.classList.remove("hidden");
      windowEl.setAttribute("aria-hidden", "false");

      var maxWidth = Math.max(320, window.innerWidth - 40);
      var maxHeight = Math.max(240, window.innerHeight - 120);
      var width = Math.min(520, maxWidth);
      var height = Math.min(360, maxHeight);

      windowEl.style.width = width + "px";
      windowEl.style.height = height + "px";
      windowEl.style.transform = "none";

      if (!isMobile) {
        var left = Math.max(20, (window.innerWidth - width) / 2);
        var top = Math.max(80, (window.innerHeight - height) / 2);
        windowEl.style.left = left + "px";
        windowEl.style.top = top + "px";
      }

      syncToggle();
    }

    function closeWindow() {
      windowEl.classList.add("closing");
      windowEl.addEventListener("animationend", function() {
        windowEl.classList.remove("closing");
        windowEl.classList.add("hidden");
        windowEl.setAttribute("aria-hidden", "true");
      }, { once: true });
    }

    openBtn.addEventListener("click", function () {
      openWindow();
    });

    bindWindowInteractions({
      windowEl: windowEl,
      headerEl: header,
      closeBtn: closeBtn,
      resizeHandleEl: resizeHandle,
      minWidth: 320,
      minHeight: 240,
      onClose: closeWindow,
      sizeBoundsProvider: function () {
        return {
          maxW: Math.max(320, window.innerWidth - 20),
          maxH: Math.max(240, window.innerHeight - 20)
        };
      }
    });

    if (themeToggle) {
      themeToggle.addEventListener("change", function () {
        applyTheme(themeToggle.checked);
        syncToggle();
      });
    }

    window.addEventListener("resize", function () {
      if (windowEl.classList.contains("hidden")) return;
      var rect = windowEl.getBoundingClientRect();
      var maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      var maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      windowEl.style.left = Math.min(Math.max(8, rect.left), maxLeft) + "px";
      windowEl.style.top = Math.min(Math.max(8, rect.top), maxTop) + "px";
    });
  }

  function setupAppsLoader() {
    var appUpload = document.getElementById("appUpload");
    var appDesktop = document.getElementById("appDesktop");
    if (!appUpload || !appDesktop) {
      return;
    }

    var zIndexCounter = 60;
    var windowOffset = 0;

    function notify(message) {
      if (typeof window.showSnackbar === "function") {
        window.showSnackbar(message);
        return;
      }
      console.warn(message);
    }

    function bringToFront(windowEl) {
      zIndexCounter += 1;
      windowEl.style.zIndex = String(zIndexCounter);
    }

    function createAppWindow(title, html) {
      var isMobile = window.innerWidth <= 768;
      var windowEl = document.createElement("div");
      windowEl.className = "app-window-shell" + (isMobile ? " mobile-fullscreen" : "");
      windowEl.style.zIndex = String(zIndexCounter);

      var header = document.createElement("div");
      header.className = "app-window-header";
      var titleEl = document.createElement("div");
      titleEl.className = "app-window-title";
      titleEl.textContent = title;
      var closeBtn = document.createElement("button");
      closeBtn.className = "app-window-close";
      closeBtn.type = "button";
      closeBtn.textContent = "X";
      header.appendChild(titleEl);
      header.appendChild(closeBtn);

      var body = document.createElement("div");
      body.className = "app-window-body";
      var iframe = document.createElement("iframe");
      iframe.className = "app-window-iframe";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.srcdoc = html;
      body.appendChild(iframe);

      var resizeHandle = document.createElement("div");
      resizeHandle.className = "app-window-resize-handle";

      windowEl.appendChild(header);
      windowEl.appendChild(body);
      windowEl.appendChild(resizeHandle);
      document.body.appendChild(windowEl);

      if (isMobile) {
        windowEl.style.transform = "none";
        closeBtn.addEventListener("click", function () { 
          windowEl.classList.add("closing");
          windowEl.addEventListener("animationend", function() { windowEl.remove(); }, { once: true });
        });
        windowEl.addEventListener("mousedown", function () { bringToFront(windowEl); });
      } else {
        var width = Math.min(520, window.innerWidth - 40);
        var height = Math.min(360, window.innerHeight - 120);
        var offset = 24 + windowOffset;
        var left = Math.max(16, (window.innerWidth - width) / 2 + offset);
        var top = Math.max(80, (window.innerHeight - height) / 2 + offset);
        windowEl.style.width = Math.max(320, width) + "px";
        windowEl.style.height = Math.max(240, height) + "px";
        windowEl.style.left = Math.min(window.innerWidth - width - 8, left) + "px";
        windowEl.style.top = Math.min(window.innerHeight - height - 8, top) + "px";
        windowEl.style.transform = "none";
        windowOffset = (windowOffset + 24) % 120;

        bindWindowInteractions({
          windowEl: windowEl,
          headerEl: header,
          closeBtn: closeBtn,
          resizeHandleEl: resizeHandle,
          minWidth: 320,
          minHeight: 240,
          onClose: function () {
            windowEl.classList.add("closing");
            windowEl.addEventListener("animationend", function() { windowEl.remove(); }, { once: true });
          },
          onActivate: function () {
            bringToFront(windowEl);
          },
          activateOnMouseDown: true
        });
      }

      var hint = appDesktop.querySelector(".app-desktop-hint");
      if (hint) {
        hint.remove();
      }

      bringToFront(windowEl);
    }

    appUpload.addEventListener("change", function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith(".html")) {
        notify("Upload a .html file only.");
        appUpload.value = "";
        return;
      }

      var reader = new FileReader();
      reader.onload = function (loadEvent) {
        var html = loadEvent.target && loadEvent.target.result ? String(loadEvent.target.result) : "";
        createAppWindow(file.name.replace(/\.html$/i, ""), html);
      };
      reader.readAsText(file);
      appUpload.value = "";
    });

    window.addEventListener("resize", function () {
      var windows = document.querySelectorAll(".app-window-shell");
      windows.forEach(function (windowEl) {
        var rect = windowEl.getBoundingClientRect();
        var maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
        var maxTop = Math.max(8, window.innerHeight - rect.height - 8);
        windowEl.style.left = Math.min(Math.max(8, rect.left), maxLeft) + "px";
        windowEl.style.top = Math.min(Math.max(8, rect.top), maxTop) + "px";
      });
    });
  }

  function setupUpdateFilters() {
    var updateSection = document.getElementById("update");
    if (!updateSection) {
      return;
    }
    var filters = Array.prototype.slice.call(updateSection.querySelectorAll(".update-filter"));
    var items = Array.prototype.slice.call(updateSection.querySelectorAll(".update-item"));
    if (!filters.length || !items.length) {
      return;
    }

    var activeTag = null;

    function applyFilter(tag) {
      activeTag = tag || null;
      filters.forEach(function (btn) {
        var isActive = activeTag && btn.dataset.tag === activeTag;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      items.forEach(function (item) {
        if (!activeTag) {
          item.style.display = "";
          return;
        }
        var tags = (item.dataset.tag || "").split(",").map(function (v) { return v.trim(); });
        item.style.display = tags.indexOf(activeTag) >= 0 ? "" : "none";
      });
    }

    filters.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tag = btn.dataset.tag || "";
        if (!tag) {
          applyFilter(null);
          return;
        }
        if (activeTag === tag) {
          applyFilter(null);
        } else {
          applyFilter(tag);
        }
      });
    });

    applyFilter(null);
  }

  function setupUpdateAccordionAnimations() {
    var updateSection = document.getElementById("update");
    if (!updateSection) {
      return;
    }
    var items = Array.prototype.slice.call(updateSection.querySelectorAll(".update-item"));
    if (!items.length) {
      return;
    }

    items.forEach(function (item) {
      item.addEventListener("toggle", function () {
        var body = item.querySelector(".update-body");
        if (!body) return;

        body.classList.remove("is-animating-in");
        body.classList.remove("is-animating-out");
        void body.offsetWidth;

        if (item.open) {
          body.classList.add("is-animating-in");
          window.setTimeout(function () {
            body.classList.remove("is-animating-in");
          }, 380);
        } else {
          body.classList.add("is-animating-out");
          window.setTimeout(function () {
            body.classList.remove("is-animating-out");
          }, 240);
        }
      });
    });
  }

  function setupZoomGuards() {
    document.addEventListener("wheel", function (event) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    }, { passive: false });

    document.addEventListener("keydown", function (event) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      var key = String(event.key || "").toLowerCase();
      if (key === "+" || key === "=" || key === "-" || key === "_" || key === "0") {
        event.preventDefault();
      }
    });

    ["gesturestart", "gesturechange", "gestureend"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        event.preventDefault();
      }, { passive: false });
    });
  }

  function ensureTerminalUpgradeOverlay() {
    var overlay = document.getElementById("terminalUpgradeOverlay");
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.id = "terminalUpgradeOverlay";
    overlay.className = "terminal-upgrade-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<div class="terminal-upgrade-panel">' +
        '<div class="terminal-upgrade-text" id="terminalUpgradeText">entering terminal</div>' +
        '<button class="terminal-upgrade-button hidden" id="terminalUpgradeButton" type="button">Update</button>' +
        '<div class="terminal-upgrade-progress hidden" id="terminalUpgradeProgress">' +
          '<div class="terminal-upgrade-status" id="terminalUpgradeStatus">Preparing update</div>' +
          '<div class="terminal-upgrade-bar"><span id="terminalUpgradeBar"></span></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function setWebsiteUpgraded(isUpgraded) {
    document.body.classList.toggle("arch-upgraded", isUpgraded);
    try {
      window.localStorage.setItem("archWebsiteUpgraded", isUpgraded ? "true" : "false");
    } catch (error) {
    }
  }

  function applyStoredWebsiteUpgrade() {
    try {
      setWebsiteUpgraded(window.localStorage.getItem("archWebsiteUpgraded") === "true");
    } catch (error) {
      setWebsiteUpgraded(false);
    }
  }

  function playWebsiteUpgradeIntro() {
    if (prefersReducedMotion) {
      return;
    }
    document.body.classList.remove("arch-upgrade-intro");
    void document.body.offsetWidth;
    document.body.classList.add("arch-upgrade-intro");
    window.setTimeout(function () {
      document.body.classList.remove("arch-upgrade-intro");
    }, 980);
  }

  function isUpdateReminderDisabled() {
    try {
      return window.localStorage.getItem(UPDATE_REMINDER_DISABLED_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function setUpdateReminderDisabled(isDisabled) {
    try {
      if (isDisabled) {
        window.localStorage.setItem(UPDATE_REMINDER_DISABLED_KEY, "true");
      } else {
        window.localStorage.removeItem(UPDATE_REMINDER_DISABLED_KEY);
      }
    } catch (error) {
    }
  }

  function ensureUpdateReminderOverlay() {
    var overlay = document.getElementById("updateReminderOverlay");
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.id = "updateReminderOverlay";
    overlay.className = "update-reminder-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<div class="update-reminder-panel" role="dialog" aria-labelledby="updateReminderTitle">' +
        '<div class="update-reminder-title" id="updateReminderTitle">There is an update available</div>' +
        '<div class="update-reminder-actions">' +
          '<button class="update-reminder-btn update-now" id="updateReminderNow" type="button">Update Now</button>' +
          '<button class="update-reminder-btn later" id="updateReminderLater" type="button">Later</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeUpdateReminderOverlay() {
    var overlay = document.getElementById("updateReminderOverlay");
    if (!overlay) {
      return;
    }
    overlay.classList.remove("is-open");
    overlay.classList.add("is-closing");
    overlay.setAttribute("aria-hidden", "true");
    window.setTimeout(function () {
      overlay.classList.remove("is-closing");
    }, prefersReducedMotion ? 0 : 260);
  }

  function showUpdateReminderIfNeeded() {
    if (document.body.classList.contains("arch-upgraded") || isUpdateReminderDisabled()) {
      return;
    }
    try {
      if (window.sessionStorage.getItem(UPDATE_REMINDER_SESSION_KEY) === "true") {
        return;
      }
    } catch (error) {
    }

    var overlay = ensureUpdateReminderOverlay();
    var updateNow = overlay.querySelector("#updateReminderNow");
    var later = overlay.querySelector("#updateReminderLater");

    if (updateNow) {
      updateNow.onclick = function () {
        setWebsiteUpgraded(true);
        closeUpdateReminderOverlay();
        playWebsiteUpgradeIntro();
        notifySnackbar("Website upgraded.");
      };
    }
    if (later) {
      later.onclick = function () {
        try {
          window.sessionStorage.setItem(UPDATE_REMINDER_SESSION_KEY, "true");
        } catch (error) {
        }
        closeUpdateReminderOverlay();
      };
    }

    overlay.classList.remove("is-closing");
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
  }

  function startTerminalUpgradeFlow() {
    var overlay = ensureTerminalUpgradeOverlay();
    var text = overlay.querySelector("#terminalUpgradeText");
    var button = overlay.querySelector("#terminalUpgradeButton");
    var progress = overlay.querySelector("#terminalUpgradeProgress");
    var status = overlay.querySelector("#terminalUpgradeStatus");
    var bar = overlay.querySelector("#terminalUpgradeBar");
    var countdownTimer = null;
    var promptTimer = null;

    function closeOverlay(afterClose) {
      if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      if (promptTimer) {
        window.clearTimeout(promptTimer);
        promptTimer = null;
      }
      overlay.classList.add("is-closing");
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
      window.setTimeout(function () {
        overlay.classList.remove("is-closing", "is-updating", "is-ready");
        if (typeof afterClose === "function") {
          afterClose();
        }
      }, prefersReducedMotion ? 0 : 460);
    }

    overlay.classList.remove("is-closing");
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("is-updating", "is-ready");
    if (text) text.textContent = "entering terminal";
    if (button) {
      button.textContent = "Update";
      button.classList.add("hidden");
      button.onclick = null;
    }
    if (progress) progress.classList.add("hidden");
    if (bar) bar.style.width = "0%";

    promptTimer = window.setTimeout(function () {
      promptTimer = null;
      if (text) text.textContent = "you need to have an update to proceed";
      if (button) {
        button.classList.remove("hidden");
        button.onclick = function () {
          var remaining = 10;
          button.classList.add("hidden");
          overlay.classList.add("is-updating");
          if (progress) progress.classList.remove("hidden");
          if (status) status.textContent = "Updating... " + remaining + "s";
          if (bar) bar.style.width = "0%";
          countdownTimer = window.setInterval(function () {
            remaining -= 1;
            var percent = Math.max(0, Math.min(100, ((10 - remaining) / 10) * 100));
            if (bar) bar.style.width = percent + "%";
            if (status) status.textContent = "Updating... " + Math.max(0, remaining) + "s";
            if (remaining <= 0) {
              window.clearInterval(countdownTimer);
              countdownTimer = null;
              overlay.classList.remove("is-updating");
              overlay.classList.add("is-ready");
              if (text) text.textContent = "Update complete";
              if (status) status.textContent = "Ready to proceed";
              if (bar) bar.style.width = "100%";
              if (button) {
                button.textContent = "Proceed";
                button.classList.remove("hidden");
                button.onclick = function () {
                  setWebsiteUpgraded(true);
                  closeOverlay(function () {
                    playWebsiteUpgradeIntro();
                    notifySnackbar("Website upgraded. Type downgrade in Terminal to restore the old design.");
                  });
                };
              }
            }
          }, 1000);
        };
      }
    }, 1500);
  }

  function setupTerminalCommands() {
    var terminalSection = document.getElementById("terminal");
    if (!terminalSection) {
      return;
    }
    var input = terminalSection.querySelector(".terminal-input");
    var runBtn = terminalSection.querySelector(".terminal-run-btn");
    var output = terminalSection.querySelector(".terminal-output");
    if (!input || !runBtn || !output) {
      return;
    }

    function renderOutput(targetOutput, title, lines) {
      if (!targetOutput) {
        return;
      }
      var content = "<div class=\"terminal-output-title\">" + title + "</div>";
      lines.forEach(function (line) {
        content += "<div class=\"terminal-command\">" + line + "</div>";
      });
      targetOutput.innerHTML = content;
      targetOutput.classList.remove("is-animating");
      void targetOutput.offsetWidth;
      targetOutput.classList.add("is-animating");
    }

    function renderHelp(targetOutput) {
      var commands = [
        "/help - Show general command list",
        "ent terminal -i - Enter terminal update",
        "clear localstorage - Clear saved website data",
        "force mobile ui - Force mobile layout",
        "force pc ui - Force PC layout",
        "reset ui - Restore responsive layout",
        "terminate update reminders - Disable update popup"
      ];
      if (document.body.classList.contains("arch-upgraded")) {
        commands.push("downgrade - Restore old website design");
      }
      renderOutput(targetOutput, "Commands", commands);
    }

    function renderInfo(targetOutput, message) {
      renderOutput(targetOutput, "Info", [message]);
    }

    terminalCommandRunner = function (raw, targetOutput) {
      var source = String(raw || "").trim();
      if (!source) {
        return;
      }
      var normalized = source.toLowerCase().replace(/\s+/g, " ").trim();
      if (normalized === "/help") {
        renderHelp(targetOutput);
        return;
      }
      if (normalized === "clear localstorage" || normalized === "clear local storage" || normalized === "clear storage") {
        try {
          window.localStorage.clear();
          window.sessionStorage.removeItem(UPDATE_REMINDER_SESSION_KEY);
        } catch (error) {
        }
        document.body.classList.remove("arch-upgraded", "arch-upgrade-intro", "force-mobile-ui", "force-pc-ui");
        renderInfo(targetOutput, "LocalStorage cleared. Reload the page for a fully clean boot.");
        return;
      }
      if (normalized === "force mobile ui" || normalized === "force mobile" || normalized === "mobile ui") {
        applyForcedUiMode("mobile");
        renderInfo(targetOutput, "Mobile UI forced. Type reset ui to restore responsive mode.");
        return;
      }
      if (normalized === "force pc ui" || normalized === "force desktop ui" || normalized === "force pc" || normalized === "pc ui" || normalized === "desktop ui") {
        applyForcedUiMode("pc");
        renderInfo(targetOutput, "PC UI forced. Type reset ui to restore responsive mode.");
        return;
      }
      if (normalized === "reset ui" || normalized === "auto ui" || normalized === "responsive ui") {
        applyForcedUiMode("");
        renderInfo(targetOutput, "Responsive UI restored.");
        return;
      }
      if (normalized === "terminate update reminders" || normalized === "disable update reminders" || normalized === "terminate update reminder") {
        setUpdateReminderDisabled(true);
        closeUpdateReminderOverlay();
        renderInfo(targetOutput, "Update reminders disabled.");
        return;
      }
      if (normalized === "ent terminal -i" || normalized === "enter terminal -i") {
        if (document.body.classList.contains("arch-upgraded")) {
          renderInfo(targetOutput, "Terminal update is already installed. Type downgrade to restore the old design.");
          return;
        }
        renderInfo(targetOutput, "Opening terminal update.");
        startTerminalUpgradeFlow();
        return;
      }
      if (normalized === "downgrade" || normalized === "downgrade -i" || normalized === "terminal downgrade") {
        if (!document.body.classList.contains("arch-upgraded")) {
          renderInfo(targetOutput, "Old website design is already active.");
          return;
        }
        setWebsiteUpgraded(false);
        renderInfo(targetOutput, "Downgrade complete. Old website design restored.");
        return;
      }
      notifySnackbar("Unknown Command");
    };

    function handleRun() {
      var raw = String(input.value || "").trim();
      if (!raw) {
        return;
      }
      terminalCommandRunner(raw, output);
      input.value = "";
    }

    runBtn.addEventListener("click", handleRun);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        handleRun();
      }
    });
  }

  function setupCustomContextMenu() {
    var contextMenu = document.getElementById("customContextMenu");
    if (!contextMenu) {
      return;
    }

    var desktopLauncher = document.getElementById("terminalLauncherDesktop");
    var desktopLauncherInput = document.getElementById("terminalLauncherDesktopInput");
    var desktopLauncherRun = document.getElementById("terminalLauncherDesktopRun");
    var desktopLauncherClose = document.getElementById("terminalLauncherDesktopClose");
    var desktopLauncherOutput = document.getElementById("terminalLauncherDesktopOutput");

    var mobileLauncher = document.getElementById("terminalLauncherMobile");
    var mobileLauncherInput = document.getElementById("terminalLauncherMobileInput");
    var mobileLauncherRun = document.getElementById("terminalLauncherMobileRun");
    var mobileLauncherClose = document.getElementById("terminalLauncherMobileClose");
    var mobileLauncherOutput = document.getElementById("terminalLauncherMobileOutput");
    var contextItems = {
      cut: contextMenu.querySelector('[data-action="cut"]'),
      copy: contextMenu.querySelector('[data-action="copy"]'),
      paste: contextMenu.querySelector('[data-action="paste"]'),
      terminal: contextMenu.querySelector('[data-action="terminal"]')
    };

    var textInputTypes = {
      "text": true,
      "search": true,
      "url": true,
      "tel": true,
      "password": true,
      "email": true,
      "number": true
    };

    var state = {
      target: null,
      editable: null,
      selectionText: "",
      canCut: false,
      canCopy: false,
      canPaste: false
    };

    function isMobileViewport() {
      var forcedMode = getForcedUiMode();
      if (forcedMode === "mobile") {
        return true;
      }
      if (forcedMode === "pc") {
        return false;
      }
      if (window.matchMedia) {
        return window.matchMedia("(max-width: 960px)").matches;
      }
      return window.innerWidth <= 960;
    }

    function isTextInputElement(element) {
      if (!element || element.tagName !== "INPUT") {
        return false;
      }
      var type = String(element.type || "text").toLowerCase();
      return Boolean(textInputTypes[type]);
    }

    function getEditableElement(target) {
      var current = target;
      while (current && current !== document.body) {
        if (current.tagName === "TEXTAREA" || isTextInputElement(current) || current.isContentEditable) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    function isReadOnlyEditable(element) {
      if (!element) {
        return true;
      }
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        return element.disabled || element.readOnly;
      }
      return !element.isContentEditable;
    }

    function getSelectionText(editable) {
      if (!editable) {
        var docSelection = window.getSelection ? window.getSelection() : null;
        return docSelection ? docSelection.toString() : "";
      }

      if (editable.tagName === "INPUT" || editable.tagName === "TEXTAREA") {
        var start = typeof editable.selectionStart === "number" ? editable.selectionStart : 0;
        var end = typeof editable.selectionEnd === "number" ? editable.selectionEnd : 0;
        if (end > start) {
          return String(editable.value || "").slice(start, end);
        }
        return "";
      }

      var selection = window.getSelection ? window.getSelection() : null;
      return selection ? selection.toString() : "";
    }

    function setActionEnabled(action, enabled) {
      var item = contextItems[action];
      if (!item) {
        return;
      }
      item.classList.toggle("is-disabled", !enabled);
      item.setAttribute("aria-disabled", enabled ? "false" : "true");
    }

    function syncActionState() {
      setActionEnabled("cut", state.canCut);
      setActionEnabled("copy", state.canCopy);
      setActionEnabled("paste", state.canPaste);
      setActionEnabled("terminal", true);
    }

    function updateStateFromTarget(target) {
      state.target = target;
      state.editable = getEditableElement(target);
      state.selectionText = getSelectionText(state.editable);
      var hasSelection = state.selectionText.length > 0;
      var editableReadOnly = isReadOnlyEditable(state.editable);
      var editableWritable = Boolean(state.editable) && !editableReadOnly;

      state.canCut = editableWritable && hasSelection;
      state.canPaste = editableWritable;
      if (editableWritable || (state.editable && editableReadOnly)) {
        state.canCopy = hasSelection;
      } else {
        state.canCopy = hasSelection;
      }
      syncActionState();
    }

    function hideContextMenu() {
      contextMenu.classList.remove("is-open");
      contextMenu.setAttribute("aria-hidden", "true");
    }

    function showContextMenu(x, y) {
      var width = contextMenu.offsetWidth || 200;
      var height = contextMenu.offsetHeight || 180;
      var left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
      var top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
      contextMenu.style.left = left + "px";
      contextMenu.style.top = top + "px";
      contextMenu.classList.add("is-open");
      contextMenu.setAttribute("aria-hidden", "false");
    }

    function closeDesktopLauncher() {
      if (!desktopLauncher) {
        return;
      }
      desktopLauncher.classList.add("hidden");
      desktopLauncher.setAttribute("aria-hidden", "true");
    }

    function openDesktopLauncher() {
      if (!desktopLauncher) {
        return;
      }
      desktopLauncher.classList.remove("hidden");
      desktopLauncher.setAttribute("aria-hidden", "false");
      if (desktopLauncherInput) {
        window.setTimeout(function () {
          desktopLauncherInput.focus();
        }, 0);
      }
    }

    function closeMobileLauncher() {
      if (!mobileLauncher) {
        return;
      }
      mobileLauncher.classList.remove("is-open");
      mobileLauncher.setAttribute("aria-hidden", "true");
    }

    function openMobileLauncher() {
      if (!mobileLauncher) {
        return;
      }
      mobileLauncher.classList.add("is-open");
      mobileLauncher.setAttribute("aria-hidden", "false");
      if (mobileLauncherInput) {
        window.setTimeout(function () {
          mobileLauncherInput.focus();
        }, 0);
      }
    }

    function openTerminalLauncher() {
      if (isMobileViewport()) {
        closeDesktopLauncher();
        openMobileLauncher();
        return;
      }
      closeMobileLauncher();
      openDesktopLauncher();
    }

    window.openArchTerminalLauncher = openTerminalLauncher;

    function tryExecCommand(command) {
      try {
        return document.execCommand(command);
      } catch (error) {
        return false;
      }
    }

    function insertTextIntoEditable(target, text) {
      if (!target || !text) {
        return;
      }
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        var start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
        var end = typeof target.selectionEnd === "number" ? target.selectionEnd : start;
        target.focus();
        target.setRangeText(text, start, end, "end");
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      target.focus();
      try {
        if (document.execCommand("insertText", false, text)) {
          return;
        }
      } catch (error) {
      }
      var selection = window.getSelection ? window.getSelection() : null;
      if (!selection || !selection.rangeCount) {
        target.appendChild(document.createTextNode(text));
        return;
      }
      var range = selection.getRangeAt(0);
      range.deleteContents();
      var node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    async function copySelectionText(text) {
      if (!text) {
        return false;
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (error) {
        }
      }
      return tryExecCommand("copy");
    }

    async function handleCopy() {
      if (!state.canCopy || !state.selectionText) {
        return;
      }
      var copied = await copySelectionText(state.selectionText);
      if (!copied) {
        notifySnackbar("Copy blocked by browser.");
      }
    }

    async function handleCut() {
      if (!state.canCut || !state.editable) {
        return;
      }
      var target = state.editable;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        var start = typeof target.selectionStart === "number" ? target.selectionStart : 0;
        var end = typeof target.selectionEnd === "number" ? target.selectionEnd : 0;
        if (end <= start) {
          return;
        }
        var selected = String(target.value || "").slice(start, end);
        var copied = await copySelectionText(selected);
        if (copied) {
          target.setRangeText("", start, end, "start");
          target.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          notifySnackbar("Cut blocked by browser.");
        }
        return;
      }
      var cutDone = tryExecCommand("cut");
      if (!cutDone) {
        notifySnackbar("Cut blocked by browser.");
      }
    }

    async function handlePaste() {
      if (!state.canPaste || !state.editable) {
        return;
      }
      if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        try {
          var text = await navigator.clipboard.readText();
          insertTextIntoEditable(state.editable, text);
          return;
        } catch (error) {
        }
      }
      var pasted = tryExecCommand("paste");
      if (!pasted) {
        notifySnackbar("Paste blocked by browser.");
      }
    }

    function runLauncherCommand(inputEl, outputEl) {
      if (!inputEl || !outputEl) {
        return;
      }
      var raw = String(inputEl.value || "").trim();
      if (!raw) {
        return;
      }
      if (typeof terminalCommandRunner === "function") {
        terminalCommandRunner(raw, outputEl);
      } else {
        outputEl.innerHTML =
          "<div class=\"terminal-output-title\">Info</div>" +
          "<div class=\"terminal-command\">Terminal is not ready.</div>";
      }
      inputEl.value = "";
    }

    document.addEventListener("contextmenu", function (event) {
      if (event.target && (event.target.closest(".app-window-iframe") || event.target.closest("iframe"))) {
        return;
      }
      event.preventDefault();
      updateStateFromTarget(event.target);
      showContextMenu(event.clientX, event.clientY);
    });

    document.addEventListener("mousedown", function (event) {
      if (!contextMenu.classList.contains("is-open")) {
        return;
      }
      if (!contextMenu.contains(event.target)) {
        hideContextMenu();
      }
    });

    window.addEventListener("scroll", hideContextMenu, true);
    window.addEventListener("resize", hideContextMenu);
    window.addEventListener("blur", hideContextMenu);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideContextMenu();
        closeDesktopLauncher();
        closeMobileLauncher();
      }
    });

    contextMenu.addEventListener("click", async function (event) {
      var item = event.target.closest(".custom-context-item");
      if (!item) {
        return;
      }
      var action = item.dataset.action;
      if (item.classList.contains("is-disabled") || item.getAttribute("aria-disabled") === "true") {
        return;
      }

      if (action === "cut") {
        await handleCut();
      } else if (action === "copy") {
        await handleCopy();
      } else if (action === "paste") {
        await handlePaste();
      } else if (action === "terminal") {
        openTerminalLauncher();
      }
      hideContextMenu();
    });

    if (desktopLauncherRun) {
      desktopLauncherRun.addEventListener("click", function () {
        runLauncherCommand(desktopLauncherInput, desktopLauncherOutput);
      });
    }
    if (desktopLauncherInput) {
      desktopLauncherInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          runLauncherCommand(desktopLauncherInput, desktopLauncherOutput);
        }
      });
    }
    if (desktopLauncherClose) {
      desktopLauncherClose.addEventListener("click", closeDesktopLauncher);
    }

    if (mobileLauncherRun) {
      mobileLauncherRun.addEventListener("click", function () {
        runLauncherCommand(mobileLauncherInput, mobileLauncherOutput);
      });
    }
    if (mobileLauncherInput) {
      mobileLauncherInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          runLauncherCommand(mobileLauncherInput, mobileLauncherOutput);
        }
      });
    }
    if (mobileLauncherClose) {
      mobileLauncherClose.addEventListener("click", closeMobileLauncher);
    }

  }

  function applyDarkTheme() {
    document.body.classList.add("dark-theme");
    if (themeToggleBtn && themeToggleBtn.parentNode) {
      themeToggleBtn.parentNode.removeChild(themeToggleBtn);
    }
  }

  applyStoredUiMode();
  setupResourceSearch();
  articleViewController = setupArticleView();
  setupMathCalculator();
  setupAppsWindow();
  setupAppsLoader();
  setupDesktopShell();
  setupDesktopGate();
  setupUpdateFilters();
  setupUpdateAccordionAnimations();
  setupTerminalCommands();
  setupZoomGuards();
  setupCustomContextMenu();

  function scheduleRevealRefresh() {
    if (revealRefreshTimer) {
      window.clearTimeout(revealRefreshTimer);
    }
    revealRefreshTimer = window.setTimeout(function () {
      revealRefreshTimer = null;
      refreshRevealAnimationsForViewport();
    }, 120);
  }

  window.addEventListener("resize", scheduleRevealRefresh);
  window.addEventListener("orientationchange", scheduleRevealRefresh);
  setupScrollAnimations();
  applyStoredWebsiteUpgrade();

  var initialTabId = getInitialTabId();
  if (initialTabId) {
    showTab(initialTabId);
  }
  applyDarkTheme();
  syncAllServerStates();
  watchServerStateDotChanges();
  window.setTimeout(showUpdateReminderIfNeeded, prefersReducedMotion ? 120 : 760);
})();
