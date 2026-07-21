(function () {
  const config = window.LUXIA_SUPABASE;
  const statusNode = document.querySelector("[data-auth-status]");

  function showStatus(message, type) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.type = type || "info";
    statusNode.hidden = false;
  }

  if (!config || !config.url || !config.publishableKey || !window.supabase) {
    showStatus("Supabase is not configured yet. Please check supabase-config.js.", "error");
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);

  function fullOriginPath(page) {
    const path = window.location.pathname.replace(/pages\/[^/]+$/, `pages/${page}`);
    return `${window.location.origin}${path}`;
  }

  async function refreshClientSummary() {
    const summary = document.querySelector("[data-client-summary]");
    if (!summary) return;

    const { data } = await client.auth.getUser();
    if (!data.user) {
      summary.innerHTML = "<strong>Not signed in yet</strong><span>Create an account or log in to see your bookings.</span>";
      return;
    }

    const name = [
      data.user.user_metadata && data.user.user_metadata.first_name,
      data.user.user_metadata && data.user.user_metadata.last_name
    ].filter(Boolean).join(" ");

    summary.innerHTML = `<strong>${name || "Client space"}</strong><span>${data.user.email}</span><a href="bookings.html">Open bookings</a><button type="button" data-sign-out>Sign out</button>`;
  }

  async function loadBookings() {
    const list = document.querySelector("[data-bookings-list]");
    if (!list) return;

    const { data: userData } = await client.auth.getUser();
    if (!userData.user) {
      list.innerHTML = '<article><strong>Please log in first</strong><span>Your private bookings are visible after login.</span><a href="client-space.html">Go to Client space</a></article>';
      return;
    }

    const { data, error } = await client
      .from("bookings")
      .select("id, session_type, starts_at, ends_at, status, meeting_url, notes")
      .eq("user_id", userData.user.id)
      .order("starts_at", { ascending: false });

    if (error) {
      showStatus(error.message, "error");
      return;
    }

    if (!data || data.length === 0) {
      list.innerHTML = '<article><strong>No bookings yet</strong><span>Once a coaching session is booked, it will appear here with its status and private session link.</span><a href="booking.html">Book coaching</a></article>';
      return;
    }

    const now = new Date();
    list.innerHTML = data.map((booking) => {
      const start = new Date(booking.starts_at);
      const isPast = start < now || booking.status === "completed";
      const when = start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      const link = booking.meeting_url
        ? `<a href="${booking.meeting_url}" target="_blank" rel="noreferrer">Private session link</a>`
        : "<span>Private link appears after confirmation.</span>";

      return `<article class="${isPast ? "past-booking" : "upcoming-booking"}"><small>${isPast ? "Past session" : "Upcoming session"}</small><strong>${booking.session_type}</strong><span>${when}</span><span>Status: ${booking.status}</span>${link}</article>`;
    }).join("");
  }

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.matches("[data-login-form]")) {
      event.preventDefault();
      const formData = new FormData(form);
      const { error } = await client.auth.signInWithPassword({
        email: String(formData.get("email") || ""),
        password: String(formData.get("password") || "")
      });

      if (error) {
        showStatus(error.message, "error");
        return;
      }

      showStatus("You are logged in. Opening your bookings...", "success");
      setTimeout(() => { window.location.href = "bookings.html"; }, 600);
    }

    if (form.matches("[data-signup-form]")) {
      event.preventDefault();
      const formData = new FormData(form);
      const { error } = await client.auth.signUp({
        email: String(formData.get("email") || ""),
        password: String(formData.get("password") || ""),
        options: {
          data: {
            first_name: String(formData.get("first_name") || ""),
            last_name: String(formData.get("last_name") || ""),
            date_of_birth: String(formData.get("date_of_birth") || ""),
            gender: String(formData.get("gender") || "prefer_not_to_say"),
            gender_self_describe: String(formData.get("gender_self_describe") || "")
          }
        }
      });

      if (error) {
        showStatus(error.message, "error");
        return;
      }

      showStatus("Account created. Please check your email if confirmation is enabled, then log in.", "success");
      form.reset();
    }

    if (form.matches("[data-reset-form]")) {
      event.preventDefault();
      const formData = new FormData(form);
      const { error } = await client.auth.resetPasswordForEmail(String(formData.get("email") || ""), {
        redirectTo: fullOriginPath("update-password.html")
      });

      if (error) {
        showStatus(error.message, "error");
        return;
      }

      showStatus("Password recovery email sent. Please check your inbox.", "success");
    }

    if (form.matches("[data-update-password-form]")) {
      event.preventDefault();
      const formData = new FormData(form);
      const password = String(formData.get("password") || "");
      const confirm = String(formData.get("confirm_password") || "");

      if (password !== confirm) {
        showStatus("The two passwords do not match.", "error");
        return;
      }

      const { error } = await client.auth.updateUser({ password });

      if (error) {
        showStatus(error.message, "error");
        return;
      }

      showStatus("Password updated. You can now log in.", "success");
      setTimeout(() => { window.location.href = "client-space.html"; }, 900);
    }
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-sign-out]")) return;

    await client.auth.signOut();
    showStatus("You have been signed out.", "success");
    refreshClientSummary();
  });

  refreshClientSummary();
  loadBookings();
})();
