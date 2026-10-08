(function () {
  "use strict";
  const parentOrigin = window.location.origin;
  let meetingState = "idle";
  let sdkReady = false;

  function notify(type, message) {
    window.parent.postMessage({ type, message }, parentOrigin);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Zoom dependency could not load: ${src.split("/").pop()}`));
      document.body.appendChild(script);
    });
  }

  async function loadZoomSdk() {
    const dependencies = [
      "https://source.zoom.us/6.2.0/lib/vendor/react.min.js",
      "https://source.zoom.us/6.2.0/lib/vendor/react-dom.min.js",
      "https://source.zoom.us/6.2.0/lib/vendor/redux.min.js",
      "https://source.zoom.us/6.2.0/lib/vendor/redux-thunk.min.js",
      "https://source.zoom.us/6.2.0/lib/vendor/lodash.min.js",
      "https://source.zoom.us/zoom-meeting-6.2.0.min.js"
    ];
    for (const dependency of dependencies) await loadScript(dependency);
    if (!window.ZoomMtg) throw new Error("Zoom loaded without meeting controls.");
    sdkReady = true;
    notify("luxia-zoom-ready");
  }

  function joinMeeting(access) {
    if (meetingState !== "idle") return;
    if (!sdkReady || !window.ZoomMtg) return notify("luxia-zoom-error", "Zoom could not load the meeting controls.");
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
    if (event.data.type === "luxia-zoom-ping" && sdkReady) notify("luxia-zoom-ready");
    if (event.data.type === "luxia-zoom-join") joinMeeting(event.data.access);
    if (event.data.type === "luxia-zoom-leave" && window.ZoomMtg) window.ZoomMtg.leaveMeeting({});
  });
  loadZoomSdk().catch((error) => notify("luxia-zoom-error", error.message || "Zoom dependencies could not be loaded."));
})();
