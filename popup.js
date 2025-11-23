// popup.js - adds Enhance (AI) + Accept + Push flow
document.addEventListener("DOMContentLoaded", () => {
  const authBtn = document.getElementById("authBtn");
  const enhanceBtn = document.getElementById("enhanceBtn");
  const acceptBtn = document.getElementById("acceptBtn");
  const pushBtn = document.getElementById("pushBtn");
  const statusDiv = document.getElementById("status");
  const previewWrap = document.getElementById("previewWrap");
  const previewArea = document.getElementById("preview");

  authBtn.onclick = () => {
    chrome.runtime.sendMessage({ type: "auth" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Auth Error:", chrome.runtime.lastError.message);
        statusDiv.innerText = "Auth failed.";
        return;
      }
      statusDiv.innerText = response?.success ? "✅ Authenticated!" : "❌ Authentication failed.";
    });
  };

  // helper: safe base64 encoder for unicode
  function encodeContentToBase64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      const utf8 = new TextEncoder().encode(str);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < utf8.length; i += chunkSize) {
        const chunk = utf8.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
    }
  }

  async function getUsername(token) {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
    });
    if (!userRes.ok) throw new Error("Failed to fetch user");
    const userData = await userRes.json();
    return userData.login;
  }

  // ENHANCE: call backend AI to annotate code
  enhanceBtn.onclick = async () => {
    const codeEl = document.getElementById("code");
    const code = codeEl.value;
    const language = detectLanguageFromFilename(document.getElementById("filename").value) || "javascript";
    const verbosity = "concise"; // you can expose UI to pick this later

    if (!code.trim()) {
      statusDiv.innerText = "❌ Paste some code to enhance.";
      return;
    }

    statusDiv.innerText = "🪄 Enhancing with AI…";
    try {
      // change backend URL if different port
      const res = await fetch("http://localhost:3000/api/ai/enhance-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language, verbosity }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        console.error("AI enhance failed:", json);
        statusDiv.innerText = "❌ AI enhancement failed.";
        return;
      }

      const commented = json.data.commented_code || "";
      previewArea.value = commented;
      previewWrap.style.display = "block";
      acceptBtn.disabled = false;
      statusDiv.innerText = "Preview ready — review and Accept to replace editor.";
    } catch (err) {
      console.error("Enhance error:", err);
      statusDiv.innerText = "❌ Error calling AI enhancement.";
    }
  };

  // ACCEPT: replace editor content with preview (user confirmed)
  acceptBtn.onclick = () => {
    const codeEl = document.getElementById("code");
    const preview = previewArea.value;
    if (!preview) return;
    codeEl.value = preview;
    previewWrap.style.display = "none";
    acceptBtn.disabled = true;
    statusDiv.innerText = "✅ Preview accepted. You can now Push to GitHub.";
  };

  // PUSH: uses existing token & safe-update logic (checks remote content sha & equality)
  pushBtn.onclick = async () => {
    const repo = document.getElementById("repo").value.trim();
    const filename = document.getElementById("filename").value.trim();
    const code = document.getElementById("code").value;

    statusDiv.innerText = "";
    if (!repo || !filename) {
      statusDiv.innerText = "❌ Please enter repo name and filename.";
      return;
    }

    chrome.storage.local.get("github_token", async (items) => {
      const token = items.github_token;
      if (!token) {
        statusDiv.innerText = "❌ Please authenticate first.";
        return;
      }

      try {
        statusDiv.innerText = "Checking remote file...";
        const username = await getUsername(token);
        const url = `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filename)}`;
        const branch = "main";

        const getRes = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
          headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
        });

        const localB64 = encodeContentToBase64(code);

        if (getRes.status === 200) {
          const getJson = await getRes.json();
          const remoteB64 = (getJson.content || "").replace(/\n/g, "");
          const remoteSha = getJson.sha;

          if (remoteB64 === localB64) {
            statusDiv.innerText = "ℹ️ No changes detected — not pushing.";
            return;
          }

          statusDiv.innerText = "Remote file differs — updating...";
          const body = {
            message: `Update ${filename} (via extension)`,
            content: localB64,
            sha: remoteSha,
            branch,
          };

          const putRes = await fetch(url, {
            method: "PUT",
            headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          const putJson = await putRes.json();
          if (putRes.ok) {
            statusDiv.innerText = "✅ Updated file successfully!";
          } else {
            console.error("Update failed:", putJson);
            if (putRes.status === 409) {
              statusDiv.innerText = "❌ Conflict: remote changed. Please pull/merge first or use a new filename.";
            } else {
              statusDiv.innerText = `❌ Update failed: ${putJson.message || JSON.stringify(putJson)}`;
            }
          }
        } else if (getRes.status === 404) {
          statusDiv.innerText = "Remote file not found — creating new file...";
          const body = {
            message: `Add ${filename} (via extension)`,
            content: localB64,
            branch,
          };

          const createRes = await fetch(url, {
            method: "PUT",
            headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          const createJson = await createRes.json();
          if (createRes.ok) {
            statusDiv.innerText = "✅ File created successfully!";
          } else {
            console.error("Create failed:", createJson);
            statusDiv.innerText = `❌ Create failed: ${createJson.message || JSON.stringify(createJson)}`;
          }
        } else {
          const errJson = await getRes.json().catch(() => ({}));
          console.error("Failed to fetch remote file:", errJson);
          statusDiv.innerText = `❌ Failed to check remote file: ${errJson.message || getRes.statusText}`;
        }
      } catch (err) {
        console.error("Push flow error:", err);
        statusDiv.innerText = "❌ Error: " + (err.message || err);
      }
    });
  };

  // naive language detector for verbosity -> pass to backend (optional)
  function detectLanguageFromFilename(filename) {
    if (!filename) return null;
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': return 'javascript';
      case 'ts': return 'typescript';
      case 'py': return 'python';
      case 'java': return 'java';
      case 'cpp': case 'cc': case 'cxx': case 'c': return 'cpp';
      case 'go': return 'go';
      case 'rs': return 'rust';
      case 'kt': return 'kotlin';
      default: return 'javascript';
    }
  }
});
