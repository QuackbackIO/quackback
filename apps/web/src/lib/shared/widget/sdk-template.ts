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

  // Icon SVGs
  var CHAT_ICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>';
  var CLOSE_ICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
  var iconChat = null;
  var iconClose = null;
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

    // Stacked icons — both rendered, toggled via opacity + rotation
    var iconWrapper = createElement("div", {
      position: "relative",
      display: "flex",
      width: "28px",
      height: "28px",
      flexShrink: "0",
    });

    var iconTransition = "opacity 220ms cubic-bezier(0.34,1.56,0.64,1), transform 220ms cubic-bezier(0.34,1.56,0.64,1)";

    iconChat = createElement("span", {
      position: "absolute",
      top: "0",
      left: "0",
      display: "flex",
      opacity: "1",
      transform: "rotate(0deg)",
      transition: iconTransition,
    });
    iconChat.innerHTML = CHAT_ICON;

    iconClose = createElement("span", {
      position: "absolute",
      top: "0",
      left: "0",
      display: "flex",
      opacity: "0",
      transform: "rotate(-90deg)",
      transition: iconTransition,
    });
    iconClose.innerHTML = CLOSE_ICON;

    iconWrapper.appendChild(iconChat);
    iconWrapper.appendChild(iconClose);
    trigger.appendChild(iconWrapper);

    trigger.addEventListener("mouseenter", function() {
      trigger.style.transform = "translateY(-2px)";
      trigger.style.boxShadow = "0 6px 20px rgba(0,0,0,0.2)";
    });
    trigger.addEventListener("mouseleave", function() {
      trigger.style.transform = "translateY(0)";
      trigger.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    });
    trigger.addEventListener("click", function() { if (isOpen) dispatch("close"); else dispatch("open"); });

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
    var boardParam = config && config.defaultBoard ? "board=" + encodeURIComponent(config.defaultBoard) : "";
    var closeParam = config && config.trigger === false ? "showClose=1" : "";
    var localeParam = config && config.locale ? "locale=" + encodeURIComponent(config.locale) : "";
    var queryParts = [boardParam, closeParam, localeParam].filter(Boolean);
    var iframeUrl = WIDGET_URL + (queryParts.length ? "?" + queryParts.join("&") : "");
    var side = placement === "left" ? "left" : "right";

    // Inject responsive styles once
    if (!document.getElementById("quackback-widget-styles")) {
      var styleEl = document.createElement("style");
      styleEl.id = "quackback-widget-styles";
      styleEl.textContent = [
        // Desktop: popover anchored to trigger button
        ".quackback-panel{position:fixed;z-index:2147483647;overflow:hidden;pointer-events:none;",
        "bottom:88px;" + side + ":24px;width:400px;height:min(600px,calc(100vh - 108px));",
        "border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);",
        "opacity:0;transform:scale(0);transform-origin:bottom " + side + ";",
        "transition:opacity 280ms cubic-bezier(0.34,1.56,0.64,1),transform 280ms cubic-bezier(0.34,1.56,0.64,1)}",
        // Desktop open state
        ".quackback-panel.quackback-open{opacity:1;transform:scale(1);pointer-events:auto}",
        // Desktop close transition (applied briefly)
        ".quackback-panel.quackback-closing{opacity:0;transform:scale(0);pointer-events:none;",
        "transition:opacity 200ms cubic-bezier(0.4,0,1,1),transform 200ms cubic-bezier(0.4,0,1,1)}",
        // Mobile: full-screen overlay
        "@media(max-width:639px){",
        ".quackback-panel{top:0;left:0;right:0;bottom:0;width:100%;height:100vh;",
        "border-radius:0;box-shadow:none;",
        "opacity:1;transform:translateY(100%);transform-origin:center;",
        "transition:transform 300ms cubic-bezier(0.4,0,0.2,1)}",
        ".quackback-panel.quackback-open{transform:translateY(0)}",
        ".quackback-panel.quackback-closing{transform:translateY(100%);transition:transform 200ms cubic-bezier(0.4,0,1,1)}}",
        // Backdrop
        ".quackback-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.4);",
        "opacity:0;pointer-events:none;transition:opacity 200ms ease}",
        ".quackback-backdrop.quackback-open{opacity:1;pointer-events:auto}",
        "@media(min-width:640px){.quackback-backdrop{display:none!important}}",
      ].join("");
      document.head.appendChild(styleEl);
    }

    // Backdrop
    backdrop = document.createElement("div");
    backdrop.className = "quackback-backdrop";
    backdrop.addEventListener("click", function() { dispatch("close"); });
    document.body.appendChild(backdrop);

    // Panel
    panel = document.createElement("div");
    panel.className = "quackback-panel quackback-widget-iframe-wrapper";
    document.body.appendChild(panel);

    // Iframe
    iframe = createElement("iframe", {
      width: "100%",
      height: "100%",
      border: "none",
      colorScheme: "normal",
    }, {
      src: iframeUrl,
      title: "Feedback Widget",
      sandbox: "allow-scripts allow-forms allow-same-origin allow-popups allow-downloads",
      allow: "clipboard-write",
      className: "quackback-widget-iframe",
    });

    panel.appendChild(iframe);
  }

  function showPanel() {
    if (!panel) createPanel();
    if (isOpen) return;
    isOpen = true;
    isMobile = window.innerWidth < 640;

    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
      if (isMobile) {
        trigger.style.display = "none";
      } else {
        trigger.setAttribute("aria-label", "Close feedback widget");
        if (iconChat && iconClose) {
          iconChat.style.opacity = "0";
          iconChat.style.transform = "rotate(90deg)";
          iconClose.style.opacity = "1";
          iconClose.style.transform = "rotate(0deg)";
        }
      }
    }

    panel.classList.remove("quackback-closing");
    if (backdrop) backdrop.classList.remove("quackback-closing");
    // Force reflow so the browser registers the base state before transitioning
    void panel.offsetHeight;
    panel.classList.add("quackback-open");
    if (backdrop) backdrop.classList.add("quackback-open");

    emit("open", {});
  }

  function hidePanel() {
    if (!isOpen) return;
    isOpen = false;
    isMobile = window.innerWidth < 640;

    if (trigger && isIdentified && !(config && config.trigger === false)) {
      trigger.setAttribute("aria-expanded", "false");
      trigger.style.display = "flex";
      if (!isMobile) {
        trigger.setAttribute("aria-label", "Open feedback widget");
        if (iconChat && iconClose) {
          iconChat.style.opacity = "1";
          iconChat.style.transform = "rotate(0deg)";
          iconClose.style.opacity = "0";
          iconClose.style.transform = "rotate(-90deg)";
        }
      }
    }

    panel.classList.remove("quackback-open");
    panel.classList.add("quackback-closing");
    if (backdrop) {
      backdrop.classList.remove("quackback-open");
      backdrop.classList.add("quackback-closing");
    }
    setTimeout(function() {
      if (!isOpen && panel) panel.classList.remove("quackback-closing");
      if (!isOpen && backdrop) backdrop.classList.remove("quackback-closing");
    }, 300);

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
        // Tell the widget whether the parent viewport is mobile-sized
        sendToWidget("quackback:mobile", isMobile);
        // Replay any pending identify
        if (pendingIdentify !== null) {
          sendToWidget("quackback:identify", pendingIdentify);
          pendingIdentify = null;
        }
        if (config && config.locale) sendToWidget("quackback:locale", config.locale);
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
        // No-args / empty object → anonymous; otherwise { id, email, ... } or { ssoToken }
        var identifyPayload = options || { anonymous: true };
        if (!isIdentified) {
          isIdentified = true;
          if (!(config && config.trigger === false)) {
            if (!trigger) createTrigger();
            else trigger.style.display = "flex";
          }
        }
        // Eagerly create the iframe so identify completes in the background
        // before the user opens the panel.
        if (!panel) createPanel();
        if (isReady) sendToWidget("quackback:identify", identifyPayload);
        else pendingIdentify = identifyPayload;
        break;

      case "logout":
        isIdentified = false;
        hidePanel();
        if (trigger) trigger.style.display = "none";
        if (isReady) sendToWidget("quackback:identify", null);
        else pendingIdentify = null;
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
        var styleTag = document.getElementById("quackback-widget-styles");
        if (styleTag && styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
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
    dispatch(queue[i][0], queue[i][1], queue[i][2]);
  }

  // Keep isMobile in sync and notify the widget iframe on change
  window.addEventListener("resize", function() {
    var wasMobile = isMobile;
    isMobile = window.innerWidth < 640;
    if (wasMobile !== isMobile) {
      // Notify widget so it can show/hide the close button
      if (isReady) sendToWidget("quackback:mobile", isMobile);
      // Show/hide trigger when crossing the breakpoint while panel is open
      if (isOpen && trigger) {
        if (isMobile) {
          trigger.style.display = "none";
        } else {
          trigger.style.display = "flex";
          trigger.setAttribute("aria-label", "Close feedback widget");
          if (iconChat && iconClose) {
            iconChat.style.opacity = "0";
            iconChat.style.transform = "rotate(90deg)";
            iconClose.style.opacity = "1";
            iconClose.style.transform = "rotate(0deg)";
          }
        }
      }
    }
  });
})();`
}
