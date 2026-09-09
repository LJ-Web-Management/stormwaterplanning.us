var PAGE_SIZE = 20;
var allPosts = [];
var currentPage = 1;
var searchInput = document.getElementById("search-input");
var sortSelect = document.getElementById("sort-select");

fetch("posts.json", { cache: "no-store" })
  .then(function (res) {
    if (!res.ok) throw new Error("Could not load posts.json");
    return res.json();
  })
  .then(function (posts) {
    allPosts = posts || [];
    renderPosts();
  })
  .catch(function () {
    allPosts = [];
    renderPosts();
  });

if (searchInput) {
  searchInput.addEventListener("input", function () {
    currentPage = 1;
    renderPosts();
  });
}

if (sortSelect) {
  sortSelect.addEventListener("change", function () {
    currentPage = 1;
    renderPosts();
  });
}

function renderPosts() {
  var container = document.getElementById("posts-list");
  var pagination = document.getElementById("pagination");
  if (!container) return;

  if (allPosts.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No blog posts found.</div>';
    if (pagination) pagination.innerHTML = "";
    return;
  }

  var query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  var posts = allPosts.filter(function (post) {
    return (
      (post.title || "").toLowerCase().indexOf(query) !== -1 ||
      (post.excerpt || "").toLowerCase().indexOf(query) !== -1
    );
  });

  if (sortSelect) {
    posts.sort(getComparator(sortSelect.value));
  }

  if (posts.length === 0) {
    container.innerHTML = '<div class="empty-state">No posts match your search.</div>';
    if (pagination) pagination.innerHTML = "";
    return;
  }

  var totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  var start = (currentPage - 1) * PAGE_SIZE;
  var pagePosts = posts.slice(start, start + PAGE_SIZE);

  container.innerHTML = pagePosts
    .map(function (post) {
      var thumb = post.image
        ? '<img class="post-card-thumb" src="' + escapeHtml(post.image) + '" alt="' + escapeHtml(post.title) + '" loading="lazy" onerror="handleThumbError(this)">'
        : brokenThumbHtml();
      return (
        '<a class="post-card" href="posts/' + encodeURIComponent(post.slug) + '.html">' +
        thumb +
        '<div class="post-card-body">' +
        '<div class="post-date">' + escapeHtml(post.dateDisplay || post.date) + '</div>' +
        '<h2>' + escapeHtml(post.title) + '</h2>' +
        '</div>' +
        '</a>'
      );
    })
    .join("");

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  var pagination = document.getElementById("pagination");
  if (!pagination) return;

  if (totalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  var pages = getPageRange(currentPage, totalPages);
  var html = '<ul class="pagination-list">';

  html +=
    '<li><button type="button" class="pagination-arrow" data-page="' +
    (currentPage - 1) +
    '"' +
    (currentPage === 1 ? " disabled" : "") +
    ' aria-label="Previous page"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button></li>';

  pages.forEach(function (p) {
    if (p === "...") {
      html += '<li class="pagination-ellipsis">&hellip;</li>';
    } else {
      html +=
        '<li><button type="button" data-page="' +
        p +
        '"' +
        (p === currentPage ? ' class="active"' : "") +
        ' aria-label="Page ' +
        p +
        '">' +
        p +
        "</button></li>";
    }
  });

  html +=
    '<li><button type="button" class="pagination-arrow" data-page="' +
    (currentPage + 1) +
    '"' +
    (currentPage === totalPages ? " disabled" : "") +
    ' aria-label="Next page"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button></li>';

  html += "</ul>";
  pagination.innerHTML = html;

  var buttons = pagination.querySelectorAll("button[data-page]");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = parseInt(btn.getAttribute("data-page"), 10);
      if (target >= 1 && target <= totalPages && target !== currentPage) {
        currentPage = target;
        renderPosts();
        var main = document.getElementById("main");
        if (main) main.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
}

function getPageRange(current, total) {
  if (total <= 7) {
    var all = [];
    for (var i = 1; i <= total; i++) all.push(i);
    return all;
  }
  if (current <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (current >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
}

function getComparator(sortVal) {
  switch (sortVal) {
    case "date-asc":
      return function (a, b) {
        return (a.date || "").localeCompare(b.date || "");
      };
    case "title-asc":
      return function (a, b) {
        return (a.title || "").localeCompare(b.title || "");
      };
    case "title-desc":
      return function (a, b) {
        return (b.title || "").localeCompare(a.title || "");
      };
    case "date-desc":
    default:
      return function (a, b) {
        return (b.date || "").localeCompare(a.date || "");
      };
  }
}

function handleThumbError(img) {
  var parent = img.parentNode;
  if (!parent) return;
  var badge = document.createElement("div");
  badge.className = "post-card-thumb--empty";
  badge.innerHTML = brokenThumbSvg();
  parent.replaceChild(badge, img);
}

function brokenThumbHtml() {
  return '<div class="post-card-thumb--empty">' + brokenThumbSvg() + "</div>";
}

function brokenThumbSvg() {
  return '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
