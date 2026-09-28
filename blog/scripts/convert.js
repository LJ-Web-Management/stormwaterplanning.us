const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const AdmZip = require("adm-zip");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const PROCESSED_DIR = path.join(UPLOADS_DIR, "processed");
const POSTS_DIR = path.join(ROOT, "posts");
const POSTS_JSON = path.join(ROOT, "posts.json");
const POST_IMAGES_DIR = path.join(ROOT, "assets", "img", "posts");
const TEMPLATE_FILE = path.join(__dirname, "templates", "post-template.html");
const SITE_URL = "https://stormwaterplanning.us";
const BLOG_URL = SITE_URL + "/blog";

const SUPPORTED_EXTENSIONS = [".docx", ".txt", ".zip"];
const DOC_EXTENSIONS = [".docx", ".txt"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

// ---------------------------------------------------------------------------
// "Styled text" detection.
//
// Many AI-generated / social-style posts fake bold and headings using the
// Unicode Mathematical Alphanumeric Symbols block (e.g. "𝐎𝐩𝐞𝐧𝐀𝐈") instead of
// real formatting, use a line of box-drawing characters ("━━━━") as a section
// divider, "•" for bullets, and a "Sources" section listing a name followed
// by its URL on the next line. This parser recognises that shape (from a
// .docx OR a plain .txt) and turns it into real HTML headings/lists/links.
// ---------------------------------------------------------------------------

function isStyledChar(ch) {
  const cp = ch.codePointAt(0);
  return cp >= 0x1d400 && cp <= 0x1d7ff;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Normalizes styled Unicode text back to plain characters, wrapping runs
// that were styled in <strong> so the "boldness" survives as real HTML.
function normalizeAndMarkBold(text) {
  const chars = Array.from(text);
  let html = "";
  let i = 0;
  while (i < chars.length) {
    const bold = isStyledChar(chars[i]);
    let j = i;
    while (j < chars.length && isStyledChar(chars[j]) === bold) j++;
    const run = chars.slice(i, j).join("").normalize("NFKC");
    const escaped = escapeHtml(run);
    html += bold ? "<strong>" + escaped + "</strong>" : escaped;
    i = j;
  }
  return html;
}

function plainNormalize(text) {
  return text.normalize("NFKC").trim();
}

function styledRatio(text) {
  const letters = Array.from(text).filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (letters.length === 0) return 0;
  const styled = letters.filter(isStyledChar).length;
  return styled / letters.length;
}

function isMostlyStyled(text) {
  return styledRatio(text) > 0.6;
}

function isDividerLine(text) {
  const t = text.trim();
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return true;
  if (t.length < 5) return false;
  return /^[─-╿—–\-=_~*]+$/.test(t);
}

function isBulletLine(text) {
  return /^[•‣◦▪●·]\s+/.test(text.trim()) || /^[*-]\s+\S/.test(text.trim());
}

function stripBullet(text) {
  return text.trim().replace(/^[•‣◦▪●·*-]\s+/, "");
}

function isUrlLine(text) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function isSourcesHeading(text) {
  return /^(sources?|references?)$/i.test(plainNormalize(text));
}

function linkifyUrls(html) {
  return html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

// ---------------------------------------------------------------------------
// Manual formatting shortcuts.
//
// Typed directly into the source .docx/.txt, these give the writer control
// over formatting without needing real Word styling:
//   **bold**              -> <strong>
//   *italic*  or _italic_ -> <em>
//   ## Heading            -> <h2>   (### -> <h3>)
//   > quoted text         -> indented pull-quote / blockquote
//   ((small print))       -> smaller caption-style text
//   [space]  (own line)   -> extra vertical gap
//   1. item / 2. item     -> numbered list
// A line of repeated dashes/underscores/box-drawing characters (e.g. "---" or
// "━━━━━━━━━━", already how AI drafts mark section breaks) becomes a real
// horizontal-rule divider instead of being silently discarded.
// ---------------------------------------------------------------------------

function applyMarkdownEmphasis(html) {
  html = html.replace(/\*\*([^\n*]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^\n*]+?)\*/g, "<em>$1</em>");
  html = html.replace(/(^|[^\w])_([^\n_]+?)_(?!\w)/g, "$1<em>$2</em>");
  return html;
}

function formatInline(text) {
  return linkifyUrls(applyMarkdownEmphasis(normalizeAndMarkBold(text)));
}

function headingShortcutMatch(text) {
  const m = text.trim().match(/^(#{1,3})\s+(\S.*)$/);
  if (!m) return null;
  return { level: m[1].length >= 3 ? 3 : 2, text: m[2].trim() };
}

function isBlockquoteShortcut(text) {
  return /^>\s?\S/.test(text.trim());
}

function stripBlockquote(text) {
  return text.trim().replace(/^>\s?/, "");
}

function isSpacerShortcut(text) {
  return /^\[space\]$/i.test(text.trim());
}

function captionShortcutMatch(text) {
  const m = text.trim().match(/^\(\((.+)\)\)$/);
  return m ? m[1].trim() : null;
}

function isOrderedListLine(text) {
  return /^\d+[.)]\s+\S/.test(text.trim());
}

function stripOrderedMarker(text) {
  return text.trim().replace(/^\d+[.)]\s+/, "");
}

// ---------------------------------------------------------------------------
// Extracting an ordered list of paragraph "blocks" from either a mammoth
// HTML conversion (.docx) or plain text (.txt), so both file types can be
// run through the exact same structural parser below.
// ---------------------------------------------------------------------------

function blocksFromMammothHtml(html) {
  const matches = html.match(/<(h[1-6]|p|ul|ol|table|blockquote)[^>]*>[\s\S]*?<\/\1>/gi) || [];
  return matches.map((block) => {
    const tagMatch = block.match(/^<([a-z0-9]+)/i);
    const tag = tagMatch[1].toLowerCase();
    if (tag === "p") {
      const inner = block.replace(/^<p[^>]*>/i, "").replace(/<\/p>$/i, "");
      if (/<[a-z]/i.test(inner)) {
        // Contains real formatting (bold/italic/link/image) - leave untouched.
        return { type: "raw", html: block };
      }
      return { type: "text", text: decodeEntities(inner) };
    }
    if (tag === "h1" || tag === "h2") {
      const text = decodeEntities(block.replace(/<[^>]+>/g, ""));
      return { type: "heading", tag, text, html: block };
    }
    return { type: "raw", html: block };
  });
}

function blocksFromPlainText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ type: "text", text: line }));
}

// ---------------------------------------------------------------------------
// Title + body building
// ---------------------------------------------------------------------------

function titleFromFilename(filename) {
  const base = filename.replace(/\.(docx|txt)$/i, "");
  const words = base.replace(/[_-]+/g, " ").trim();
  return words.replace(/\w\S*/g, function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

function extractTitle(blocks, fallbackTitle) {
  if (blocks.length === 0) return { title: fallbackTitle, rest: blocks };
  const first = blocks[0];
  if (first.type === "heading") {
    return { title: plainNormalize(first.text) || fallbackTitle, rest: blocks.slice(1) };
  }
  if (first.type === "text" && first.text.trim()) {
    return { title: plainNormalize(first.text) || fallbackTitle, rest: blocks.slice(1) };
  }
  return { title: fallbackTitle, rest: blocks };
}

// Older automation prompts opened every post with an SEO-brief label line
// ("Search Intent" / "The Compliance Question") and a divider before the
// first paragraph. Neither belongs on the page, so drop them if present.
function stripLeadingLabels(blocks) {
  const out = blocks.slice();
  const isText = (b) => b && b.type === "text";
  while (isText(out[0]) && isDividerLine(out[0].text)) out.shift();
  if (isText(out[0])) {
    const t = plainNormalize(out[0].text);
    if (/^(search intent|the compliance question)$/i.test(t)) {
      out.shift();
      while (isText(out[0]) && isDividerLine(out[0].text)) out.shift();
    } else if (/^search intent\s*:\s*/i.test(t)) {
      out[0] = { type: "text", text: out[0].text.replace(/^\s*search intent\s*:\s*/i, "") };
    }
  }
  return out;
}

function buildBodyHtml(blocks) {
  const output = [];
  let bulletBuffer = [];
  let orderedBuffer = [];
  let sourcesMode = false;
  let sourcesBuffer = [];
  let pendingSourceName = null;

  function flushBullets() {
    if (bulletBuffer.length) {
      output.push(
        "<ul>" + bulletBuffer.map((t) => "<li>" + formatInline(t) + "</li>").join("") + "</ul>"
      );
      bulletBuffer = [];
    }
  }

  function flushOrdered() {
    if (orderedBuffer.length) {
      output.push(
        "<ol>" + orderedBuffer.map((t) => "<li>" + formatInline(t) + "</li>").join("") + "</ol>"
      );
      orderedBuffer = [];
    }
  }

  function flushSources() {
    if (sourcesBuffer.length) {
      output.push(
        '<ul class="sources-list">' +
          sourcesBuffer
            .map(
              (s) =>
                '<li><a href="' +
                escapeHtml(s.url) +
                '" target="_blank" rel="noopener noreferrer">' +
                escapeHtml(s.name) +
                "</a></li>"
            )
            .join("") +
          "</ul>"
      );
      sourcesBuffer = [];
    }
    if (pendingSourceName) {
      output.push("<p>" + escapeHtml(pendingSourceName) + "</p>");
      pendingSourceName = null;
    }
  }

  for (const block of blocks) {
    if (block.type === "raw" || block.type === "heading") {
      flushBullets();
      flushOrdered();
      flushSources();
      sourcesMode = false;
      output.push(block.html);
      continue;
    }

    const text = block.text.trim();
    if (!text) continue;

    if (isDividerLine(text)) {
      flushBullets();
      flushOrdered();
      output.push('<hr class="post-divider">');
      continue;
    }

    if (sourcesMode && isUrlLine(text)) {
      sourcesBuffer.push({ name: pendingSourceName || text, url: text.trim() });
      pendingSourceName = null;
      continue;
    }

    if (isSourcesHeading(text)) {
      flushBullets();
      flushOrdered();
      flushSources();
      output.push("<h2>" + escapeHtml(plainNormalize(text)) + "</h2>");
      sourcesMode = true;
      continue;
    }

    const heading = headingShortcutMatch(text);
    if (heading) {
      flushBullets();
      flushOrdered();
      flushSources();
      sourcesMode = false;
      const tag = "h" + heading.level;
      output.push("<" + tag + ">" + formatInline(heading.text) + "</" + tag + ">");
      continue;
    }

    if (isMostlyStyled(text)) {
      flushBullets();
      flushOrdered();
      flushSources();
      sourcesMode = false;
      output.push("<h2>" + escapeHtml(plainNormalize(text)) + "</h2>");
      continue;
    }

    if (sourcesMode) {
      if (pendingSourceName) {
        output.push("<p>" + escapeHtml(pendingSourceName) + "</p>");
      }
      pendingSourceName = plainNormalize(text);
      continue;
    }

    if (isSpacerShortcut(text)) {
      flushBullets();
      flushOrdered();
      output.push('<div class="post-spacer" aria-hidden="true"></div>');
      continue;
    }

    const caption = captionShortcutMatch(text);
    if (caption !== null) {
      flushBullets();
      flushOrdered();
      output.push('<p class="post-caption">' + formatInline(caption) + "</p>");
      continue;
    }

    if (isBlockquoteShortcut(text)) {
      flushBullets();
      flushOrdered();
      output.push("<blockquote><p>" + formatInline(stripBlockquote(text)) + "</p></blockquote>");
      continue;
    }

    if (isOrderedListLine(text)) {
      flushBullets();
      orderedBuffer.push(stripOrderedMarker(text));
      continue;
    }

    if (isBulletLine(text)) {
      flushOrdered();
      bulletBuffer.push(stripBullet(text));
      continue;
    }

    flushBullets();
    flushOrdered();
    output.push("<p>" + formatInline(text) + "</p>");
  }

  flushBullets();
  flushOrdered();
  flushSources();

  return output.join("\n");
}

// The source docs open with an SEO brief ("Search Intent" on its own line or
// "Search Intent: <query>") and short section labels that come through as
// plain <p>s, so the first <p> is rarely the article's opening. Use the first
// paragraph that reads like prose instead. Hard-wrapped docs turn each line
// into its own <p>, so keep joining lines until one ends a sentence.
function isExcerptCandidate(text) {
  if (/^search intent\b/i.test(text)) return false;
  return text.length >= 60 && /^[A-Z"“]/.test(text);
}

function excerptFromHtml(html, maxLen) {
  const paragraphs = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map((p) =>
    decodeEntities(p.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
  );
  let start = paragraphs.findIndex(isExcerptCandidate);
  if (start === -1) start = paragraphs.findIndex((p) => p && !/^search intent\b/i.test(p));
  let text;
  if (start === -1) {
    text = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  } else {
    text = paragraphs[start];
    for (let i = start + 1; i < paragraphs.length && text.length <= maxLen; i++) {
      if (/[.!?]["”’)]?$/.test(text)) break;
      text += " " + paragraphs[i];
    }
  }
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

// ---------------------------------------------------------------------------
// Page template + post index
//
// buildPostPage() fills in a *real, existing post's HTML* (saved verbatim as
// templates/post-template.html, with the variable parts swapped for
// __TOKEN__ placeholders) rather than re-typing the header/nav/footer as a
// JS string - so a generated post can never drift from the site's actual
// design, and picking up a future header/footer/nav change is just a matter
// of re-saving a fresh post as the template.
// ---------------------------------------------------------------------------

function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "post"
  );
}

function loadPosts() {
  if (!fs.existsSync(POSTS_JSON)) return [];
  const raw = fs.readFileSync(POSTS_JSON, "utf8").trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function savePosts(posts) {
  fs.writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2) + "\n");
}

// Keeps the site-root sitemap.xml in sync with posts.json: drops any
// previously written /blog/ entries and re-adds the blog index plus one
// entry per post, so newly published posts are discoverable by Google.
function updateSitemap(posts) {
  const SITEMAP_PATH = path.join(ROOT, "..", "sitemap.xml");
  if (!fs.existsSync(SITEMAP_PATH)) return;

  const xml = fs.readFileSync(SITEMAP_PATH, "utf8");
  // Handles both one-line and multi-line <url> blocks; the lazy quantifier
  // stops at the nearest </url>, so blocks can't bleed into each other.
  const urlBlocks = xml.match(/[ \t]*<url>[\s\S]*?<\/url>[ \t]*\n?/g) || [];
  const nonBlogBlocks = urlBlocks
    .filter((block) => !block.includes(BLOG_URL + "/"))
    .map((block) => (block.endsWith("\n") ? block : block + "\n"));

  const blogBlocks = [
    `  <url>\n    <loc>${BLOG_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`,
  ];
  for (const post of posts) {
    const lastmod = post.date ? `\n    <lastmod>${post.date}</lastmod>` : "";
    blogBlocks.push(
      `  <url>\n    <loc>${BLOG_URL}/posts/${post.slug}.html</loc>${lastmod}\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`
    );
  }

  const newXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    nonBlogBlocks.join("") +
    blogBlocks.join("") +
    "</urlset>\n";

  fs.writeFileSync(SITEMAP_PATH, newXml);
  console.log("updated sitemap.xml with " + posts.length + " blog post(s)");
}

// Prerenders every post as a plain link inside #posts-list on the blog
// index. blog.js replaces this markup with the paginated list on load, but
// crawlers that don't run JS (and anyone with JS off) need real <a href>s,
// otherwise every post is an orphan page with no internal links to it.
const BLOG_INDEX = path.join(ROOT, "index.html");

function postCardHtml(post) {
  const thumb = post.image
    ? '<img class="post-card-thumb" src="' + escapeHtml(post.image) + '" alt="' + escapeHtml(post.title) + '" loading="lazy" onerror="handleThumbError(this)">'
    : "";
  return (
    '    <a class="post-card" href="posts/' + encodeURIComponent(post.slug) + '.html">' +
    thumb +
    '<div class="post-card-body">' +
    '<div class="post-date">' + escapeHtml(post.dateDisplay || post.date) + "</div>" +
    "<h2>" + escapeHtml(post.title) + "</h2>" +
    "</div></a>\n"
  );
}

function updateBlogIndex(posts) {
  if (!fs.existsSync(BLOG_INDEX)) return;
  const html = fs.readFileSync(BLOG_INDEX, "utf8");
  const listRe = /(<section id="posts-list">)[\s\S]*?(<\/section>)/;
  if (!listRe.test(html)) return;
  const sorted = posts.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const cards = sorted.map(postCardHtml).join("");
  fs.writeFileSync(BLOG_INDEX, html.replace(listRe, (m, open, close) => open + "\n" + cards + "  " + close));
  console.log("updated blog/index.html with " + posts.length + " post link(s)");
}

function uniqueSlug(baseSlug, existingSlugs) {
  let slug = baseSlug;
  let n = 2;
  while (existingSlugs.has(slug)) {
    slug = baseSlug + "-" + n;
    n++;
  }
  return slug;
}

// Ahrefs/Google flag <title>s over 60 characters, and most post titles plus
// the " | stormwaterplanning.us" suffix run 80-130. Keep the suffix only
// when it fits, then fall back to the headline before its colon, then to a
// cut before the last connecting word ("... Before Land Disturbance" ->
// "..."). A post can set "seoTitle" in posts.json to pick its own. The
// on-page <h1>/og:title keep the full title.
const MAX_TITLE_LENGTH = 60;
const TITLE_SUFFIX = " | stormwaterplanning.us";
const CONNECTING_WORD = /^(a|an|and|the|of|to|for|in|on|at|by|with|before|after|across|what|how|that|into|from|or|when|why|about|during|through|between|without|vs\.?)$/i;

function withSuffixIfFits(title) {
  return (title + TITLE_SUFFIX).length <= MAX_TITLE_LENGTH ? title + TITLE_SUFFIX : title;
}

function seoTitle(title) {
  if (title.length <= MAX_TITLE_LENGTH) return withSuffixIfFits(title);
  const head = title.split(":")[0].trim();
  if (head !== title && head.length >= 20 && head.length <= MAX_TITLE_LENGTH) return withSuffixIfFits(head);
  const words = title.slice(0, MAX_TITLE_LENGTH + 1).replace(/\s+\S*$/, "").split(/\s+/);
  let end = words.length;
  for (let i = words.length - 1; i >= 3; i--) {
    if (CONNECTING_WORD.test(words[i])) {
      end = i;
      break;
    }
  }
  while (end > 3 && CONNECTING_WORD.test(words[end - 1])) end--;
  return withSuffixIfFits(words.slice(0, end).join(" "));
}

function postSeoTitle(post) {
  return post.seoTitle || seoTitle(post.title);
}

// Uploaded images arrive as 2-3 MB PNGs straight from an image generator;
// Ahrefs flags anything that large. Resize to the blog's display width and
// re-encode as WebP (typically ~100 KB).
const MAX_IMAGE_WIDTH = 1200;

function optimizeImage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

// Every post links to a few neighbouring posts so none of them depends on
// the blog index as its only internal link. Rewritten across all posts on
// each run so older posts pick up links to newer ones.
const RELATED_START = "<!-- related-posts -->";
const RELATED_END = "<!-- /related-posts -->";
const RELATED_COUNT = 3;

function relatedPostsHtml(post, sorted) {
  const i = sorted.findIndex((p) => p.slug === post.slug);
  const n = sorted.length;
  const picks = [];
  for (const offset of [-1, 1, 2, -2, 3]) {
    const other = sorted[(((i + offset) % n) + n) % n];
    if (other.slug !== post.slug && !picks.includes(other)) picks.push(other);
    if (picks.length === RELATED_COUNT) break;
  }
  return (
    RELATED_START + "\n" +
    '  <section class="post-content related-posts" aria-labelledby="related-posts-heading">\n' +
    '    <h2 id="related-posts-heading">More from the Blog</h2>\n' +
    "    <ul>\n" +
    picks
      .map((p) => '      <li><a href="' + encodeURIComponent(p.slug) + '.html">' + escapeHtml(p.title) + "</a></li>\n")
      .join("") +
    "    </ul>\n" +
    "  </section>\n" +
    "  " + RELATED_END
  );
}

// Applies the title and related-links rules above to every existing post,
// so posts published before a rule existed are brought up to date too.
function refreshPostPages(posts) {
  const sorted = posts.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  for (const post of posts) {
    const file = path.join(POSTS_DIR, post.slug + ".html");
    if (!fs.existsSync(file)) continue;
    let html = fs.readFileSync(file, "utf8");
    // Leave titles that already fit alone (some were hand-shortened).
    html = html.replace(/<title>([\s\S]*?)<\/title>/, (m, current) =>
      post.seoTitle || decodeEntities(current).length > MAX_TITLE_LENGTH
        ? "<title>" + escapeHtml(postSeoTitle(post)) + "</title>"
        : m
    );
    const related = relatedPostsHtml(post, sorted);
    const existing = new RegExp(RELATED_START + "[\\s\\S]*?" + RELATED_END);
    html = existing.test(html)
      ? html.replace(existing, related)
      : html.replace(/(<\/article>\n)/, "$1  " + related + "\n");
    fs.writeFileSync(file, html);
  }
  console.log("refreshed titles and related links on " + posts.length + " post(s)");
}

function buildPostPage(title, dateDisplay, isoDate, bodyHtml, imagePath, slug, description) {
  const template = fs.readFileSync(TEMPLATE_FILE, "utf8");
  const shareImageUrl = imagePath ? SITE_URL + "/blog/" + imagePath : SITE_URL + "/images/spct-logo.png";
  const canonicalUrl = BLOG_URL + "/posts/" + slug + ".html";
  const imageRel = imagePath ? "../" + imagePath : "";

  return template
    .split("__SHARE_IMAGE_URL__").join(shareImageUrl)
    .split("__CANONICAL_URL__").join(canonicalUrl)
    .split("__IMAGE_REL__").join(imageRel)
    .split("__DESCRIPTION__").join(escapeHtml(description))
    .split("__TITLE__").join(title)
    .split("__ISO_DATE__").join(isoDate)
    .split("__DATE_DISPLAY__").join(dateDisplay)
    .split("__BODY__").join(bodyHtml);
}

// ---------------------------------------------------------------------------
// Per-file conversion
// ---------------------------------------------------------------------------

// A zip upload may contain OS cruft alongside the real document/image
// (e.g. "__MACOSX/" entries or ".DS_Store" from a Mac zip) - ignore those.
function isJunkEntry(entryName) {
  const base = path.basename(entryName);
  return entryName.startsWith("__MACOSX/") || base === ".DS_Store" || base.startsWith("._");
}

function convertZip(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory && !isJunkEntry(e.entryName));

  const docEntry = entries.find((e) =>
    DOC_EXTENSIONS.includes(path.extname(e.entryName).toLowerCase())
  );
  const imageEntry = entries.find((e) =>
    IMAGE_EXTENSIONS.includes(path.extname(e.entryName).toLowerCase())
  );

  if (!docEntry) {
    return Promise.reject(
      new Error("Zip file does not contain a .docx or .txt document: " + filePath)
    );
  }

  const docExt = path.extname(docEntry.entryName).toLowerCase();
  const docBuffer = docEntry.getData();

  const blocksPromise =
    docExt === ".docx"
      ? mammoth.convertToHtml({ buffer: docBuffer }).then((result) => {
          if (result.messages && result.messages.length) {
            result.messages.forEach((m) => console.log("  [mammoth] " + m.type + ": " + m.message));
          }
          return blocksFromMammothHtml(result.value);
        })
      : Promise.resolve(blocksFromPlainText(docBuffer.toString("utf8")));

  return blocksPromise.then((blocks) => {
    const image = imageEntry
      ? { buffer: imageEntry.getData(), ext: path.extname(imageEntry.entryName).toLowerCase() }
      : null;
    return { blocks, image };
  });
}

function convertFile(filePath, filename) {
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".zip") {
    return convertZip(filePath);
  }

  if (ext === ".docx") {
    return mammoth.convertToHtml({ path: filePath }).then((result) => {
      if (result.messages && result.messages.length) {
        result.messages.forEach((m) => console.log("  [mammoth] " + m.type + ": " + m.message));
      }
      const blocks = blocksFromMammothHtml(result.value);
      return { blocks, image: null };
    });
  }

  if (ext === ".txt") {
    const text = fs.readFileSync(filePath, "utf8");
    return Promise.resolve({ blocks: blocksFromPlainText(text), image: null });
  }

  return Promise.reject(new Error("Unsupported file type: " + ext));
}

function main() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log("No uploads directory found, nothing to do.");
    return;
  }
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.mkdirSync(POSTS_DIR, { recursive: true });

  const files = fs
    .readdirSync(UPLOADS_DIR)
    .filter((f) => SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    console.log("No new documents to convert.");
    return;
  }

  const posts = loadPosts();
  const existingSlugs = new Set(posts.map((p) => p.slug));

  const today = new Date();
  const isoDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const dateDisplay = today.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  files
    .reduce((chain, filename) => {
      return chain.then(() => {
        const filePath = path.join(UPLOADS_DIR, filename);
        console.log("Converting " + filename + " ...");
        return convertFile(filePath, filename).then(({ blocks, image }) => {
          const { title, rest } = extractTitle(blocks, titleFromFilename(filename));
          const bodyHtml = buildBodyHtml(stripLeadingLabels(rest));

          const baseSlug = slugify(title);
          const slug = uniqueSlug(baseSlug, existingSlugs);
          existingSlugs.add(slug);

          const imagePromise = image
            ? optimizeImage(image.buffer).then((webp) => {
                fs.mkdirSync(POST_IMAGES_DIR, { recursive: true });
                const rel = "assets/img/posts/" + slug + ".webp";
                fs.writeFileSync(path.join(ROOT, rel), webp);
                return rel;
              })
            : Promise.resolve(null);

          return imagePromise.then((imagePath) => {
          const excerpt = excerptFromHtml(bodyHtml, 160);
          const description = excerpt || title + " - Stormwater Planning Training Blog.";
          const pageHtml = buildPostPage(title, dateDisplay, isoDate, bodyHtml, imagePath, slug, description);
          fs.writeFileSync(path.join(POSTS_DIR, slug + ".html"), pageHtml);

          posts.push({
            title: title,
            slug: slug,
            image: imagePath,
            date: isoDate,
            dateDisplay: dateDisplay,
            excerpt: excerpt,
          });

          fs.renameSync(filePath, path.join(PROCESSED_DIR, filename));
          console.log("  -> posts/" + slug + ".html");
          });
        });
      });
    }, Promise.resolve())
    .then(() => {
      savePosts(posts);
      updateSitemap(posts);
      updateBlogIndex(posts);
      refreshPostPages(posts);
      console.log("Done. " + files.length + " post(s) published.");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = { buildPostPage, updateSitemap, updateBlogIndex, refreshPostPages, optimizeImage, seoTitle, loadPosts, savePosts, excerptFromHtml };
