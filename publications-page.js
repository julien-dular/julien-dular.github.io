(function () {
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  const navToggle = document.querySelector(".nav-toggle");
  const navMenu = document.querySelector(".nav-menu");

  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", isOpen);
  });

  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navMenu.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  // Opens a collapsed category at once, so that the browser can scroll to it
  function revealCategory(id) {
    const heading = id && document.getElementById(id);
    const category = heading && heading.closest(".publication-category");

    if (category && !category.open) {
      category.classList.add("no-transition");
      category.open = true;
      void category.offsetHeight;
      category.classList.remove("no-transition");
    }

    return heading;
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link) revealCategory(link.hash.slice(1));
  });

  window.addEventListener("hashchange", () => revealCategory(location.hash.slice(1)));

  const container = document.getElementById("publications-container");

  loadPublications(container).then((result) => {
    if (!result || !result.grouped) return;

    // The list loads after the page, so links to a category need this final jump
    const target = revealCategory(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: "instant" });
  });
})();
