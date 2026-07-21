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

  async function getCurrentUser() {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return null;

    const { data } = await client.auth.getUser();
    return data.user || sessionData.session.user || null;
  }

  async function refreshHeaderClientLinks() {
    const user = await getCurrentUser();
    const loginLinks = document.querySelectorAll(".login-link");
    const createLinks = document.querySelectorAll(".create-link");
    const userMenus = document.querySelectorAll("[data-user-menu]");
    const userNames = document.querySelectorAll("[data-user-name]");
    const logoutButtons = document.querySelectorAll("[data-header-sign-out]");

    loginLinks.forEach((link) => {
      link.hidden = Boolean(user);
    });
    createLinks.forEach((link) => {
      link.hidden = Boolean(user);
    });
    userMenus.forEach((menu) => {
      menu.hidden = !user;
      if (!user) {
        menu.querySelector("[data-user-menu-popover]")?.setAttribute("hidden", "");
      }
    });
    userNames.forEach((nameNode) => {
      const firstName = user && user.user_metadata && user.user_metadata.first_name;
      nameNode.textContent = `Hi, ${firstName || "Client"}`;
    });

    logoutButtons.forEach((button) => {
      button.hidden = !user;
    });
  }

  async function refreshClientSummary() {
    const summaries = document.querySelectorAll("[data-client-summary]");
    if (!summaries.length) return;

    const user = await getCurrentUser();
    document.querySelectorAll("[data-logged-out-only]").forEach((node) => {
      node.hidden = Boolean(user);
    });
    document.querySelectorAll("[data-logged-in-only]").forEach((node) => {
      node.hidden = !user;
    });

    if (!user) {
      summaries.forEach((summary) => {
        summary.innerHTML = "";
      });
      return;
    }

    const name = [
      user.user_metadata && user.user_metadata.first_name,
      user.user_metadata && user.user_metadata.last_name
    ].filter(Boolean).join(" ");
    const birthDate = user.user_metadata && user.user_metadata.date_of_birth;
    const gender = user.user_metadata && user.user_metadata.gender;
    const details = [
      user.email,
      birthDate ? `Date of birth: ${birthDate}` : "",
      gender ? `Gender: ${gender}` : ""
    ].filter(Boolean);

    summaries.forEach((summary) => {
      summary.innerHTML = `<strong>Hi, ${name || "Client space"}</strong>${details.map((item) => `<span>${item}</span>`).join("")}`;
    });
  }

  async function loadBookings() {
    const list = document.querySelector("[data-bookings-list]");
    if (!list) return;

    const user = await getCurrentUser();
    if (!user) {
      list.innerHTML = '<article><strong>Please log in first</strong><span>Your private bookings are visible after login.</span><a href="client-space.html">Go to Client space</a></article>';
      return;
    }

    const { data, error } = await client
      .from("bookings")
      .select("id, session_type, starts_at, ends_at, status, meeting_url, notes")
      .eq("user_id", user.id)
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

      showStatus("You are logged in.", "success");
      await refreshHeaderClientLinks();
      await refreshClientSummary();
      await loadBookings();
    }

    if (form.matches("[data-signup-form]")) {
      event.preventDefault();
      const formData = new FormData(form);
      const firstName = String(formData.get("first_name") || "").trim();
      const lastName = String(formData.get("last_name") || "").trim();
      const dateOfBirth = String(formData.get("date_of_birth") || "").trim();
      const gender = String(formData.get("gender") || "").trim();
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");

      if (!form.checkValidity() || !firstName || !lastName || !dateOfBirth || !gender || !email || !password) {
        form.reportValidity();
        showStatus("Please fill in all required fields before creating your account.", "error");
        return;
      }

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: fullOriginPath("client-space.html"),
          data: {
            first_name: firstName,
            last_name: lastName,
            date_of_birth: dateOfBirth,
            gender
          }
        }
      });

      if (error) {
        showStatus(error.message, "error");
        return;
      }

      const identities = data && data.user && Array.isArray(data.user.identities) ? data.user.identities : [];
      if (data && data.user && identities.length === 0) {
        showStatus("This email is already connected to a Luxia P&C account. Please log in or use Forgot password.", "error");
        return;
      }

      showStatus("Account created. Please check your email to activate it, then log in.", "success");
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
    if (!(target instanceof HTMLElement)) return;

    if (target.matches("[data-user-menu-toggle]")) {
      const menu = target.closest("[data-user-menu]");
      const popover = menu && menu.querySelector("[data-user-menu-popover]");
      if (popover instanceof HTMLElement) {
        popover.hidden = !popover.hidden;
        target.textContent = popover.hidden ? "▾" : "▴";
      }
      return;
    }

    if (!target.matches("[data-sign-out], [data-header-sign-out]")) return;

    await client.auth.signOut();
    showStatus("You have been signed out.", "success");
    await refreshHeaderClientLinks();
    await refreshClientSummary();
  });

  refreshHeaderClientLinks();
  refreshClientSummary();
  loadBookings();
})();
