# Project Overview: CodePusher

**CodePusher** is a Chrome Extension designed to streamline the process of pushing code snippets directly from the browser to GitHub. It also features an AI-powered "Enhance" capability that annotates and improves code before pushing.

## 📂 Code Structure

The project is divided into two main components: the **Chrome Extension** (Frontend) and a **Node.js Backend**.

### 1. Chrome Extension
- **`manifest.json`**: The configuration file for the extension (Manifest V3). Defines permissions (`identity`, `storage`, `scripting`) and background scripts.
- **`popup.html` & `popup.js`**: The main user interface.
  - **Auth**: Initiates GitHub login.
  - **Enhance**: Sends code to the backend for AI improvement.
  - **Push**: Interacts directly with the GitHub API to create or update files.
- **`background.js`**: Handles the OAuth 2.0 authentication flow. It captures the redirect from GitHub and (attempts to) exchange the authorization code for an access token via the backend.

### 2. Backend (Node.js/Express)
- **`index.js`**: The entry point for the server. Sets up middleware (CORS, JSON parsing) and routes.
- **`routes/aiCode.js`**: Contains the logic for interacting with Google's Gemini API to enhance code.
- **`.env`**: Stores sensitive keys like `CLIENT_ID`, `CLIENT_SECRET`, and `GEMINI_API_KEY`.

---

## 🔄 Data Flow

### 1. Authentication Flow (Broken - See Assessment)
1.  **User** clicks "Authenticate" in the popup.
2.  **`background.js`** launches `chrome.identity.launchWebAuthFlow` with the GitHub OAuth URL.
3.  **User** logs in on GitHub and approves the app.
4.  **GitHub** redirects back with a `code`.
5.  **`background.js`** extracts the `code` and sends a POST request to `http://localhost:3000/get-token`.
6.  **Backend** *should* exchange this code for an `access_token` using the GitHub API and return it.
7.  **Extension** saves the `access_token` to `chrome.storage.local`.

### 2. AI Enhancement Flow
1.  **User** pastes code and clicks "Enhance".
2.  **`popup.js`** sends the code + language to `http://localhost:3000/api/ai/enhance-code`.
3.  **Backend (`aiCode.js`)** constructs a prompt and calls the **Google Gemini API**.
4.  **Gemini** returns the enhanced/commented code.
5.  **Backend** parses and sanitizes the response, returning JSON to the extension.
6.  **Extension** shows a preview of the enhanced code.

### 3. Push to GitHub Flow
1.  **User** clicks "Push".
2.  **`popup.js`** retrieves the `access_token` from storage.
3.  **Extension** calls GitHub API (`GET /repos/.../contents/...`) to check if the file exists.
    - If exists: It compares content. If different, it calls `PUT` to update (providing the file's `sha`).
    - If not exists: It calls `PUT` to create a new file.

---

## 🧐 Assessment & Quality Review

### Is this a good project?
**Yes, but it requires fixes to work.**
- **Concept**: Excellent. A browser-based code scratchpad that syncs to GitHub is very useful for LeetCode, quick prototyping, or saving snippets.
- **Tech Stack**: Modern and appropriate.
  - **Manifest V3**: Future-proof extension standard.
  - **Gemini AI**: State-of-the-art model for code analysis.
  - **Separation of Concerns**: Good split between client (extension) and server (heavy lifting/secrets).

### ⚠️ Critical Issues
1.  **Missing Token Exchange Logic**:
    - In `backend/index.js`, the `/get-token` route is **commented out/missing**.
    - `// your existing token exchange route is here`
    - **Consequence**: Authentication will fail 100% of the time. The extension cannot get a token.
2.  **Hardcoded Localhost**:
    - The extension points to `http://localhost:3000`. This is fine for development but means you cannot distribute this extension to others unless they also run your backend locally.

### ✅ Pros
- **Robust AI Handling**: The `aiCode.js` file has excellent error handling and response parsing (handling Markdown fences, JSON extraction) for the Gemini API.
- **Smart Push Logic**: The extension correctly handles "Create" vs "Update" and checks for conflicts (SHA mismatch), which is a best practice for GitHub API interactions.

---

## 🛠️ Feature List

| Feature | Status | Description |
| :--- | :--- | :--- |
| **GitHub Auth** | ❌ **Broken** | OAuth flow implemented but backend handler is missing. |
| **AI Enhance** | ✅ **Working** | Uses Gemini to add comments, complexity analysis, and clean up code. |
| **Push Code** | ✅ **Working** | Direct integration with GitHub API to save files. |
| **Diff Check** | ✅ **Working** | Prevents unnecessary commits if code hasn't changed. |
| **Language Detect**| ⚠️ **Basic** | Simple filename extension detection (e.g., `.js` -> javascript). |

---

## 🚀 How to Fix & Run

1.  **Fix Backend**: You must implement the `/get-token` route in `backend/index.js` to swap the `code` for a `token`.
2.  **Start Backend**: Run `node index.js` in the `backend` folder.
3.  **Load Extension**: Load the folder as an "Unpacked Extension" in Chrome.
