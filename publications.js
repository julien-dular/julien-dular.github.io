(function () {
  "use strict";

  const YAML_PATH = "data/publications.yaml";

  function countPublications(categories) {
    return categories.reduce((sum, cat) => sum + (cat.items || []).length, 0);
  }

  function getMainPublications(categories) {
    const flat = categories.flatMap((cat) =>
      (cat.items || []).map((item) => ({ ...item, categoryTitle: cat.title }))
    );

    return flat.filter((pub) => pub.main === true).sort((a, b) => b.year - a.year);
  }

  function isMainFilterEnabled(container) {
    return container.getAttribute("data-main") === "true";
  }

  function renderPublicationLinks(links) {
    if (!links || links.length === 0) return "";

    const anchors = links
      .map(
        (link) =>
          `<a href="${link.url}"${link.url.startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a>`
      )
      .join("");

    return `<div class="pub-links">${anchors}</div>`;
  }

  function renderPublication(pub) {
    return `
      <li class="publication">
        <span class="pub-year">${pub.year}</span>
        <div class="pub-content">
          <p class="pub-title">${pub.title}</p>
          <p class="pub-authors">${pub.authors}</p>
          <p class="pub-venue">${pub.venue}</p>
          ${renderPublicationLinks(pub.links)}
        </div>
      </li>`;
  }

  function renderPublicationCategory(category, isFirst) {
    const divider = isFirst ? "" : '<hr class="publication-divider">';
    const items = (category.items || [])
      .map((pub) => renderPublication(pub))
      .join("");

    return `
      ${divider}
      <h3 class="subsection-title" id="${category.id}">${category.title}</h3>
      <ol class="publication-list">${items}</ol>`;
  }

  function renderPreviewList(publications) {
    return `<ol class="publication-list">${publications.map((pub) => renderPublication(pub)).join("")}</ol>`;
  }

  function renderShowAllLink(total) {
    return `<p class="publications-show-all"><a href="publications.html" class="btn btn-secondary">Show all ${total} publications →</a></p>`;
  }

  async function loadPublications(container) {
    const mainOnly = isMainFilterEnabled(container);
    const grouped = container.getAttribute("data-grouped") === "true";
    const showAll = container.getAttribute("data-show-all") === "true";

    try {
      const response = await fetch(YAML_PATH);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = jsyaml.load(await response.text());
      const categories = data.categories || [];
      const total = countPublications(categories);

      if (grouped) {
        container.innerHTML = categories
          .map((category, index) => renderPublicationCategory(category, index === 0))
          .join("");
      } else if (mainOnly) {
        const preview = getMainPublications(categories);
        container.innerHTML = preview.length
          ? renderPreviewList(preview)
          : '<p class="section-intro">No main publications are marked yet.</p>';

        if (showAll && total > preview.length) {
          container.insertAdjacentHTML("beforeend", renderShowAllLink(total));
        }
      } else {
        const flat = categories.flatMap((cat) => cat.items || []);
        container.innerHTML = renderPreviewList(flat);
      }

      return { categories, total, grouped };
    } catch (error) {
      console.error("Failed to load publications:", error);
      container.innerHTML =
        '<p class="section-intro">Publications could not be loaded. Run a local server (<code>python3 -m http.server 8000</code>) and open the site from <code>http://localhost:8000</code>.</p>';
      return null;
    }
  }

  window.loadPublications = loadPublications;
})();
