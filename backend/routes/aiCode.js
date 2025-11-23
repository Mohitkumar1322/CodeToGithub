// routes/aiCode.js - Gemini version with robust parsing (fixed & cleaned)
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// try to require the Google generative SDK package
let GoogleGenerativeAI;
try {
  GoogleGenerativeAI = require("@google/generative-ai").GoogleGenerativeAI || require("@google/generative-ai").default || require("@google/generative-ai");
} catch (e) {
  console.warn("Could not require @google/generative-ai normally:", e.message);
}

const genAI = GoogleGenerativeAI ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests, try again shortly" },
});

function clamp(t) {
  if (!t) return "";
  return t.length > 20000 ? t.slice(0, 20000) : t;
}

// Robust extractor: try several known shapes
function extractGeneratedText(response) {
  if (!response) return null;

  if (typeof response === "string" && response.trim()) return response.trim();
  if (response.text && typeof response.text === "string") return response.text.trim();

  if (response.output && Array.isArray(response.output)) {
    try {
      for (const o of response.output) {
        if (o.content && Array.isArray(o.content)) {
          for (const c of o.content) {
            if (c.type === "output_text" && typeof c.text === "string") return c.text.trim();
            if (c.text && typeof c.text === "string") return c.text.trim();
            if (Array.isArray(c) && typeof c[0] === "string") return String(c[0]).trim();
          }
        }
        if (typeof o.content === "string" && o.content.trim()) return o.content.trim();
        if (o.text && typeof o.text === "string") return o.text.trim();
      }
    } catch (e) {
      // ignore and continue
    }
  }

  if (response.candidates && Array.isArray(response.candidates)) {
    for (const cand of response.candidates) {
      if (cand.content && typeof cand.content === "string") return cand.content.trim();
      if (cand.output && typeof cand.output === "string") return cand.output.trim();
      if (cand.message && typeof cand.message === "string") return cand.message.trim();
    }
  }

  if (Array.isArray(response) && response[0] && response[0].generated_text) {
    return String(response[0].generated_text).trim();
  }

  if (response.candidates && response.candidates[0]) {
    const c = response.candidates[0];
    if (c.message && c.message.content && Array.isArray(c.message.content)) {
      for (const item of c.message.content) {
        if (item.text) return item.text.trim();
      }
    }
  }

  function searchForString(obj) {
    if (!obj || typeof obj !== "object") return null;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
      if (typeof v === "object") {
        const found = searchForString(v);
        if (found) return found;
      }
    }
    return null;
  }
  const found = searchForString(response);
  if (found) return found;

  return null;
}

router.post("/enhance-code", limiter, async (req, res) => {
  try {
    if (!genAI) {
      console.error("[aiCode] Gemini SDK not initialized. Install @google/generative-ai and set GEMINI_API_KEY.");
      return res.status(500).json({ error: "Gemini SDK not available on server. Install @google/generative-ai and set GEMINI_API_KEY." });
    }

    const { code: rawCode, language = "javascript", verbosity = "concise" } = req.body || {};
    if (!rawCode) return res.status(400).json({ error: "Missing code" });

    const code = clamp(rawCode);

    const system = `
You are a precise teaching assistant. Given source code, return ONLY JSON:

{
  "commented_code": "...",
  "pattern": "...",
  "time_complexity": { "estimate": "O()", "confidence": 0-1 },
  "space_complexity": { "estimate": "O()", "confidence": 0-1 },
  "explanation": ["...", "..."],
  "notes": "..."
}

Rules:
- NEVER output anything outside JSON.
- Add inline comments using correct comment style.
- Do not modify logic.
- Keep original formatting.
- Pattern must be short (e.g., "Two Pointers", "DP", "Binary Search").
- Verbosity levels:
  concise → small comments
  verbose → more detailed
  teaching → step-by-step + micro-example
`;

    const userInput = `
LANGUAGE: ${language}
VERBOSITY: ${verbosity}
CODE:
"""${code}"""
`;

    console.log("[aiCode] calling Gemini (gemini-2.0-flash) ... length:", code.length);

    // Call Gemini with flexible invocation patterns to support SDK differences
    let rawResponse = null;
    try {
      if (typeof genAI.getGenerativeModel === "function") {
        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash",
          systemInstruction: system,
        });

        try {
          rawResponse = await model.generateContent(userInput);
        } catch (e) {
          rawResponse = await model.generateContent({ text: userInput });
        }
      } else if (typeof genAI.generate === "function") {
        try {
          rawResponse = await genAI.generate({ model: "gemini-2.0-flash", input: userInput, systemInstruction: system });
        } catch (e) {
          rawResponse = await genAI.generate({ model: "gemini-2.0-flash", prompt: userInput, systemInstruction: system });
        }
      } else {
        rawResponse = await (genAI.generateContent ? genAI.generateContent(userInput) : null);
      }
    } catch (callErr) {
      console.error("[aiCode] Gemini call error:", callErr?.message || callErr);
      return res.status(500).json({ error: "Gemini call failed", details: (callErr?.message || String(callErr)) });
    }

    const generatedText = extractGeneratedText(rawResponse);

    if (!generatedText) {
      console.error("[aiCode] Could not extract text from Gemini response. Full response below:");
      try {
        console.error(JSON.stringify(rawResponse, null, 2));
      } catch (e) {
        console.error("Failed to stringify rawResponse:", e);
        console.error(rawResponse);
      }
      return res.status(500).json({ error: "Failed to extract text from Gemini response", rawResponseSample: typeof rawResponse === "string" ? rawResponse.slice(0, 1000) : null });
    }

    // === Begin: robust cleaning + JSON parsing ===
    const aiText = String(generatedText || "").trim();

    // Remove Markdown code fences like ```json or ```
    let cleaned = aiText.replace(/```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    // Defensive: find first { and last } and extract JSON substring
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[aiCode] Failed to parse cleaned AI output. cleaned preview:");
      console.error(cleaned.slice(0, 2000));
      return res.status(502).json({
        error: "Failed to parse AI output as JSON after cleaning",
        snippet: cleaned.slice(0, 2000),
      });
    }
    // === End: robust cleaning + JSON parsing ===

    if (!parsed.commented_code) {
      console.error("[aiCode] parsed JSON missing commented_code:", parsed);
      return res.status(502).json({ error: "AI JSON missing commented_code", parsed });
    }

    parsed.original_code = code;
    parsed.verbosity = verbosity;
    return res.json({ ok: true, data: parsed });
  } catch (err) {
    console.error("[aiCode] unexpected error:", err?.message || err);
    return res.status(500).json({ error: "server error", details: err?.message || String(err) });
  }
});

module.exports = router;
