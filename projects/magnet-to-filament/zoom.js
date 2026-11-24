// Scroll-driven zoom through nested figures, from a whole magnet down to one filament.
(function () {
  "use strict";

  const root = document.querySelector(".mtf");
  const track = document.getElementById("mtf-track");
  if (!root || !track) return;

  const stage = track.querySelector(".mtf-stage");
  const world = stage.querySelector(".mtf-world");
  const cards = Array.from(stage.querySelectorAll(".mtf-card"));
  const railButtons = Array.from(stage.querySelectorAll(".mtf-rail button"));
  const scaleValue = stage.querySelector(".mtf-scale-value");
  const rail = stage.querySelector(".mtf-rail");

  // Bottom menu: a pill that slides between the scales, and lines that fill up between them
  const railPill = document.createElement("span");
  railPill.className = "mtf-rail-pill";
  railPill.setAttribute("aria-hidden", "true");
  rail.prepend(railPill);
  const railLines = railButtons.slice(0, -1).map((button) => {
    const line = document.createElement("span");
    const fill = document.createElement("span");
    line.className = "mtf-rail-line";
    line.setAttribute("aria-hidden", "true");
    line.appendChild(fill);
    button.after(line);
    return fill;
  });
  let railStops = [];

  // Scroll prompts, which glide to the magnet when clicked; the cue fades out as soon as the zoom starts
  const hint = stage.querySelector(".mtf-hint");
  const cue = document.createElement("button");
  cue.type = "button";
  cue.className = "mtf-cue";
  cue.setAttribute("aria-label", "Scroll down to zoom in");
  cue.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5.5l5 5 5-5M5 10.5l5 5 5-5"/></svg>';
  stage.appendChild(cue);
  let cueOpacity = -1;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const IMG = "magnet-to-filament/img/";

  // Each figure is placed inside its parent: the "anchor" pixel of the figure lands on the
  // "at" pixel of the parent, and one figure pixel covers "scale" parent pixels.
  const LAYERS = {
    photo: { src: "../assets/photo.jpg", w: 1920, h: 1440, level: 0 },
    // Real LHC dipole aperture, coloured by its field map; the cable zoom enters an outer-layer midplane turn
    magnet: {
      src: IMG + "magnet.webp", w: 1600, h: 1600, level: 1, portal: true,
      parent: "photo", anchor: [797, 809], at: [973, 788], scale: 0.0547,
    },
    // Cable and strand figures are static fallbacks of the live simulations drawn by sim-view.js
    cableHom: {
      src: IMG + "cable-hom.webp", w: 2400, h: 507, level: 2, conceal: 2, sim: true,
      parent: "magnet", anchor: [1202, 308], at: [1417.1, 797.1], scale: 0.0901,
    },
    cableRes: {
      src: IMG + "cable-res.webp", w: 2400, h: 507, level: 2, reveal: 2, sim: true,
      parent: "magnet", anchor: [1202, 308], at: [1417.1, 797.1], scale: 0.0901,
    },
    strandHom: {
      src: IMG + "strand-hom.webp", w: 1800, h: 1602, level: 3, conceal: 4, sim: true,
      parent: "cableHom", anchor: [902, 900], at: [1594.3, 258.6], scale: 0.0861,
    },
    strandRes: {
      src: IMG + "strand-res.webp", w: 1800, h: 1602, level: 3, reveal: 4, persist: true, sim: true,
      parent: "cableHom", anchor: [902, 900], at: [1594.3, 258.6], scale: 0.0861,
    },
  };

  // What the camera frames at each depth, in pixels of the given figure
  const VIEWS = [
    { layer: "photo", rect: [0, 0, 1920, 1440], cover: true, focus: [1010, 760] },
    { layer: "magnet", rect: [85, 248, 1510, 1371] },
    { layer: "cableHom", rect: [150, 150, 2254, 466], reserve: true },
    { layer: "strandHom", rect: [232, 230, 1572, 1570], reserve: true },
    { layer: "strandRes", rect: [958, 580, 1120, 742], reserve: true },
  ];

  // One stop per text card
  const STOPS = [0, 1, 2, 2, 3, 3, 4];
  const LAST = STOPS.length - 1;

  // Typical width of what is in view at each depth, in metres
  const SIZES = [3, 0.1, 0.01, 0.001, 0.000076];

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Dot lattice behind the figures: it spreads as the camera zooms in, and finer dots fade in between
  const dots = ["mtf-dots", "mtf-dots mtf-dots-fine"].map((className) => {
    const element = document.createElement("div");
    element.className = className;
    world.appendChild(element);
    return element;
  });

  Object.keys(LAYERS).forEach((key) => {
    const layer = LAYERS[key];
    const parent = layer.parent && LAYERS[layer.parent];

    layer.sc = parent ? parent.sc * layer.scale : 1;
    layer.ox = parent ? parent.ox + layer.at[0] * parent.sc - layer.anchor[0] * layer.sc : 0;
    layer.oy = parent ? parent.oy + layer.at[1] * parent.sc - layer.anchor[1] * layer.sc : 0;

    const img = document.createElement("img");
    img.src = layer.src;
    img.alt = "";
    img.width = layer.w;
    img.height = layer.h;
    img.draggable = false;
    if (layer.portal) img.className = "is-portal";
    world.appendChild(img);
    // Decode ahead of time, so that no figure flashes blank when the zoom reaches it
    img.decode().catch(() => {});
    layer.el = img;
    layer.opacity = -1;
  });

  root.classList.add("is-enhanced");

  let width = 0;
  let height = 0;
  let cameras = [];

  function freeArea() {
    if (width <= 820) {
      return { left: 12, right: width - 12, top: 132, bottom: height * 0.53 };
    }
    const card = cards[1];
    return {
      left: card.offsetLeft + card.offsetWidth + 28,
      right: width - 28,
      top: 92,
      bottom: height - 88,
    };
  }

  function measure() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    railStops = railButtons.map((button) => ({ x: button.offsetLeft, w: button.offsetWidth }));
    const free = freeArea();
    const freeX = (free.left + free.right) / 2;
    if (simView) simView.resize(width, height);
    simBar.style.left = `${freeX}px`;
    simBar.style.top = `${free.bottom - SIM_RESERVE + 8}px`;

    cameras = VIEWS.map((view) => {
      const layer = LAYERS[view.layer];
      const x0 = layer.ox + view.rect[0] * layer.sc;
      const y0 = layer.oy + view.rect[1] * layer.sc;
      const w = (view.rect[2] - view.rect[0]) * layer.sc;
      const h = (view.rect[3] - view.rect[1]) * layer.sc;

      if (view.cover) {
        const s = Math.max(width / w, height / h);
        const halfW = width / (2 * s);
        const halfH = height / (2 * s);
        return {
          s,
          x: clamp(view.focus[0], x0 + halfW, x0 + w - halfW),
          y: clamp(view.focus[1], y0 + halfH, y0 + h - halfH),
        };
      }

      const bottom = view.reserve ? free.bottom - SIM_RESERVE : free.bottom;
      const freeY = (free.top + bottom) / 2;
      const s = Math.min((free.right - free.left) / w, (bottom - free.top) / h);
      return {
        s,
        x: x0 + w / 2 + (width / 2 - freeX) / s,
        y: y0 + h / 2 + (height / 2 - freeY) / s,
      };
    });
  }

  // Exponential zoom, with the camera drifting so that the target grows smoothly into place
  function cameraAt(a, b, e) {
    if (a === b || e <= 0) return cameras[a];
    if (e >= 1) return cameras[b];
    const A = cameras[a];
    const B = cameras[b];
    const s = Math.exp(Math.log(A.s) * (1 - e) + Math.log(B.s) * e);
    const t = (1 / s - 1 / A.s) / (1 / B.s - 1 / A.s);
    return { s, x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  }

  function formatSize(metres) {
    if (metres >= 1) return `${metres.toPrecision(2).replace(/\.0$/, "")} m`;
    if (metres >= 0.01) return `${Math.round(metres * 100)} cm`;
    if (metres >= 0.001) return `${(metres * 1000).toPrecision(2).replace(/\.0$/, "")} mm`;
    const um = metres * 1e6;
    return `${um >= 100 ? Math.round(um / 10) * 10 : Math.round(um)} µm`;
  }

  function render(rawPosition) {
    const position = reduceMotion.matches ? Math.round(rawPosition) : rawPosition;
    const i = Math.min(Math.floor(position), LAST - 1);
    const f = position - i;
    const e = smooth(0.07, 0.93, f);
    const a = STOPS[i];
    const b = STOPS[i + 1];
    const depth = a === b ? a : a + (b - a) * e;
    const base = Math.min(Math.floor(depth), 3);
    const frac = depth - base;
    const camera = cameraAt(a, b, e);

    const cueShown = clamp(1 - rawPosition / 0.25, 0, 1);
    if (cueShown !== cueOpacity) {
      cue.style.opacity = cueShown;
      cue.style.visibility = cueShown > 0.01 ? "visible" : "hidden";
      cueOpacity = cueShown;
    }

    Object.keys(LAYERS).forEach((key) => {
      const layer = LAYERS[key];
      let opacity = 0;

      if (layer.level === base) opacity = layer.persist ? 1 : 1 - smooth(0.9, 1, frac);
      if (layer.level === base + 1) opacity = smooth(0.55, 0.9, frac);
      if (layer.reveal !== undefined) {
        const shown = i > layer.reveal ? 1 : i === layer.reveal ? e : 0;
        opacity *= shown;
      }
      // A homogenized block fades out while its resolved version fades in
      if (layer.conceal !== undefined) {
        const shown = i > layer.conceal ? 1 : i === layer.conceal ? e : 0;
        opacity *= 1 - shown;
      }

      if (Math.abs(opacity - layer.opacity) > 0.001) {
        layer.el.style.opacity = opacity;
        layer.el.style.visibility = opacity > 0.001 ? "visible" : "hidden";
        layer.opacity = opacity;
      }

      if (opacity > 0.001) {
        const m = camera.s * layer.sc;
        const tx = (layer.ox - camera.x) * camera.s + width / 2;
        const ty = (layer.oy - camera.y) * camera.s + height / 2;
        layer.el.style.transform = `matrix(${m}, 0, 0, ${m}, ${tx}, ${ty})`;
      }
    });

    if (simView) {
      const opacity = {};
      simKeys.forEach((key) => {
        opacity[key] = simReady ? Math.max(LAYERS[key].opacity, 0) : 0;
      });
      simView.update({ camera, layers: LAYERS, width, height, opacity, mesh: smooth(3.45, 3.95, depth) });
      const barOpacity = Math.max(...simKeys.map((key) => opacity[key]));
      simBar.style.opacity = barOpacity;
      simBar.style.visibility = barOpacity > 0.05 ? "visible" : "hidden";
      showSimScale(opacity.strandRes > 0.5 ? "critical" : "average");
    }

    // The magnet disc hides the photo while it opens, then dissolves into the page background
    LAYERS.magnet.el.style.backgroundColor = `rgba(247, 247, 248, ${Math.max(LAYERS.photo.opacity, 0)})`;

    const octaves = Math.log2(camera.s / cameras[0].s) * 0.35;
    const g = octaves - Math.floor(octaves);
    dots.forEach((element) => {
      element.style.transform = `scale(${2 ** g})`;
    });
    dots[1].style.opacity = g;

    cards.forEach((card, index) => {
      const distance = Math.abs(position - index);
      const opacity = 1 - smooth(0.3, 0.42, distance);
      const direction = position < index ? 1 : -1;
      card.style.opacity = opacity;
      card.style.visibility = opacity > 0.01 ? "visible" : "hidden";
      card.style.setProperty("--shift", `${(1 - opacity) * 14 * direction}px`);
    });

    const level = Math.round(depth);
    railButtons.forEach((button) => {
      const buttonLevel = Number(button.dataset.level);
      const isCurrent = buttonLevel === level;
      button.classList.toggle("is-current", isCurrent);
      if (isCurrent) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    railLines.forEach((fill, index) => {
      fill.style.transform = `scaleX(${clamp(depth - (index + 1), 0, 1)})`;
    });
    if (railStops.length) {
      const from = clamp(Math.floor(depth), 1, railStops.length) - 1;
      const to = Math.min(from + 1, railStops.length - 1);
      const t = clamp(depth - (from + 1), 0, 1);
      const x = railStops[from].x + (railStops[to].x - railStops[from].x) * t;
      const w = railStops[from].w + (railStops[to].w - railStops[from].w) * t;
      railPill.style.width = `${w}px`;
      railPill.style.transform = `translateX(${x}px)`;
      railPill.style.opacity = clamp(depth, 0, 1);
      rail.style.setProperty("--on", clamp(depth, 0, 1));
      // Each label turns white exactly where the pill passes behind it
      railButtons.forEach((button, index) => {
        const stopBox = railStops[index];
        button.style.setProperty("--a", `${clamp((x - stopBox.x) / stopBox.w, 0, 1) * 100}%`);
        button.style.setProperty("--b", `${clamp((x + w - stopBox.x) / stopBox.w, 0, 1) * 100}%`);
      });
    }

    const d0 = Math.min(Math.floor(depth), SIZES.length - 2);
    const size = Math.exp(
      Math.log(SIZES[d0]) * (1 - (depth - d0)) + Math.log(SIZES[d0 + 1]) * (depth - d0)
    );
    scaleValue.textContent = `≈ ${formatSize(size)}`;
  }

  function scrollRange() {
    return track.offsetHeight - stage.offsetHeight;
  }

  function update() {
    const progress = clamp(-track.getBoundingClientRect().top / scrollRange(), 0, 1);
    render(progress * LAST);
  }

  // Clicking a scale glides there slowly, and any manual scroll takes back control
  let glide = 0;

  function stopGlide() {
    cancelAnimationFrame(glide);
    glide = 0;
  }

  function glideTo(stop) {
    stopGlide();
    const from = window.scrollY;
    const to = from + track.getBoundingClientRect().top + (stop / LAST) * scrollRange();
    if (reduceMotion.matches) {
      window.scrollTo({ top: to, behavior: "instant" });
      return;
    }
    const steps = Math.abs(to - from) / (scrollRange() / LAST);
    const duration = clamp(650 + 750 * steps, 1400, 4600);
    const start = performance.now();

    function step(now) {
      const p = clamp((now - start) / duration, 0, 1);
      const eased = 0.5 - Math.cos(Math.PI * p) / 2;
      window.scrollTo({ top: from + (to - from) * eased, behavior: "instant" });
      glide = p < 1 ? requestAnimationFrame(step) : 0;
    }

    glide = requestAnimationFrame(step);
  }

  railButtons.forEach((button) => {
    button.addEventListener("click", () => glideTo(Number(button.dataset.stop)));
  });
  [hint, cue].forEach((prompt) => {
    if (prompt) prompt.addEventListener("click", () => glideTo(1));
  });
  ["wheel", "touchstart", "pointerdown", "keydown"].forEach((type) => {
    window.addEventListener(type, stopGlide, { passive: true });
  });

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", () => {
    measure();
    update();
  });
  reduceMotion.addEventListener("change", update);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measure();
      update();
    });
  }

  // Live FiQuS simulations of the cable and the strand, drawn on top of the figures
  const SIM_RESERVE = 50;
  const DATA = "magnet-to-filament/data/";
  const CABLE_PLACE = { cx: 1202, cy: 308, pxPerMm: 157 };
  const STRAND_PLACE = { cx: 902, cy: 900, pxPerMm: 1580 };
  const SIM_SETS = {
    cableHom: { url: DATA + "cable-hom.bin", place: CABLE_PLACE, outline: 0.6 },
    cableRes: { url: DATA + "cable-res.bin", place: CABLE_PLACE, outline: 0.55 },
    strandHom: { url: DATA + "strand-hom.bin", place: STRAND_PLACE, outline: 0.75 },
    strandRes: { url: DATA + "strand-discharge.bin", place: STRAND_PLACE, outline: 0.72, mesh: true },
  };
  const simKeys = Object.keys(SIM_SETS);
  const simCanvas = document.createElement("canvas");
  world.appendChild(simCanvas);
  const simBar = document.createElement("div");
  simBar.className = "mtf-sim";
  simBar.innerHTML = `
    <button type="button"></button>
    <span class="mtf-sim-time"><span class="mtf-sim-label"></span><span class="mtf-sim-progress"><span></span></span></span>
    <span class="mtf-sim-scale"><span class="mtf-sim-caption"></span><span class="mtf-sim-row"><span class="mtf-sim-min"></span><span class="mtf-sim-colors"></span><span class="mtf-sim-max"></span></span></span>`;
  stage.appendChild(simBar);
  const simButton = simBar.querySelector("button");
  const simLabel = simBar.querySelector(".mtf-sim-label");
  const simProgress = simBar.querySelector(".mtf-sim-progress span");
  const simScale = simBar.querySelector(".mtf-sim-scale");
  const simMin = simBar.querySelector(".mtf-sim-min");
  const simMax = simBar.querySelector(".mtf-sim-max");
  const simCaption = simBar.querySelector(".mtf-sim-caption");
  const PAUSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.4" y="1.8" width="2.6" height="8.4" rx="0.6"/><rect x="7" y="1.8" width="2.6" height="8.4" rx="0.6"/></svg>';
  const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 1.7v8.6c0 .4.4.6.7.4l6.3-4.3c.3-.2.3-.6 0-.8L3.9 1.3c-.3-.2-.7 0-.7.4z"/></svg>';
  // Colour scales: current relative to its average before the discharge (cable), or to the critical current (strand)
  const SCALES = {
    average: {
      caption: "Current density, &times; its average before the discharge",
      short: "Current density / initial average",
      min: "&minus;4.5&times;",
      max: "+4.5&times;",
      title: "Current density, as a multiple of the cable's average current density before the discharge. Red flows along the transport current, blue against it.",
    },
    critical: {
      caption: "Current density, relative to the critical value J<sub>c</sub>",
      short: "Current density / J<sub>c</sub>",
      min: "&minus;J<sub>c</sub>",
      max: "+J<sub>c</sub>",
      title: "Current density relative to the critical current density of the superconductor. Red flows along the transport current, blue against it.",
    },
  };
  let simScaleKey = "";
  let simReady = false;

  function showSimButton(playing) {
    simButton.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    simButton.setAttribute("aria-label", playing ? "Pause the discharge animation" : "Play the discharge animation");
  }

  function showSimScale(key) {
    if (key === simScaleKey) return;
    simScaleKey = key;
    simMin.innerHTML = SCALES[key].min;
    simMax.innerHTML = SCALES[key].max;
    simCaption.innerHTML = `<span class="mtf-sim-long">${SCALES[key].caption}</span><span class="mtf-sim-short">${SCALES[key].short}</span>`;
    simScale.title = SCALES[key].title;
  }

  const simView = window.createSimView
    ? window.createSimView({
        canvas: simCanvas,
        sets: SIM_SETS,
        reduceMotion,
        onReady() {
          simReady = true;
          simKeys.forEach((key) => {
            LAYERS[key].el.style.display = "none";
          });
          measure();
          update();
        },
        onLost() {
          simReady = false;
          simKeys.forEach((key) => {
            LAYERS[key].el.style.display = "";
          });
          simBar.style.visibility = "hidden";
          simCanvas.style.visibility = "hidden";
        },
        onTime({ ms, tesla, progress }) {
          simLabel.textContent = `${ms < 0.5 ? "0" : `+${Math.round(ms)}`} ms · ${tesla.toFixed(1)} T`;
          simProgress.style.transform = `scaleX(${progress})`;
        },
      })
    : null;
  showSimButton(!reduceMotion.matches);
  showSimScale("average");
  simButton.addEventListener("click", () => {
    if (simView) showSimButton(simView.toggle());
  });

  measure();
  update();
})();
