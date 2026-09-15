function javascriptString(value) {
  return JSON.stringify(String(value || ""));
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET");
    response.end();
    return;
  }

  const websiteId = String(process.env.UMAMI_WEBSITE_ID || "").trim();
  const scriptUrl = String(process.env.UMAMI_SCRIPT_URL || "https://cloud.umami.is/script.js").trim();
  const publicUrl = String(process.env.PUBLIC_SITE_URL || "https://dev.luxiapc.com").trim();
  let hostname = "";
  try { hostname = new URL(publicUrl).hostname; } catch (error) { hostname = ""; }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!websiteId || !hostname || !/^https:\/\//i.test(scriptUrl)) {
    response.end("/* Umami analytics is not configured. */");
    return;
  }

  response.end(`(function(){
    var tracker=document.createElement("script");
    tracker.defer=true;
    tracker.src=${javascriptString(scriptUrl)};
    tracker.setAttribute("data-website-id",${javascriptString(websiteId)});
    tracker.setAttribute("data-domains",${javascriptString(hostname)});
    tracker.setAttribute("data-performance","true");
    document.head.appendChild(tracker);
  })();`);
};
