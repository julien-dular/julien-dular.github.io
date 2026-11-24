// 3D view of the coil of one LHC dipole aperture, around its beam pipe: it lights up over the photo,
// turns to face the viewer, and its front face takes the colours of the field map before the 2D figure
// takes over. Surface kinds: 0 coil side, 1 coil front, 2 pipe outside and rim, 3 pipe inside, 4 pipe bottom.
(function () {
  "use strict";

  const VERTEX = `
    attribute vec3 a_pos;
    attribute vec3 a_normal;
    attribute vec2 a_local;
    attribute float a_kind;
    uniform mat3 u_rot;
    uniform float u_inv;
    uniform vec4 u_place;
    uniform vec4 u_toClip;
    varying vec3 v_normal;
    varying vec2 v_local;
    varying vec2 v_uv;
    varying float v_kind;
    void main() {
      vec3 q = u_rot * a_pos;
      float w = 1.0 - q.z * u_inv;
      vec2 px = vec2(u_place.z + u_place.x * q.x / w, u_place.w - u_place.x * q.y / w);
      vec2 clip = px * u_toClip.xy + u_toClip.zw;
      gl_Position = vec4(clip * w, -q.z / 4000.0 * w, w);
      v_normal = u_rot * a_normal;
      v_local = a_local;
      v_uv = vec2(a_pos.x + CX, CY - a_pos.y) / SIZE;
      v_kind = a_kind;
    }`;

  const FRAGMENT = `
    #ifdef GL_OES_standard_derivatives
    #extension GL_OES_standard_derivatives : enable
    #endif
    precision mediump float;
    uniform sampler2D u_map;
    uniform float u_field;
    uniform float u_pipe;
    varying vec3 v_normal;
    varying vec2 v_local;
    varying vec2 v_uv;
    varying float v_kind;
    void main() {
      vec3 n = normalize(v_normal);
      vec3 light = normalize(vec3(-0.35, 0.55, 0.76));
      vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
      if (v_kind > 1.5) {
        // Steel beam pipe, darker deeper inside
        vec3 steel = vec3(0.8, 0.82, 0.86) * (0.3 + 0.52 * max(dot(n, light), 0.0))
          + vec3(0.55) * pow(max(dot(n, halfway), 0.0), 36.0);
        if (v_kind > 2.5) steel *= mix(0.9, 0.3, v_local.y);
        if (v_kind > 3.5) steel = vec3(0.13, 0.14, 0.18);
        gl_FragColor = vec4(steel * u_pipe, u_pipe);
        return;
      }
      float front = 1.0 - step(0.5, abs(v_kind - 1.0));
      vec3 copper = vec3(0.72, 0.42, 0.32);
      vec3 color = copper * (0.36 + 0.62 * max(dot(n, light), 0.0))
        + vec3(1.0, 0.86, 0.74) * 0.28 * pow(max(dot(n, halfway), 0.0), 28.0)
        + copper * 0.25 * pow(1.0 - max(n.z, 0.0), 2.0);
      #ifdef GL_OES_standard_derivatives
      // Thin dark lines between the turns, only where the turns are wide enough on screen to show them
      vec2 width = fwidth(v_local);
      vec2 g = min(v_local, 1.0 - v_local) / max(width, vec2(1e-5));
      float edge = 1.0 - clamp(min(g.x, g.y) - 0.4, 0.0, 1.0);
      float room = 1.0 - smoothstep(0.12, 0.3, max(width.x, width.y));
      color = mix(color, color * 0.4, edge * room * 0.8 * front);
      #endif
      vec4 field = texture2D(u_map, v_uv);
      gl_FragColor = vec4(mix(color, field.rgb + (1.0 - field.a) * vec3(0.1, 0.1, 0.18), u_field * front), 1.0);
    }`;

  function compile(gl, defines) {
    const id = gl.createProgram();
    [[gl.VERTEX_SHADER, defines + VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]].forEach(([type, source]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(id, shader);
    });
    ["a_pos", "a_normal", "a_local", "a_kind"].forEach((name, index) => gl.bindAttribLocation(id, index, name));
    gl.linkProgram(id);
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(id));
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS); i += 1) {
      const { name } = gl.getActiveUniform(id, i);
      uniforms[name] = gl.getUniformLocation(id, name);
    }
    return { id, uniforms };
  }

  // Each half-turn (corners iL, iH, oH, oL in pixels of the field figure) becomes a block extruded
  // backwards: its front face and four sides, as unshared triangles with flat normals. As on the
  // mock-up, the inner layer stands out in front of the outer one.
  function build(turns, center, { depth, protrusion, innerRadius }) {
    const data = [];
    const push = (x, y, z, normal, u, v, kind) => data.push(x, y, z, normal[0], normal[1], normal[2], u, v, kind);
    for (let t = 0; t < turns.length / 8; t += 1) {
      const c = [0, 1, 2, 3].map((k) => [turns[8 * t + 2 * k] - center[0], center[1] - turns[8 * t + 2 * k + 1]]);
      const radius = c.reduce((sum, p) => sum + Math.hypot(p[0], p[1]), 0) / 4;
      const z0 = radius < innerRadius ? protrusion : 0;
      const local = [[0, 0], [0, 1], [1, 1], [1, 0]];
      [[0, 1, 2], [0, 2, 3]].forEach((tri) => {
        tri.forEach((k) => push(c[k][0], c[k][1], z0, [0, 0, 1], local[k][0], local[k][1], 1));
      });
      const mid = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
      for (let k = 0; k < 4; k += 1) {
        const a = c[k];
        const b = c[(k + 1) % 4];
        let n = [b[1] - a[1], a[0] - b[0]];
        const length = Math.hypot(n[0], n[1]) || 1;
        n = [n[0] / length, n[1] / length];
        if (n[0] * ((a[0] + b[0]) / 2 - mid[0]) + n[1] * ((a[1] + b[1]) / 2 - mid[1]) < 0) n = [-n[0], -n[1]];
        const normal = [n[0], n[1], 0];
        const corners = [[a, z0, 0, 0], [b, z0, 1, 0], [b, -depth, 1, 1], [a, -depth, 0, 1]];
        [0, 1, 2, 0, 2, 3].forEach((i) => {
          const [p, z, u, v] = corners[i];
          push(p[0], p[1], z, normal, u, v, 0);
        });
      }
    }
    return new Float32Array(data);
  }

  // Hollow beam pipe along the axis, from its end (in front of the coil) back to the depth of the coil,
  // closed by a dark bottom so that the inside looks deep
  function buildPipe({ depth, pipe }) {
    const data = [];
    const segments = 96;
    const quad = (a, b, c, d, kind) => [a, b, c, a, c, d].forEach((p) => data.push(...p, kind));
    for (let i = 0; i < segments; i += 1) {
      const t0 = (2 * Math.PI * i) / segments;
      const t1 = (2 * Math.PI * (i + 1)) / segments;
      const [c0, s0, c1, s1] = [Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)];
      const at = (r, c, s, z, n, u, v) => [r * c, r * s, z, ...n, u, v];
      const out0 = [c0, s0, 0], out1 = [c1, s1, 0], in0 = [-c0, -s0, 0], in1 = [-c1, -s1, 0], up = [0, 0, 1];
      const { inner, outer, front } = pipe;
      quad(at(outer, c0, s0, front, out0, 0, 0), at(outer, c1, s1, front, out1, 0, 0), at(outer, c1, s1, -depth, out1, 0, 1), at(outer, c0, s0, -depth, out0, 0, 1), 2);
      quad(at(inner, c0, s0, front, up, 0, 0), at(outer, c0, s0, front, up, 0, 0), at(outer, c1, s1, front, up, 0, 0), at(inner, c1, s1, front, up, 0, 0), 2);
      quad(at(inner, c1, s1, front, in1, 0, 0), at(inner, c0, s0, front, in0, 0, 0), at(inner, c0, s0, -depth, in0, 0, 1), at(inner, c1, s1, -depth, in1, 0, 1), 3);
      quad(at(0, c0, s0, -depth, up, 0, 1), at(inner, c0, s0, -depth, up, 0, 1), at(inner, c1, s1, -depth, up, 0, 1), at(0, c1, s1, -depth, up, 0, 1), 4);
    }
    return new Float32Array(data);
  }

  function rotation(yaw, pitch) {
    const a = (yaw * Math.PI) / 180;
    const b = (pitch * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // Rx(pitch) * Ry(yaw), column-major for WebGL
    return new Float32Array([ca, sb * sa, -cb * sa, 0, cb, sb, sa, -sb * ca, cb * ca]);
  }

  // figure: { center: [x, y], size: [w, h] } in pixels of the field figure, image: its <img>;
  // shape: { depth, protrusion, innerRadius, pipe: { inner, outer, front } } in figure pixels
  window.createCoilView = function ({ canvas, url, figure, image, shape, onReady, onLost }) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true });
    if (!gl) return null;
    // Enables the lines between turns (fwidth), where supported
    gl.getExtension("OES_standard_derivatives");
    let program = null;
    let coilCount = 0;
    let pipeCount = 0;
    let ready = false;
    let lost = false;

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
      ready = false;
      onLost();
    });

    Promise.all([
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return response.arrayBuffer();
      }),
      image.decode(),
    ])
      .then(([buffer]) => {
        const [magic, n] = new Uint32Array(buffer, 0, 4);
        if (magic !== 0x4d544332) throw new Error("Not a coil file");
        const coil = build(new Float32Array(buffer, 16, 8 * n), figure.center, shape);
        const tube = buildPipe(shape);
        const vertices = new Float32Array(coil.length + tube.length);
        vertices.set(coil);
        vertices.set(tube, coil.length);
        coilCount = coil.length / 9;
        pipeCount = tube.length / 9;
        const defines = `#define CX ${figure.center[0].toFixed(1)}\n#define CY ${figure.center[1].toFixed(1)}\n#define SIZE vec2(${figure.size[0].toFixed(1)}, ${figure.size[1].toFixed(1)})\n`;
        program = compile(gl, defines);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 1, 32]].forEach(([index, size, offset]) => {
          gl.enableVertexAttribArray(index);
          gl.vertexAttribPointer(index, size, gl.FLOAT, false, 36, offset);
        });
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.enable(gl.DEPTH_TEST);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(program.id);
        ready = true;
        onReady();
      })
      .catch((error) => {
        console.warn("Coil view unavailable:", error);
        onLost();
      });

    return {
      resize(width, height) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      },

      // pose: { yaw, pitch (degrees), inv (1 / camera distance), scale, center: [x, y] } in figure pixels;
      // screen: [m, tx, ty], from figure pixels to CSS pixels; field: 0 (copper) to 1 (field map); pipe: its opacity
      draw({ pose, screen, width, height, field, pipe }) {
        if (!ready || lost) return;
        const [m, tx, ty] = screen;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix3fv(program.uniforms.u_rot, false, rotation(pose.yaw, pose.pitch));
        gl.uniform1f(program.uniforms.u_inv, pose.inv);
        gl.uniform4f(program.uniforms.u_place, pose.scale, 0, pose.center[0], pose.center[1]);
        gl.uniform4f(program.uniforms.u_toClip, (2 * m) / width, (-2 * m) / height, (2 * tx) / width - 1, 1 - (2 * ty) / height);
        gl.uniform1f(program.uniforms.u_field, field);
        gl.uniform1f(program.uniforms.u_pipe, pipe);
        gl.drawArrays(gl.TRIANGLES, 0, coilCount);
        if (pipe > 0.001) {
          // While it fades, only the nearest surface of the pipe is blended over the coil
          gl.colorMask(false, false, false, false);
          gl.drawArrays(gl.TRIANGLES, coilCount, pipeCount);
          gl.colorMask(true, true, true, true);
          gl.depthFunc(gl.LEQUAL);
          gl.enable(gl.BLEND);
          gl.drawArrays(gl.TRIANGLES, coilCount, pipeCount);
          gl.disable(gl.BLEND);
          gl.depthFunc(gl.LESS);
        }
      },
    };
  };
})();
