(function () {
  "use strict";
  const statusNode = document.querySelector("[data-session-status]");
  const loginLink = document.querySelector("[data-session-login]");
  const meetingShell = document.querySelector("[data-meeting-shell]");
  const meetingRoot = document.getElementById("meetingSDKElement");
  const roomNote = document.querySelector("[data-room-note]");
  const bookingId = new URLSearchParams(window.location.search).get("booking");
  const config = window.LUXIA_SUPABASE;
  const client = window.LUXIA_SUPABASE_CLIENT || (config && window.supabase ? window.supabase.createClient(config.url, config.publishableKey) : null);

  function setStatus(message, type) {
    statusNode.textContent = message;
    statusNode.dataset.type = type || "info";
    statusNode.hidden = false;
  }

  function leaveAtSessionEnd(zoomClient, endsAt) {
    const delay = new Date(endsAt).getTime() - Date.now();
    if (delay <= 0) return;
    window.setTimeout(async () => {
      try { await zoomClient.leaveMeeting(); } catch (error) { /* The meeting may already be closed. */ }
      meetingShell.hidden = true;
      setStatus("This private session has ended and the link has expired.", "error");
    }, Math.min(delay, 2147483647));
  }

  function isMobileMeeting() {
    return window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
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
      script.onerror = () => reject(new Error("The mobile Zoom client could not be loaded."));
      document.body.appendChild(script);
    });
  }

  async function initializeMobileMeeting(access) {
    loadStyleOnce("https://source.zoom.us/6.2.0/css/bootstrap.css");
    loadStyleOnce("https://source.zoom.us/6.2.0/css/react-select.css");
    await loadScriptOnce("https://source.zoom.us/zoom-meeting-6.2.0.min.js");
    return new Promise((resolve, reject) => {
      if (!window.ZoomMtg) return reject(new Error("The mobile video room could not be loaded. Please refresh the page."));
      document.body.classList.add("zoom-client-view");
      window.ZoomMtg.preLoadWasm();
      window.ZoomMtg.prepareWebSDK();
      window.ZoomMtg.init({
        leaveUrl: `${window.location.origin}/prototypes/vibrant-premium/pages/client-space.html`,
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
          error: (error) => reject(new Error((error && error.reason) || "The mobile meeting could not be joined."))
        }),
        error: (error) => reject(new Error((error && error.reason) || "The mobile meeting could not be opened."))
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
      if (isMobileMeeting()) {
        await initializeMobileMeeting(access);
        document.body.classList.add("session-connected");
        statusNode.hidden = true;
        const mobileEndDelay = new Date(access.endsAt).getTime() - Date.now();
        if (mobileEndDelay > 0) window.setTimeout(() => {
          window.location.replace(`${window.location.origin}/prototypes/vibrant-premium/pages/client-space.html`);
        }, Math.min(mobileEndDelay, 2147483647));
        return;
      }
      if (!window.ZoomMtgEmbedded) throw new Error("The secure video room could not be loaded. Please refresh the page.");
      const pageGutter = 48;
      const availableWidth = Math.max(720, Math.min(1180, document.documentElement.clientWidth - pageGutter));
      const stageHeight = Math.max(600, Math.min(720, Math.round(availableWidth * 0.61)));
      meetingRoot.style.width = `${availableWidth}px`;
      meetingRoot.style.height = `${stageHeight}px`;
      meetingShell.style.setProperty("--meeting-width", `${availableWidth}px`);
      meetingShell.style.setProperty("--meeting-height", `${stageHeight}px`);
      const zoomClient = window.ZoomMtgEmbedded.createClient();
      await zoomClient.init({
        zoomAppRoot: meetingRoot,
        language: "en-US",
        patchJsMedia: true,
        leaveOnPageUnload: true,
        customize: {
          video: {
            defaultViewType: "speaker",
            isResizable: false,
            viewSizes: {
              default: { width: availableWidth, height: stageHeight },
              ribbon: { width: 260, height: 292 }
            }
          }
        }
      });
      const joinOptions = { signature: access.signature, meetingNumber: access.meetingNumber, password: access.password, userName: access.userName };
      if (access.zak) joinOptions.zak = access.zak;
      await zoomClient.join(joinOptions);
      try { await zoomClient.setViewType("speaker"); } catch (error) { /* Speaker view is already selected at init. */ }
      document.body.classList.add("session-connected");
      statusNode.hidden = true;
      leaveAtSessionEnd(zoomClient, access.endsAt);
    } catch (error) {
      meetingShell.hidden = true;
      setStatus(error.message || "This private session is unavailable.", "error");
    }
  }

  initializeSession();
})();
