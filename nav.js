// Floating navigation: gliding highlight, compact state on scroll, and closing the mobile menu.
(function () {
  "use strict";

  const header = document.querySelector(".site-header");
  const nav = document.querySelector(".nav");
  const menu = document.querySelector(".nav-menu");
  const toggle = document.querySelector(".nav-toggle");

  if (!header || !nav || !menu) return;

  const items = Array.from(menu.children);
  const mobile = window.matchMedia("(max-width: 768px)");
  const indicator = document.createElement("span");
  let highlighted = null;

  indicator.className = "nav-indicator";
  indicator.setAttribute("aria-hidden", "true");
  nav.appendChild(indicator);

  function placeIndicator() {
    const item = highlighted || items.find((li) => li.querySelector("a.active"));
    const link = item && item.querySelector(":scope > a");

    if (!link || mobile.matches) {
      indicator.classList.remove("is-visible");
      return;
    }

    const wasHidden = !indicator.classList.contains("is-visible");
    const navBox = nav.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();

    // Appear in place the first time, and glide from then on
    if (wasHidden) indicator.classList.add("no-slide");
    indicator.style.width = `${linkBox.width}px`;
    indicator.style.transform = `translate(${linkBox.left - navBox.left - nav.clientLeft}px, -50%)`;
    indicator.classList.add("is-visible");

    if (wasHidden) {
      void indicator.offsetWidth;
      indicator.classList.remove("no-slide");
    }
  }

  items.forEach((item) => {
    item.addEventListener("pointerenter", () => {
      highlighted = item;
      placeIndicator();
    });
    item.addEventListener("focusin", () => {
      highlighted = item;
      placeIndicator();
    });
  });

  menu.addEventListener("pointerleave", () => {
    if (menu.contains(document.activeElement)) return;
    highlighted = null;
    placeIndicator();
  });

  menu.addEventListener("focusout", (event) => {
    if (menu.contains(event.relatedTarget)) return;
    highlighted = null;
    placeIndicator();
  });

  // The page scripts mark the current section with the "active" class
  new MutationObserver(placeIndicator).observe(menu, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  window.addEventListener("resize", placeIndicator);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeIndicator);
  placeIndicator();

  function updateScrolled() {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  window.addEventListener("scroll", updateScrolled, { passive: true });
  updateScrolled();

  function closeMobileMenu() {
    menu.classList.remove("open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  document.addEventListener("click", (event) => {
    if (menu.classList.contains("open") && !nav.contains(event.target)) closeMobileMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("open")) {
      closeMobileMenu();
      if (toggle) toggle.focus();
    }
  });
})();
