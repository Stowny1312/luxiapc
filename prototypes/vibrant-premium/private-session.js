(function () {
  "use strict";
  const statusNode = document.querySelector("[data-session-status]");
  const loginLink = document.querySelector("[data-session-login]");
  const meetingShell = document.querySelector("[data-meeting-shell]");
  const meetingRoot = document.getElementById("meetingSDKElement");
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
      if (!window.ZoomMtgEmbedded) throw new Error("The secure video room could not be loaded. Please refresh the page.");
      setStatus("Opening the secure video room...", "info");
      meetingShell.hidden = false;
      const zoomClient = window.ZoomMtgEmbedded.createClient();
      await zoomClient.init({ zoomAppRoot: meetingRoot, language: "en-US", patchJsMedia: true, leaveOnPageUnload: true });
      const joinOptions = { signature: access.signature, meetingNumber: access.meetingNumber, password: access.password, userName: access.userName };
      if (access.zak) joinOptions.zak = access.zak;
      await zoomClient.join(joinOptions);
      statusNode.hidden = true;
      leaveAtSessionEnd(zoomClient, access.endsAt);
    } catch (error) {
      meetingShell.hidden = true;
      setStatus(error.message || "This private session is unavailable.", "error");
    }
  }

  initializeSession();
})();
