/**
 * Facebook Video Downloader - Backend API
 * ----------------------------------------
 * Public FB video URL/post URL/reel URL dile HD/SD direct video link ber kore dey.
 *
 * IMPORTANT NOTES:
 * - Only PUBLIC videos work (private/friends-only content can't be accessed without login).
 * - Facebook majhe majhe (kokhono kokhono) tader page HTML structure change kore.
 *   Tokhon ei parsing logic update korte hobe. Ei karone "forever 100% guaranteed"
 *   emon kono dabi kora jay na - kintu ei code ta jotota shombhob robust kora hoyeche
 *   (multiple fallback pattern diye).
 * - Personal/fair-use er jonno banano, mass redistribution/copyright content
 *   niye savdhan thakben.
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Mobile user-agent use korle Facebook shohoje "unstyled" HTML dey jeta theke
// video source ber kora onek shohoj hoy.
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36";

/**
 * Facebook-er onek dhoroner URL thake (fb.watch, m.facebook.com, web.facebook.com,
 * facebook.com/reel/, facebook.com/share/v/ ityadi). Amra shobgulake ekta
 * consistent mbasic.facebook.com URL-e convert korar chesta korbo, karon
 * mbasic version shobcheye shimple HTML dey (JS render kora lage na).
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    u.hostname = "www.facebook.com";
    return u.toString();
  } catch (e) {
    throw new Error("INVALID_URL");
  }
}

async function resolveRedirect(url) {
  // fb.watch shortlinks redirect kore আসল video URL-e.
  if (url.includes("fb.watch")) {
    const res = await axios.get(url, {
      maxRedirects: 5,
      headers: { "User-Agent": MOBILE_UA },
    });
    return res.request.res.responseUrl || url;
  }
  return url;
}

async function fetchFacebookHtml(url) {
  const response = await axios.get(url, {
    headers: {
      "User-Agent": MOBILE_UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 15000,
  });
  return response.data;
}

/**
 * Multiple regex fallback - kono ekta pattern miss korle porerta try kore.
 * Ei "layered fallback" approach ta reliability barate shobcheye kaje dey.
 */
function extractVideoLinks(html) {
  const patterns = {
    hd: [
      /"browser_native_hd_url":"([^"]+)"/,
      /hd_src:"([^"]+)"/,
      /"playable_url_quality_hd":"([^"]+)"/,
    ],
    sd: [
      /"browser_native_sd_url":"([^"]+)"/,
      /sd_src:"([^"]+)"/,
      /"playable_url":"([^"]+)"/,
    ],
    title: [/<title>([^<]+)<\/title>/],
  };

  const tryPatterns = (list) => {
    for (const re of list) {
      const match = html.match(re);
      if (match && match[1]) {
        // Facebook JSON-encoded string er escape (\/  -> /, \u0025 -> % etc) clean kora
        return match[1]
          .replace(/\\\//g, "/")
          .replace(/\\u0025/g, "%")
          .replace(/&amp;/g, "&");
      }
    }
    return null;
  };

  const hd = tryPatterns(patterns.hd);
  const sd = tryPatterns(patterns.sd);
  const title = tryPatterns(patterns.title);

  return { hd, sd, title };
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/resolve", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL dite hobe (body-te 'url' field pathan)." });
  }

  try {
    const redirected = await resolveRedirect(url);
    const normalized = normalizeUrl(redirected);
    const html = await fetchFacebookHtml(normalized);
    const { hd, sd, title } = extractVideoLinks(html);

    if (!hd && !sd) {
      return res.status(422).json({
        error:
          "Video link ber kora jayni. Video ta public kina check korun, othoba Facebook temporarily page structure change koreche.",
      });
    }

    return res.json({
      success: true,
      title: title || "facebook_video",
      downloads: {
        hd: hd || null,
        sd: sd || null,
      },
    });
  } catch (err) {
    console.error(err.message);
    if (err.message === "INVALID_URL") {
      return res.status(400).json({ error: "Valid Facebook URL den." });
    }
    return res.status(500).json({
      error: "Server-e shomossha hoyeche. Ektu por abar try korun.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`FB downloader backend running on port ${PORT}`);
});
