(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPagePreview = window.location.search.includes("no-loader");
  if (isPagePreview) return;

  const loader = document.createElement("div");
  loader.className = "luxia-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.innerHTML = [
    '<div class="luxia-loader-mark" aria-hidden="true">',
    '  <span class="loader-orbit loader-orbit-one"></span>',
    '  <span class="loader-orbit loader-orbit-two"></span>',
    '  <span class="loader-orbit loader-orbit-three"></span>',
    '  <strong>Luxia P&amp;C</strong>',
    '  <small>Prevention &amp; Coaching</small>',
    "</div>",
    '<span class="screen-reader-text">Loading Luxia P&amp;C</span>'
  ].join("");

  document.documentElement.classList.add("is-loading");
  document.body.prepend(loader);

  function hideLoader() {
    const minimumDelay = reduceMotion ? 80 : 520;
    window.setTimeout(() => {
      loader.classList.add("is-leaving");
      document.documentElement.classList.remove("is-loading");
      window.setTimeout(() => loader.remove(), reduceMotion ? 80 : 520);
    }, minimumDelay);
  }

  window.addEventListener("load", hideLoader, { once: true });
  window.setTimeout(hideLoader, 1800);

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self") return;

    const destination = new URL(link.getAttribute("href"), window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.hash) return;

    event.preventDefault();
    document.body.append(loader);
    loader.classList.remove("is-leaving");
    loader.classList.add("is-entering");
    document.documentElement.classList.add("is-loading");
    window.setTimeout(() => {
      window.location.href = destination.href;
    }, reduceMotion ? 80 : 260);
  });
})();
