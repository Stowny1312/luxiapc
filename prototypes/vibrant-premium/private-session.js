(function () {
  "use strict";
  const statusNode = document.querySelector("[data-session-status]");
  const loginLink = document.querySelector("[data-session-login]");
  const meetingShell = document.querySelector("[data-meeting-shell]");
  const roomNote = document.querySelector("[data-room-note]");
  const bookingId = new URLSearchParams(window.location.search).get("booking");
  const config = window.LUXIA_SUPABASE;
  const client = window.LUXIA_SUPABASE_CLIENT || (config && window.supabase ? window.supabase.createClient(config.url, config.publishableKey) : null);

  function setStatus(message, type) {
    statusNode.textContent = message;
    statusNode.dataset.type = type || "info";
    statusNode.hidden = false;
  }

  function loadStyleOnce(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (window.ZoomMtg) return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("The Zoom client could not be loaded."));
      document.body.appendChild(script);
    });
  }

  async function initializeZoomMeeting(access) {
    loadStyleOnce("https://source.zoom.us/6.2.0/css/bootstrap.css");
    loadStyleOnce("https://source.zoom.us/6.2.0/css/react-select.css");
    await loadScriptOnce("https://source.zoom.us/6.2.0/lib/vendor/react.min.js");
    await loadScriptOnce("https://source.zoom.us/6.2.0/lib/vendor/react-dom.min.js");
    await loadScriptOnce("https://source.zoom.us/6.2.0/lib/vendor/redux.min.js");
    await loadScriptOnce("https://source.zoom.us/6.2.0/lib/vendor/redux-thunk.min.js");
    await loadScriptOnce("https://source.zoom.us/6.2.0/lib/vendor/lodash.min.js");
    await loadScriptOnce("https://source.zoom.us/zoom-meeting-6.2.0.min.js");
    return new Promise((resolve, reject) => {
      if (!window.ZoomMtg) return reject(new Error("The video room could not be loaded. Please refresh the page."));
      document.body.classList.add("zoom-client-view");
      window.ZoomMtg.preLoadWasm();
      window.ZoomMtg.prepareWebSDK();
      window.ZoomMtg.init({
        leaveUrl: `${window.location.origin}/pages/client-space.html`,
        patchJsMedia: true,
        leaveOnPageUnload: true,
        defaultView: "speaker",
        isLockBottom: true,
        success: () => window.ZoomMtg.join({
          signature: access.signature,
          meetingNumber: access.meetingNumber,
          passWord: access.password,
          userName: access.userName,
          zak: access.zak || "",
          success: resolve,
          error: (error) => reject(new Error((error && error.reason) || "The meeting could not be joined."))
        }),
        error: (error) => reject(new Error((error && error.reason) || "The meeting could not be opened."))
      });
    });
  }

  async function initializeSession() {
    if (!client || !bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return setStatus("This private session link is invalid.", "error");
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (!session) {
      const destination = `${window.location.pathname.split("/").pop()}${window.location.search}`;
      loginLink.href = `client-space.html?next=${encodeURIComponent(destination)}`;
      loginLink.hidden = false;
      setStatus("Please log in with the account connected to this booking.", "error");
      return;
    }
    try {
      const response = await fetch("/api/zoom-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId })
      });
      const access = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(access.error || "This private session is unavailable.");
      setStatus("Opening the secure video room...", "info");
      meetingShell.hidden = false;
      document.body.classList.toggle("is-session-owner", Boolean(access.isOwner));
      document.body.classList.toggle("is-session-client", !access.isOwner);
      if (roomNote) roomNote.textContent = "The room is open during the reserved time. Either participant may enter first.";
      await initializeZoomMeeting(access);
      document.body.classList.add("session-connected");
      statusNode.hidden = true;
      const endDelay = new Date(access.endsAt).getTime() - Date.now();
      if (endDelay > 0) window.setTimeout(() => {
        window.location.replace(`${window.location.origin}/pages/client-space.html`);
      }, Math.min(endDelay, 2147483647));
    } catch (error) {
      document.body.classList.remove("zoom-client-view", "session-connected");
      meetingShell.hidden = true;
      setStatus(error.message || "This private session is unavailable.", "error");
    }
  }

  initializeSession();
})();
