(function () {
  const config = window.LUXIA_SUPABASE;
  const statusNode = document.querySelector("[data-auth-status]");

  function showStatus(message, type) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.type = type || "info";
    statusNode.hidden = false;
  }

  function showNodeStatus(node, message, type) {
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type || "info";
    node.hidden = false;
  }

  if (!config || !config.url || !config.publishableKey || !window.supabase) {
    showStatus("Supabase is not configured yet. Please check supabase-config.js.", "error");
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  window.LUXIA_SUPABASE_CLIENT = client;

  function authErrorMessage(error) {
    const message = String((error && error.message) || error || "");
    const isConnectionError =
      (error && error.name === "AuthRetryableFetchError") ||
      /networkerror|failed to fetch|fetch resource|network request/i.test(message);

    return isConnectionError
      ? "Login is temporarily unavailable. Please wait a moment and try again."
      : message || "Login was unsuccessful. Please check your details and try again.";
  }

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
    const isOwner = Boolean(user && user.app_metadata && user.app_metadata.luxia_role === "owner");

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
    document.querySelectorAll(".drawer").forEach((drawer) => {
      drawer.querySelector('[data-page="coach-schedule"]')?.remove();
      let ownerLink = drawer.querySelector("[data-owner-link]");
      if (isOwner && !ownerLink) {
        ownerLink = document.createElement("a");
        const isPagesDirectory = window.location.pathname.includes("/pages/");
        ownerLink.href = isPagesDirectory ? "administration.html" : "pages/administration.html";
        ownerLink.textContent = "Administration";
        ownerLink.dataset.ownerLink = "";
        ownerLink.dataset.page = "administration";
        const aboutLink = drawer.querySelector('[data-page="aboutme"], a[href$="aboutme.html"]');
        drawer.insertBefore(ownerLink, aboutLink || null);
      }
      if (ownerLink) ownerLink.hidden = !isOwner;
    });

    if (document.body.matches("[data-owner-page]") && !isOwner) {
      const destination = `${window.location.pathname.split("/").pop()}${window.location.search}`;
      window.location.replace(user ? "client-space.html" : `client-space.html?next=${encodeURIComponent(destination)}`);
    }
  }

  async function protectSignupPage() {
    const signupForm = document.querySelector("[data-signup-form]");
    if (!(signupForm instanceof HTMLFormElement)) return;

    try {
      const user = await getCurrentUser();
      if (user) {
        window.location.replace("client-space.html");
        return;
      }

      signupForm.hidden = false;
    } catch (error) {
      showStatus(authErrorMessage(error), "error");
    }
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
    const phone = (user.user_metadata && user.user_metadata.phone) || user.phone;
    const details = [
      user.email,
      phone ? `Phone: ${phone}` : "",
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
      list.innerHTML = '<article><strong>No bookings yet</strong><span>Once a coaching session is booked, it will appear here with its status and private session link.</span><a href="book-consultation.html">Book coaching</a></article>';
      return;
    }

    const now = new Date();
    list.innerHTML = data.map((booking) => {
      const start = new Date(booking.starts_at);
      const end = new Date(booking.ends_at);
      const isPast = end <= now || booking.status === "completed";
      const isActive = !isPast && start <= now && now < end;
      const when = start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      const link = booking.meeting_url && !isPast
        ? `<a href="${booking.meeting_url}" target="_blank" rel="noreferrer">Enter private session</a>`
        : booking.meeting_url
          ? "<span>Private session expired.</span>"
          : "<span>Private link appears after confirmation.</span>";

      const sessionLabel = booking.session_type === "coaching"
        ? "1 hour coaching"
        : booking.session_type === "consultation"
          ? "20 minute consultation"
          : booking.session_type || "Coaching session";

      const timingLabel = isPast ? "Past session" : isActive ? "Currently active" : "Upcoming session";
      const timingClass = isPast ? "past-booking" : isActive ? "active-booking" : "upcoming-booking";
      return `<article class="${timingClass}"><small>${timingLabel}</small><strong>${sessionLabel}</strong><span>${when}</span><span>Status: ${booking.status}</span>${link}</article>`;
    }).join("");
  }

  async function refreshContactForm() {
    const form = document.querySelector("[data-contact-form]");
    if (!(form instanceof HTMLFormElement)) return;

    const user = await getCurrentUser();
    const nameField = form.querySelector("[data-contact-name-field]");
    const emailField = form.querySelector("[data-contact-email-field]");
    const phoneField = form.querySelector("[data-contact-phone-field]");
    const nameInput = form.querySelector('input[name="full_name"]');
    const emailInput = form.querySelector('input[name="email"]');
    const phoneInput = form.querySelector('input[name="phone"]');
    const note = document.querySelector("[data-contact-account-note]");

    if (user) {
      const metadata = user.user_metadata || {};
      const fullName = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ");
      const accountPhone = user.phone || metadata.phone || "";

      if (nameInput instanceof HTMLInputElement) {
        nameInput.value = fullName;
        nameInput.required = false;
      }
      if (nameField instanceof HTMLElement) nameField.hidden = true;

      if (emailInput instanceof HTMLInputElement) {
      emailInput.value = user.email || "";
      emailInput.required = false;
      }
      if (emailField instanceof HTMLElement) emailField.hidden = true;

      if (phoneInput instanceof HTMLInputElement) {
        phoneInput.value = accountPhone;
        phoneInput.required = !accountPhone;
      }
      if (phoneField instanceof HTMLElement) phoneField.hidden = Boolean(accountPhone);

      if (note) {
        const identity = [fullName || "Luxia client", user.email, accountPhone].filter(Boolean).join(" · ");
        note.textContent = accountPhone
          ? `Your verified account details will be used: ${identity}.`
          : `Your account name and email will be used automatically (${identity}). Please add a phone number for this message.`;
      }
      return;
    }

    if (nameInput instanceof HTMLInputElement) {
      nameInput.required = true;
      nameInput.value = "";
    }
    if (emailInput instanceof HTMLInputElement) {
      emailInput.required = true;
      emailInput.value = "";
    }
    if (phoneInput instanceof HTMLInputElement) {
      phoneInput.required = true;
      phoneInput.value = "";
    }
    if (nameField instanceof HTMLElement) nameField.hidden = false;
    if (emailField instanceof HTMLElement) emailField.hidden = false;
    if (phoneField instanceof HTMLElement) phoneField.hidden = false;
    if (note) {
      note.textContent = "Not logged in? Please provide your contact details so Luxia can reply in your preferred way.";
    }
  }

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.matches("[data-login-form]")) {
      event.preventDefault();
      const formData = new FormData(form);
      let error;

      try {
        ({ error } = await client.auth.signInWithPassword({
          email: String(formData.get("email") || "").trim().toLowerCase(),
          password: String(formData.get("password") || "")
        }));
      } catch (requestError) {
        error = requestError;
      }

      if (error) {
        showStatus(authErrorMessage(error), "error");
        return;
      }

      showStatus("You are logged in.", "success");
      await refreshHeaderClientLinks();
      const nextPage = new URLSearchParams(window.location.search).get("next");
      if (nextPage && /^(?:administration|private-session)\.html(?:\?booking=[0-9a-f-]{36})?$/i.test(nextPage)) {
        window.location.replace(nextPage);
        return;
      }
      await refreshClientSummary();
      await loadBookings();
    }

    if (form.matches("[data-signup-form]")) {
      event.preventDefault();
      const signedInUser = await getCurrentUser();
      if (signedInUser) {
        showStatus("You are already logged in. Opening your Client space...", "success");
        window.location.replace("client-space.html");
        return;
      }

      const formData = new FormData(form);
      const firstName = String(formData.get("first_name") || "").trim();
      const lastName = String(formData.get("last_name") || "").trim();
      const dateOfBirth = String(formData.get("date_of_birth") || "").trim();
      const gender = String(formData.get("gender") || "").trim();
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const phoneCountry = String(formData.get("phone_country") || "").replace(/\D/g, "");
      const phoneInput = String(formData.get("phone") || "").trim();
      const phoneDigits = phoneInput.replace(/\D/g, "").replace(/^0+/, "");
      const phone = phoneInput.startsWith("+") ? `+${phoneInput.replace(/\D/g, "")}` : `+${phoneCountry}${phoneDigits}`;
      const password = String(formData.get("password") || "");

      if (!form.checkValidity() || !firstName || !lastName || !dateOfBirth || !gender || !email || !phone || !password) {
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
            gender,
            phone
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

      showStatus(
        data && data.session
          ? "Account created. You are now logged in."
          : "Account created. Please check your email and use the confirmation link before logging in.",
        "success"
      );
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

      showStatus("If an account exists for this email, a password recovery link has been sent.", "success");
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

    if (form.matches("[data-contact-form]")) {
      event.preventDefault();
      const status = form.querySelector("[data-contact-status]");
      const submitButton = form.querySelector('button[type="submit"]');
      const formData = new FormData(form);
      const user = await getCurrentUser();
      const metadata = (user && user.user_metadata) || {};
      const accountName = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ");
      const fullName = user
        ? accountName || "Luxia client"
        : String(formData.get("full_name") || "").trim();
      const message = String(formData.get("message") || "").trim();
      const email = user && user.email
        ? user.email
        : String(formData.get("email") || "").trim().toLowerCase();
      const phone = user && (user.phone || metadata.phone)
        ? String(user.phone || metadata.phone).trim()
        : String(formData.get("phone") || "").trim();
      const preferredContact = String(formData.get("preferred_contact") || "").trim();

      if (!message) {
        showNodeStatus(status, "Please write a message before sending.", "error");
        form.querySelector('textarea[name="message"]')?.focus();
        return;
      }

      if (!form.checkValidity() || !fullName || !email || !phone || !["email", "phone"].includes(preferredContact)) {
        form.reportValidity();
        showNodeStatus(status, "Please complete your contact details and choose how you prefer to be contacted.", "error");
        return;
      }

      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
        submitButton.textContent = "Sending...";
      }
      showNodeStatus(status, "Sending your message...", "info");

      try {
        const response = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName,
            email,
            phone,
            preferredContact,
            message,
            clientAccount: user ? user.id : "not logged in"
          })
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          showNodeStatus(status, result.error || "The message could not be sent. Please try again.", "error");
          return;
        }

        showNodeStatus(status, "Your message has been sent directly to Luxia P&C.", "success");
        form.reset();
        await refreshContactForm();
      } catch (error) {
        showNodeStatus(status, "The message could not be sent. Please check your connection and try again.", "error");
      } finally {
        if (submitButton instanceof HTMLButtonElement) {
          submitButton.disabled = false;
          submitButton.textContent = "Send message";
        }
      }
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-phone-number]")) return;

    const startsWithPlus = input.value.startsWith("+");
    const digits = input.value.replace(/\D/g, "");
    input.value = `${startsWithPlus ? "+" : ""}${digits}`.slice(0, 18);
  });

  document.querySelectorAll("[data-phone-country]").forEach((select) => {
    if (!(select instanceof HTMLSelectElement)) return;
    const selectedValue = select.value;
    const options = Array.from(select.options).sort((a, b) =>
      a.textContent.replace(/^\S+\s*/, "").localeCompare(b.textContent.replace(/^\S+\s*/, ""), undefined, { sensitivity: "base" })
    );
    select.replaceChildren(...options);
    select.value = selectedValue;
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches("[data-language-toggle], [data-language-toggle] *")) {
      const toggle = target.closest("[data-language-toggle]");
      const menu = toggle && toggle.closest("[data-language-menu]");
      const options = menu && menu.querySelector("[data-language-options]");
      if (toggle instanceof HTMLButtonElement && options instanceof HTMLElement) {
        const willOpen = options.hidden;
        document.querySelectorAll("[data-language-options]").forEach((panel) => {
          if (panel !== options) panel.hidden = true;
        });
        document.querySelectorAll("[data-language-toggle]").forEach((button) => {
          if (button !== toggle) button.setAttribute("aria-expanded", "false");
        });
        options.hidden = !willOpen;
        toggle.setAttribute("aria-expanded", String(willOpen));
      }
      return;
    }

    if (target.matches("[data-language-option]")) {
      const menu = target.closest("[data-language-menu]");
      const current = menu && menu.querySelector("[data-language-current]");
      const toggle = menu && menu.querySelector("[data-language-toggle]");
      const options = menu && menu.querySelector("[data-language-options]");
      if (current instanceof HTMLElement && toggle instanceof HTMLButtonElement && options instanceof HTMLElement) {
        current.textContent = target.getAttribute("data-language-option") || "EN";
        toggle.setAttribute("aria-expanded", "false");
        options.hidden = true;
      }
      return;
    }

    if (!target.closest("[data-language-menu]")) {
      document.querySelectorAll("[data-language-options]").forEach((panel) => {
        panel.hidden = true;
      });
      document.querySelectorAll("[data-language-toggle]").forEach((button) => {
        button.setAttribute("aria-expanded", "false");
      });
    }

    if (target.matches("[data-user-menu-toggle]")) {
      const menu = target.closest("[data-user-menu]");
      const popover = menu && menu.querySelector("[data-user-menu-popover]");
      if (popover instanceof HTMLElement) {
        popover.hidden = !popover.hidden;
        target.innerHTML = popover.hidden ? "&#9662;" : "&#9652;";
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
  protectSignupPage();
  refreshClientSummary();
  refreshContactForm();
  loadBookings();
})();
