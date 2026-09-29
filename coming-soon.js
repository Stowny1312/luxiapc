(() => {
  const launchAt = new Date("2026-10-01T00:00:00+02:00").getTime();
  const elements = {
    days: document.getElementById("days"),
    hours: document.getElementById("hours"),
    minutes: document.getElementById("minutes"),
    seconds: document.getElementById("seconds")
  };
  let timer;

  const pad = (value) => String(value).padStart(2, "0");

  const updateCountdown = () => {
    const remaining = Math.max(0, launchAt - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);

    elements.days.textContent = pad(Math.floor(totalSeconds / 86400));
    elements.hours.textContent = pad(Math.floor((totalSeconds % 86400) / 3600));
    elements.minutes.textContent = pad(Math.floor((totalSeconds % 3600) / 60));
    elements.seconds.textContent = pad(totalSeconds % 60);

    if (remaining === 0) {
      clearInterval(timer);
      document.body.classList.add("is-live");
      document.getElementById("launch-kicker").textContent = "We are live";
      document.getElementById("page-title").textContent = "Welcome to Luxia P&C.";
      document.getElementById("status-text").textContent = "Our official launch day has arrived.";
    }
  };

  updateCountdown();
  timer = setInterval(updateCountdown, 1000);
})();
