function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function paragraph(text) {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#587078">${escapeHtml(text)}</p>`;
}

function detailsCard(rows) {
  const content = rows.map(([label, value]) => `<tr><td style="padding:7px 0;width:145px;vertical-align:top;font-size:13px;font-weight:700;color:#18343b">${escapeHtml(label)}</td><td style="padding:7px 0;vertical-align:top;font-size:14px;line-height:1.55;color:#587078">${escapeHtml(value || "Not provided")}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;background:#f5faf8;border-radius:12px"><tr><td style="padding:16px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${content}</table></td></tr></table>`;
}

function actionButton(url, label) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto"><tr><td align="center"><a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 28px;border:1px solid #aad8ce;border-radius:999px;background:#dff4e9;color:#18343b;text-decoration:none;font-size:16px;font-weight:700;line-height:1.2">${escapeHtml(label)}</a></td></tr></table>`;
}

function luxiaEmail({ eyebrow = "Luxia P&C", title, intro = "", content = "", footer = "This is an automated Luxia notification." }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:#f3f8f8;font-family:Arial,Helvetica,sans-serif;color:#18343b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f8f8"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #dbe8e8;border-radius:20px;overflow:hidden;box-shadow:0 18px 48px rgba(28,68,73,.10)"><tr><td style="height:8px;background:linear-gradient(90deg,#d9b34c 0%,#7bd6d2 52%,#d9ef9d 100%);font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:34px 42px 30px"><p style="margin:0 0 26px;font-size:13px;line-height:1.4;font-weight:700;letter-spacing:1.5px;color:#b58a27;text-transform:uppercase">${escapeHtml(eyebrow)}</p><h1 style="margin:0 0 16px;font-size:30px;line-height:1.2;color:#18343b">${escapeHtml(title)}</h1>${intro ? paragraph(intro) : ""}${content}</td></tr><tr><td style="padding:20px 42px;background:#eef6f5;border-top:1px solid #dbe8e8;font-size:12px;line-height:1.6;color:#72878b;text-align:center">Luxia P&amp;C · Prevention &amp; Coaching<br>${escapeHtml(footer)}</td></tr></table></td></tr></table></body></html>`;
}

module.exports = { actionButton, detailsCard, escapeHtml, luxiaEmail, paragraph };
