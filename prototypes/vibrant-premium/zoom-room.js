(function () {
  "use strict";
  const parentOrigin = window.location.origin;

  function notify(type, message) {
    window.parent.postMessage({ type, message }, parentOrigin);
  }

  function joinMeeting(access) {
    if (!window.ZoomMtg) return notify("luxia-zoom-error", "Zoom could not load the meeting controls.");
    window.ZoomMtg.preLoadWasm();
    window.ZoomMtg.prepareWebSDK();
    window.ZoomMtg.init({
      leaveUrl: `${parentOrigin}/prototypes/vibrant-premium/pages/client-space.html`,
      patchJsMedia: true,
      leaveOnPageUnload: true,
      defaultView: "speaker",
      isLockBottom: true,
      disableJoinAudio: false,
      isSupportAV: true,
      success: () => window.ZoomMtg.join({
        signature: access.signature,
        meetingNumber: access.meetingNumber,
        passWord: access.password,
        userName: access.userName,
        zak: access.zak || "",
        success: () => notify("luxia-zoom-joined"),
        error: (error) => notify("luxia-zoom-error", (error && error.reason) || "The Zoom meeting could not be joined.")
      }),
      error: (error) => notify("luxia-zoom-error", (error && error.reason) || "The Zoom meeting could not be initialized.")
    });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== parentOrigin || event.source !== window.parent || !event.data) return;
    if (event.data.type === "luxia-zoom-ping") notify("luxia-zoom-ready");
    if (event.data.type === "luxia-zoom-join") joinMeeting(event.data.access);
    if (event.data.type === "luxia-zoom-leave" && window.ZoomMtg) window.ZoomMtg.leaveMeeting({});
  });
  notify("luxia-zoom-ready");
})();
