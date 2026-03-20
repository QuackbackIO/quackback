/**
 * Widget SDK template
 *
 * Generates a vanilla JS SDK (~10KB) that:
 * - Replays the command queue from the inline snippet
 * - Creates and manages the trigger button + iframe panel
 * - Handles identify via postMessage to iframe
 * - Supports floating (popover) mode
 *
 * The SDK is generated as a string and served by the /api/widget/sdk.js route.
 */

export interface WidgetTheme {
  lightPrimary?: string
  lightPrimaryForeground?: string
  darkPrimary?: string
  darkPrimaryForeground?: string
  radius?: string
  themeMode?: 'light' | 'dark' | 'user'
}

export function buildWidgetSDK(baseUrl: string, theme?: WidgetTheme): string {
  const t = theme ?? {}

  // The SDK is an IIFE that self-initializes
  return `(function() {
  "use strict";

  var BASE_URL = ${JSON.stringify(baseUrl)};
  var THEME = ${JSON.stringify({
    lightPrimary: t.lightPrimary ?? '#6366f1',
    lightPrimaryFg: t.lightPrimaryForeground ?? '#ffffff',
    darkPrimary: t.darkPrimary ?? t.lightPrimary ?? '#6366f1',
    darkPrimaryFg: t.darkPrimaryForeground ?? t.lightPrimaryForeground ?? '#ffffff',
    radius: t.radius ?? '24px',
    themeMode: t.themeMode ?? 'user',
  })};
  var WIDGET_URL = BASE_URL + "/widget";

  // State
  var config = null;
  var iframe = null;
  var trigger = null;
  var backdrop = null;
  var panel = null;
  var isOpen = false;
  var isReady = false;
  var isIdentified = false;
  var pendingIdentify = null;
  var metadata = null;
  var listeners = {};
  var pendingOpen = null;
  var isMobile = window.innerWidth < 640;

  // =========================================================================
  // Event System
  // =========================================================================

  function emit(name, payload) {
    var fns = listeners[name];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch(e) {}
    }
  }

  // =========================================================================
  // DOM Helpers
  // =========================================================================

  function createElement(tag, styles, attrs) {
    var el = document.createElement(tag);
    if (styles) Object.assign(el.style, styles);
    if (attrs) {
      for (var k in attrs) {
        if (k === "className") el.className = attrs[k];
        else el.setAttribute(k, attrs[k]);
      }
    }
    return el;
  }

  // =========================================================================
  // Trigger Button
  // =========================================================================

  function isDarkMode() {
    if (THEME.themeMode === "light") return false;
    if (THEME.themeMode === "dark") return true;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function getThemeColors() {
    var dark = isDarkMode();
    var customColor = config && config.buttonColor;
    return {
      bg: customColor || (dark ? THEME.darkPrimary : THEME.lightPrimary),
      fg: dark ? THEME.darkPrimaryFg : THEME.lightPrimaryFg,
    };
  }

  function applyTriggerColors() {
    if (!trigger) return;
    var colors = getThemeColors();
    trigger.style.backgroundColor = colors.bg;
    trigger.style.color = colors.fg;
  }

  function createTrigger() {
    var placement = (config && config.placement) || "right";
    var colors = getThemeColors();

    trigger = createElement("button", {
      position: "fixed",
      bottom: "24px",
      [placement === "left" ? "left" : "right"]: "24px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "48px",
      height: "48px",
      padding: "0",
      border: "none",
      borderRadius: "50%",
      backgroundColor: colors.bg,
      color: colors.fg,
      fontSize: "14px",
      fontWeight: "600",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      cursor: "pointer",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      transition: "transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease",
    }, {
      "aria-label": "Open feedback widget",
      "aria-expanded": "false",
    });

    // Chat bubbles icon (Heroicons solid)
    trigger.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>';

    trigger.addEventListener("mouseenter", function() {
      trigger.style.transform = "translateY(-2px)";
      trigger.style.boxShadow = "0 6px 20px rgba(0,0,0,0.2)";
    });
    trigger.addEventListener("mouseleave", function() {
      trigger.style.transform = "translateY(0)";
      trigger.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    });
    trigger.addEventListener("click", function() { dispatch("open"); });

    // Listen for color scheme changes to update button colors
    if (THEME.themeMode === "user" && window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTriggerColors);
    }

    document.body.appendChild(trigger);
  }

  // =========================================================================
  // Panel + Iframe
  // =========================================================================

  function createPanel() {
    if (panel) return;

    var placement = (config && config.placement) || "right";
    var boardParam = config && config.defaultBoard ? "?board=" + encodeURIComponent(config.defaultBoard) : "";
    var iframeUrl = WIDGET_URL + boardParam;

    // Backdrop (mobile only)
    backdrop = createElement("div", {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      backgroundColor: "rgba(0,0,0,0.4)",
      opacity: "0",
      transition: "opacity 200ms ease",
      display: "none",
    });
    backdrop.addEventListener("click", function() { dispatch("close"); });
    document.body.appendChild(backdrop);

    // Panel container
    if (isMobile) {
      panel = createElement("div", {
        position: "fixed",
        bottom: "0",
        left: "0",
        right: "0",
        zIndex: "2147483647",
        height: "calc(100vh - 40px)",
        borderRadius: "16px 16px 0 0",
        overflow: "hidden",
        boxShadow: "0 -8px 30px rgba(0,0,0,0.12)",
        transform: "translateY(100%)",
        transition: "transform 300ms cubic-bezier(0.4,0,0.2,1)",
      });
    } else {
      panel = createElement("div", {
        position: "fixed",
        bottom: "24px",
        [placement === "left" ? "left" : "right"]: "24px",
        zIndex: "2147483647",
        width: "400px",
        height: "min(600px, calc(100vh - 100px))",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        display: "none",
        opacity: "0",
        transform: "scale(0.95)",
        transformOrigin: placement === "left" ? "bottom left" : "bottom right",
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
      });
    }

    // Iframe
    iframe = createElement("iframe", {
      width: "100%",
      height: "100%",
      border: "none",
      colorScheme: "normal",
    }, {
      src: iframeUrl,
      title: "Feedback Widget",
      sandbox: "allow-scripts allow-forms allow-same-origin allow-popups",
    });

    panel.appendChild(iframe);
    document.body.appendChild(panel);
  }

  function showPanel() {
    if (!panel) createPanel();
    if (isOpen) return;
    isOpen = true;

    if (trigger) {
      trigger.style.display = "none";
      trigger.setAttribute("aria-expanded", "true");
    }

    if (isMobile) {
      backdrop.style.display = "block";
      // Force reflow
      void backdrop.offsetHeight;
      backdrop.style.opacity = "1";
      panel.style.transform = "translateY(0)";
    } else {
      panel.style.display = "block";
      // Force reflow
      void panel.offsetHeight;
      panel.style.opacity = "1";
      panel.style.transform = "scale(1)";
    }

    emit("open", {});
  }

  function hidePanel() {
    if (!isOpen) return;
    isOpen = false;

    if (trigger && isIdentified && !(config && config.trigger === false)) {
      trigger.style.display = "flex";
      trigger.setAttribute("aria-expanded", "false");
    }

    if (isMobile) {
      backdrop.style.opacity = "0";
      panel.style.transform = "translateY(100%)";
      setTimeout(function() { backdrop.style.display = "none"; }, 200);
    } else {
      panel.style.opacity = "0";
      panel.style.transform = "scale(0.95)";
      setTimeout(function() { if (!isOpen && panel) panel.style.display = "none"; }, 200);
    }

    emit("close", {});
  }

  // =========================================================================
  // PostMessage
  // =========================================================================

  function sendToWidget(type, data) {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: type, data: data }, BASE_URL);
    }
  }

  window.addEventListener("message", function(event) {
    // Only accept messages from widget origin
    if (event.origin !== BASE_URL) return;
    var msg = event.data;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "quackback:ready":
        isReady = true;
        // Replay any pending identify
        if (pendingIdentify !== null) {
          sendToWidget("quackback:identify", pendingIdentify);
          pendingIdentify = null;
        }
        if (metadata) sendToWidget("quackback:metadata", metadata);
        if (pendingOpen) {
          sendToWidget("quackback:open", pendingOpen);
          pendingOpen = null;
        }
        emit("ready", {});
        break;

      case "quackback:close":
        hidePanel();
        break;

      case "quackback:identify-result":
        emit("identify", {
          success: msg.success,
          user: msg.user || null,
          anonymous: msg.success && !msg.user,
          error: msg.error,
        });
        break;

      case "quackback:event":
        if (msg.name) emit(msg.name, msg.payload || {});
        break;

      case "quackback:navigate":
        if (msg.url) window.open(msg.url, "_blank");
        break;
    }
  });

  // =========================================================================
  // Command Dispatcher
  // =========================================================================

  function dispatch(command, options, extra) {
    switch (command) {
      case "init":
        config = options || {};
        isMobile = window.innerWidth < 640;
        break;

      case "identify":
        if (options === null || options === undefined) {
          // Clear identity — close panel and hide trigger
          isIdentified = false;
          hidePanel();
          if (trigger) trigger.style.display = "none";
          if (isReady) sendToWidget("quackback:identify", null);
          else pendingIdentify = null;
        } else {
          // Show trigger on first identify
          if (!isIdentified) {
            isIdentified = true;
            if (!(config && config.trigger === false)) {
              if (!trigger) createTrigger();
              else trigger.style.display = "flex";
            }
          }
          // Eagerly create the iframe so it loads, hydrates, and completes
          // the identify round-trip in the background — before the user opens
          // the panel. This eliminates the visible delay on vote highlights.
          if (!panel) createPanel();
          if (isReady) sendToWidget("quackback:identify", options);
          else pendingIdentify = options;
        }
        break;

      case "open":
        if (options && typeof options === "object") {
          if (isReady) sendToWidget("quackback:open", options);
          else pendingOpen = options;
        }
        showPanel();
        break;

      case "close":
        hidePanel();
        break;

      case "on":
        var onName = options;
        var onHandler = extra;
        if (typeof onName === "string" && typeof onHandler === "function") {
          if (!listeners[onName]) listeners[onName] = [];
          listeners[onName].push(onHandler);
          return function() {
            listeners[onName] = listeners[onName].filter(function(h) { return h !== onHandler; });
          };
        }
        break;

      case "off":
        var offName = options;
        var offHandler = extra;
        if (offHandler) {
          listeners[offName] = (listeners[offName] || []).filter(function(h) { return h !== offHandler; });
        } else {
          delete listeners[offName];
        }
        break;

      case "metadata":
        if (options && typeof options === "object") {
          if (!metadata) metadata = {};
          for (var k in options) {
            if (options[k] === null) delete metadata[k];
            else metadata[k] = String(options[k]);
          }
          if (isReady) sendToWidget("quackback:metadata", metadata);
        }
        break;

      case "destroy":
        hidePanel();
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (trigger && trigger.parentNode) trigger.parentNode.removeChild(trigger);
        panel = null;
        iframe = null;
        trigger = null;
        backdrop = null;
        config = null;
        metadata = null;
        listeners = {};
        isOpen = false;
        isReady = false;
        isIdentified = false;
        pendingOpen = null;
        break;
    }
  }

  // =========================================================================
  // Initialize: replay queued commands, replace queue function
  // =========================================================================

  var queue = window.Quackback && window.Quackback.q ? window.Quackback.q : [];

  window.Quackback = function() {
    var args = Array.prototype.slice.call(arguments);
    return dispatch(args[0], args[1], args[2]);
  };

  // Replay queued commands
  for (var i = 0; i < queue.length; i++) {
    dispatch(queue[i][0], queue[i][1]);
  }

  // Listen for responsive changes
  window.addEventListener("resize", function() {
    isMobile = window.innerWidth < 640;
  });
})();`
}
