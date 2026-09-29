(function () {
  const analytics = document.createElement("script");
  analytics.defer = true;
  analytics.src = "/api/umami";
  document.head.append(analytics);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPagePreview = window.location.search.includes("no-loader");
  if (isPagePreview) return;

  const assetPrefix = window.location.pathname.includes("/pages/") ? "../" : "";
  const loader = document.createElement("div");
  loader.className = "luxia-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.innerHTML = [
    '<div class="luxia-loader-mark" aria-hidden="true">',
    `  <img src="${assetPrefix}assets/luxia-loader-logo.png" alt="">`,
    "</div>",
    '<span class="screen-reader-text">Loading Luxia P&amp;C</span>'
  ].join("");

  document.documentElement.classList.add("is-loading");
  document.body.prepend(loader);

  let hideScheduled = false;

  function hideLoader() {
    if (hideScheduled) return;
    hideScheduled = true;

    const minimumDelay = reduceMotion ? 80 : 520;
    window.setTimeout(() => {
      loader.classList.add("is-leaving");
      document.documentElement.classList.remove("is-loading");
      window.setTimeout(() => loader.remove(), reduceMotion ? 80 : 520);
    }, minimumDelay);
  }

  window.addEventListener("load", hideLoader, { once: true });
  window.setTimeout(hideLoader, 1800);
})();
