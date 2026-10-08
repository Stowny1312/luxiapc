(function () {
  "use strict";
  let meetingState = "idle";
  let sdkReady = false;

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
  }

  function joinMeeting(access) {
    if (meetingState === "joined") return Promise.resolve();
    if (meetingState !== "idle") return Promise.reject(new Error("The Zoom meeting is already opening."));
    if (!sdkReady || !window.ZoomMtg) return Promise.reject(new Error("Zoom could not load the meeting controls."));
    meetingState = "joining";
    window.ZoomMtg.preLoadWasm();
    window.ZoomMtg.prepareWebSDK();
    return new Promise((resolve, reject) => {
      window.ZoomMtg.init({
        leaveUrl: `${window.location.origin}/pages/client-space.html`,
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
            resolve();
          },
          error: (error) => {
            meetingState = "idle";
            reject(new Error((error && error.reason) || "The Zoom meeting could not be joined."));
          }
        }),
        error: (error) => {
          meetingState = "idle";
          reject(new Error((error && error.reason) || "The Zoom meeting could not be initialized."));
        }
      });
    });
  }

  const sdkPromise = loadZoomSdk();
  window.LuxiaZoomRoom = {
    whenReady: () => sdkPromise,
    join: joinMeeting,
    leave: () => window.ZoomMtg && window.ZoomMtg.leaveMeeting({})
  };
})();
