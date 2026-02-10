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
  var pendingIdentify = null;
  var isMobile = window.innerWidth < 640;

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
    var text = (config && config.buttonText) || "Feedback";
    var colors = getThemeColors();

    // Compute border radius — scale theme radius for pill-like button, min 8px
    var radius = THEME.radius;
    var btnRadius = "24px";
    if (radius && radius !== "24px") {
      var parsed = parseFloat(radius);
      if (!isNaN(parsed)) {
        // Convert rem to px (assume 16px base), scale up for button height
        var unit = radius.replace(/[0-9.]+/, "");
        var px = unit === "rem" ? parsed * 16 : parsed;
        btnRadius = Math.max(8, Math.min(24, px * 3)) + "px";
      }
    }

    trigger = createElement("button", {
      position: "fixed",
      bottom: "24px",
      [placement === "left" ? "left" : "right"]: "24px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      height: "48px",
      padding: "0 20px",
      border: "none",
      borderRadius: btnRadius,
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

    // Chat icon SVG
    trigger.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' + '<span>' + text + '</span>';

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
  }

  function hidePanel() {
    if (!isOpen) return;
    isOpen = false;

    if (trigger) {
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
        break;

      case "quackback:close":
        hidePanel();
        break;

      case "quackback:identify-result":
        // Could dispatch to callbacks, but for v1 just log
        break;

      case "quackback:navigate":
        if (msg.url) window.open(msg.url, "_blank");
        break;
    }
  });

  // =========================================================================
  // Command Dispatcher
  // =========================================================================

  function dispatch(command, options) {
    switch (command) {
      case "initialize_feedback_widget":
        config = options || {};
        isMobile = window.innerWidth < 640;
        createTrigger();
        break;

      case "identify":
        if (options === null || options === undefined) {
          // Clear identity
          if (isReady) sendToWidget("quackback:identify", null);
          else pendingIdentify = null;
        } else {
          if (isReady) sendToWidget("quackback:identify", options);
          else pendingIdentify = options;
        }
        break;

      case "open":
        showPanel();
        break;

      case "close":
        hidePanel();
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
        isOpen = false;
        isReady = false;
        break;
    }
  }

  // =========================================================================
  // Initialize: replay queued commands, replace queue function
  // =========================================================================

  var queue = window.Quackback && window.Quackback.q ? window.Quackback.q : [];

  window.Quackback = function() {
    var args = Array.prototype.slice.call(arguments);
    dispatch(args[0], args[1]);
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
