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

  const publicationIds = [
    "first-author",
    "second-author",
    "oral-presentations",
    "posters",
  ];
  const navLinks = document.querySelectorAll(".nav-menu a");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute("id");
          navLinks.forEach((link) => {
            const href = link.getAttribute("href");
            link.classList.toggle(
              "active",
              href === `#${id}` || (id === "publications" && href === "publications.html")
            );
          });
        }
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );

  const container = document.getElementById("publications-container");

  loadPublications(container).then((result) => {
    if (!result || !result.grouped) return;

    document
      .querySelectorAll(".subsection-title[id]")
      .forEach((heading) => observer.observe(heading));
  });

  observer.observe(document.getElementById("publications"));
})();
