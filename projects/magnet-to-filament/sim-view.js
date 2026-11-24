// Real-time view of FiQuS simulations (cable and strand): finite element meshes and current density, drawn with WebGL.
// All simulations share one discharge clock, so the animation continues while the page zooms from one to the next.
(function () {
  "use strict";

  const COLORS = ["#101f45", "#1f5fd0", "#8fbaf2", "#fbfaf7", "#f6b67e", "#df4f28", "#6d1a1d"];
  const MAGIC = 0x4d544631;

  // Length (ms) of each phase of the animation loop
  const HOLD = 700;
  const PLAY = 6800;
  const END = 1300;
  const RESET = 520;
  const TOTAL = HOLD + PLAY + END + RESET;

  const FILL_VERTEX = `
    attribute vec2 a_pos;
    attribute float a_v0;
    attribute float a_v1;
    uniform vec4 u_view;
    uniform float u_mix;
    varying float v_value;
    void main() {
      v_value = mix(a_v0, a_v1, u_mix);
      gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
    }`;

  const FILL_FRAGMENT = `
    precision highp float;
    uniform sampler2D u_map;
    uniform float u_alpha;
    varying float v_value;
    void main() {
      vec3 color = texture2D(u_map, vec2(0.5 + 0.5 * v_value, 0.5)).rgb;
      gl_FragColor = vec4(color * u_alpha, u_alpha);
    }`;

  // Lines are thin quads, so that their width is the same on every device
  const LINE_VERTEX = `
    attribute vec2 a_a;
    attribute vec2 a_b;
    attribute vec2 a_s;
    uniform vec4 u_view;
    uniform vec2 u_px;
    uniform float u_width;
    void main() {
      vec2 a = a_a * u_view.xy + u_view.zw;
      vec2 b = a_b * u_view.xy + u_view.zw;
      vec2 d = (b - a) / u_px;
      float l = max(length(d), 1e-6);
      vec2 n = vec2(-d.y, d.x) / l;
      gl_Position = vec4(mix(a, b, a_s.x) + n * a_s.y * u_width * u_px, 0.0, 1.0);
    }`;

  const LINE_FRAGMENT = `
    precision mediump float;
    uniform vec4 u_color;
    void main() {
      gl_FragColor = u_color;
    }`;

  function program(gl, vertex, fragment, attributes) {
    const id = gl.createProgram();
    [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].forEach(([type, source]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(id, shader);
    });
    attributes.forEach((name, index) => gl.bindAttribLocation(id, index, name));
    gl.linkProgram(id);
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(id));
    const uniforms = {};
    const count = gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const { name } = gl.getActiveUniform(id, i);
      uniforms[name] = gl.getUniformLocation(id, name);
    }
    return { id, uniforms };
  }

  function buffer(gl, target, data) {
    const id = gl.createBuffer();
    gl.bindBuffer(target, id);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return id;
  }

  function lineGeometry(gl, verts, pairs) {
    const n = pairs.length / 2;
    if (!n) return null;
    const data = new Float32Array(n * 24);
    const indices = new Uint16Array(n * 6);
    for (let e = 0; e < n; e += 1) {
      const a = pairs[2 * e];
      const b = pairs[2 * e + 1];
      [[0, -1], [0, 1], [1, -1], [1, 1]].forEach(([t, side], k) => {
        data.set([verts[2 * a], verts[2 * a + 1], verts[2 * b], verts[2 * b + 1], t, side], 24 * e + 6 * k);
      });
      const v = 4 * e;
      indices.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], 6 * e);
    }
    return {
      data: buffer(gl, gl.ARRAY_BUFFER, data),
      index: buffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices),
      count: indices.length,
    };
  }

  function colorTexture(gl) {
    const size = 256;
    const pixels = new Uint8Array(size * 4);
    const stops = COLORS.map((color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)));
    for (let i = 0; i < size; i += 1) {
      const x = (i / (size - 1)) * (stops.length - 1);
      const k = Math.min(Math.floor(x), stops.length - 2);
      for (let c = 0; c < 3; c += 1) pixels[4 * i + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * (x - k);
      pixels[4 * i + 3] = 255;
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Values are given per vertex, or per triangle (flat = 1) to keep the constant value of each finite element
  function parse(data) {
    const head = new Uint32Array(data, 0, 8);
    if (head[0] !== MAGIC) throw new Error("Unexpected simulation file");
    const [, nVerts, nTris, nEdges, nOutline, nFrames, flat] = head;
    let offset = 32;
    const take = (Type, length) => {
      const view = new Type(data, offset, length);
      offset += view.byteLength;
      return view;
    };
    const verts = take(Float32Array, 2 * nVerts);
    const times = take(Float32Array, nFrames);
    const fields = take(Float32Array, nFrames);
    const tris = take(Uint16Array, 3 * nTris);
    const edges = take(Uint16Array, 2 * nEdges);
    const outline = take(Uint16Array, 2 * nOutline);
    const values = take(Int8Array, (flat ? nTris : nVerts) * nFrames);
    return { nVerts, nTris, nFrames, flat: flat === 1, verts, times, fields, tris, edges, outline, values };
  }

  // Flat values need unshared corners: each triangle gets its own three vertices with the same value
  function fillGeometry(gl, sim) {
    if (!sim.flat) {
      return {
        positions: buffer(gl, gl.ARRAY_BUFFER, sim.verts),
        values: buffer(gl, gl.ARRAY_BUFFER, sim.values),
        triangles: buffer(gl, gl.ELEMENT_ARRAY_BUFFER, sim.tris),
        stride: sim.nVerts,
        count: sim.tris.length,
      };
    }
    const n = sim.tris.length;
    const positions = new Float32Array(2 * n);
    for (let i = 0; i < n; i += 1) {
      positions[2 * i] = sim.verts[2 * sim.tris[i]];
      positions[2 * i + 1] = sim.verts[2 * sim.tris[i] + 1];
    }
    const values = new Int8Array(sim.nFrames * n);
    for (let f = 0; f < sim.nFrames; f += 1) {
      for (let t = 0; t < sim.nTris; t += 1) {
        const v = sim.values[f * sim.nTris + t];
        const at = f * n + 3 * t;
        values[at] = v;
        values[at + 1] = v;
        values[at + 2] = v;
      }
    }
    return {
      positions: buffer(gl, gl.ARRAY_BUFFER, positions),
      values: buffer(gl, gl.ARRAY_BUFFER, values),
      triangles: null,
      stride: n,
      count: n,
    };
  }

  // sets: { key: { url, place: { cx, cy, pxPerMm }, outline, mesh } }, drawn in this order
  window.createSimView = function ({ canvas, sets, reduceMotion, onReady, onLost, onTime }) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return null;

    const keys = Object.keys(sets);
    const items = {};
    let fill = null;
    let line = null;
    let clockSim = null;
    let ready = false;
    let meshAlpha = 0;
    let active = false;
    let playing = !reduceMotion.matches;
    let clock = 0;
    let last = 0;
    let raf = 0;
    let lost = false;

    // Position of the clock in the frames: [first frame, second frame, mix, displayed frame]
    function frameAt(time) {
      const lastFrame = clockSim.nFrames - 1;
      if (time < HOLD) return [0, 0, 0, 0];
      if (time < HOLD + PLAY) {
        const x = ((time - HOLD) / PLAY) * lastFrame;
        const a = Math.min(Math.floor(x), lastFrame - 1);
        return [a, a + 1, x - a, x];
      }
      if (time < HOLD + PLAY + END) return [lastFrame, lastFrame, 0, lastFrame];
      return [lastFrame, 0, (time - HOLD - PLAY - END) / RESET, 0];
    }

    function attribute(index, id, size, type, normalized, stride, offset) {
      gl.bindBuffer(gl.ARRAY_BUFFER, id);
      gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
    }

    function drawLines(lines, width, color) {
      if (!lines) return;
      gl.uniform1f(line.uniforms.u_width, width);
      gl.uniform4fv(line.uniforms.u_color, color);
      attribute(0, lines.data, 2, gl.FLOAT, false, 24, 0);
      attribute(1, lines.data, 2, gl.FLOAT, false, 24, 8);
      attribute(2, lines.data, 2, gl.FLOAT, false, 24, 16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lines.index);
      gl.drawElements(gl.TRIANGLES, lines.count, gl.UNSIGNED_SHORT, 0);
    }

    function drawItem(item, a, b, mix) {
      const { sim, geometry, view, alpha } = item;
      gl.useProgram(fill.id);
      gl.uniform4fv(fill.uniforms.u_view, view.matrix);
      gl.uniform1f(fill.uniforms.u_mix, mix);
      gl.uniform1f(fill.uniforms.u_alpha, alpha);
      attribute(0, geometry.positions, 2, gl.FLOAT, false, 0, 0);
      attribute(1, geometry.values, 1, gl.BYTE, true, 0, a * geometry.stride);
      attribute(2, geometry.values, 1, gl.BYTE, true, 0, b * geometry.stride);
      if (geometry.triangles) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.triangles);
        gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, geometry.count);
      }

      gl.useProgram(line.id);
      gl.uniform4fv(line.uniforms.u_view, view.matrix);
      gl.uniform2fv(line.uniforms.u_px, view.px);
      const m = item.mesh ? meshAlpha * alpha : 0;
      if (m > 0.01) {
        const light = 0.34 * m;
        const dark = 0.62 * m;
        drawLines(geometry.mesh, 0.9, [light, light, light, light]);
        drawLines(geometry.mesh, 0.42, [0.1 * dark, 0.1 * dark, 0.18 * dark, dark]);
      }
      drawLines(geometry.outline, item.outline, [0.1 * alpha, 0.1 * alpha, 0.18 * alpha, alpha]);
    }

    function draw() {
      if (!ready || lost) return;
      const [a, b, mix, shown] = frameAt(clock);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      keys.forEach((key) => {
        const item = items[key];
        if (item.view && item.alpha > 0.001) drawItem(item, a, b, mix);
      });
      const k = Math.min(Math.floor(shown), clockSim.nFrames - 2);
      const f = shown - k;
      onTime({
        ms: clockSim.times[k] + (clockSim.times[k + 1] - clockSim.times[k]) * f,
        tesla: clockSim.fields[k] + (clockSim.fields[k + 1] - clockSim.fields[k]) * f,
        progress: shown / (clockSim.nFrames - 1),
      });
    }

    function tick(now) {
      raf = 0;
      if (!active || !playing) return;
      if (last) clock = (clock + Math.min(now - last, 100)) % TOTAL;
      last = now;
      draw();
      raf = requestAnimationFrame(tick);
    }

    function schedule() {
      if (active && playing && !raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    }

    function setStillFrame() {
      const index = clockSim.times.findIndex((ms) => ms >= 60);
      clock = HOLD + (Math.max(index, 0) / (clockSim.nFrames - 1)) * PLAY;
    }

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
      onLost();
    });

    Promise.all(
      keys.map((key) =>
        fetch(sets[key].url).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${sets[key].url}`);
          return response.arrayBuffer();
        })
      )
    )
      .then((buffers) => {
        fill = program(gl, FILL_VERTEX, FILL_FRAGMENT, ["a_pos", "a_v0", "a_v1"]);
        line = program(gl, LINE_VERTEX, LINE_FRAGMENT, ["a_a", "a_b", "a_s"]);
        keys.forEach((key, index) => {
          const sim = parse(buffers[index]);
          items[key] = {
            ...sets[key],
            sim,
            alpha: 0,
            view: null,
            geometry: {
              ...fillGeometry(gl, sim),
              mesh: lineGeometry(gl, sim.verts, sim.edges),
              outline: lineGeometry(gl, sim.verts, sim.outline),
            },
          };
        });
        clockSim = items[keys[0]].sim;
        if (keys.some((key) => items[key].sim.nFrames !== clockSim.nFrames)) throw new Error("Simulations do not share one clock");
        colorTexture(gl);
        [0, 1, 2].forEach((index) => gl.enableVertexAttribArray(index));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (!playing) setStillFrame();
        ready = true;
        onReady();
      })
      .catch((error) => {
        console.warn("Simulations unavailable:", error);
        onLost();
      });

    return {
      resize(width, height) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      },

      // layers: position of each figure in the world; opacity: per simulation; camera: current zoom of the page
      update({ camera, layers, width, height, opacity, mesh }) {
        let visible = false;
        keys.forEach((key) => {
          const item = items[key];
          const alpha = ready && !lost ? opacity[key] || 0 : 0;
          if (!item) return;
          item.alpha = alpha;
          if (alpha <= 0.001) return;
          visible = true;
          const { place } = item;
          const layer = layers[key];
          const scale = place.pxPerMm * layer.sc * camera.s;
          const x = (layer.ox + place.cx * layer.sc - camera.x) * camera.s;
          const y = (layer.oy + place.cy * layer.sc - camera.y) * camera.s;
          item.view = {
            matrix: [(2 * scale) / width, (2 * scale) / height, (2 * x) / width, (-2 * y) / height],
            px: [2 / width, 2 / height],
          };
        });
        canvas.style.visibility = visible ? "visible" : "hidden";
        active = visible;
        if (!active) return;
        meshAlpha = mesh;
        draw();
        schedule();
      },

      toggle() {
        playing = !playing;
        if (playing) schedule();
        else {
          cancelAnimationFrame(raf);
          raf = 0;
          draw();
        }
        return playing;
      },
    };
  };
})();
