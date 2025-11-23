chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "auth") {
    const CLIENT_ID = "Ov23lieYKdpuAb55N8zU";
    const REDIRECT_URI = chrome.identity.getRedirectURL();
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo`;

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    }, async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        console.error("Auth failed:", chrome.runtime.lastError);
        sendResponse({ success: false });
        return;
      }

      const url = new URL(redirectUrl);
      const code = url.searchParams.get("code");

      try {
        const res = await fetch("http://localhost:3000/get-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        const data = await res.json();
        const token = data.access_token;

        if (token) {
          chrome.storage.local.set({ github_token: token }, () => {
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ success: false });
        }
      } catch (err) {
        console.error("Token exchange failed:", err);
        sendResponse({ success: false });
      }
    });

    return true;
  }
});