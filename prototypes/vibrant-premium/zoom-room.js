(function () {
  "use strict";
  const parentOrigin = window.location.origin;
  let meetingState = "idle";

  function notify(type, message) {
    window.parent.postMessage({ type, message }, parentOrigin);
  }

  function joinMeeting(access) {
    if (meetingState !== "idle") return;
    if (!window.ZoomMtg) return notify("luxia-zoom-error", "Zoom could not load the meeting controls.");
    meetingState = "joining";
    window.ZoomMtg.preLoadWasm();
    window.ZoomMtg.prepareWebSDK();
    window.ZoomMtg.init({
      leaveUrl: `${parentOrigin}/pages/client-space.html`,
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
        success: () => {
          meetingState = "joined";
          notify("luxia-zoom-joined");
        },
        error: (error) => {
          meetingState = "idle";
          notify("luxia-zoom-error", (error && error.reason) || "The Zoom meeting could not be joined.");
        }
      }),
      error: (error) => {
        meetingState = "idle";
        notify("luxia-zoom-error", (error && error.reason) || "The Zoom meeting could not be initialized.");
      }
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
