/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Particle } from './Particle';

const BG_R = 17 / 255;
const BG_G = 19 / 255;
const BG_B = 28 / 255;

const INSTANCE_STRIDE_FLOATS = 7; // x, y, size, r, g, b, alpha
const INSTANCE_STRIDE_BYTES = INSTANCE_STRIDE_FLOATS * 4;

export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  private program: WebGLProgram | null = null;
  private fadeProgram: WebGLProgram | null = null;

  private vao: WebGLVertexArrayObject | null = null;
  private fadeVao: WebGLVertexArrayObject | null = null;

  private instanceBuffer: WebGLBuffer | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  private maxParticles: number;
  private instanceData: Float32Array;

  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uBloomLoc: WebGLUniformLocation | null = null;

  private firstFrame = true;
  private isContextLost = false;

  private lastWidth = -1;
  private lastHeight = -1;
  private lastBloom = -1;

  // 360-step LUT for HSL(h, 0.85, 0.65) -> RGB
  private readonly huePalette = new Float32Array(360 * 3);

  constructor(canvas: HTMLCanvasElement, maxParticles: number = 50000) {
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance'
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    this.gl = gl;
    this.maxParticles = maxParticles;
    this.instanceData = new Float32Array(maxParticles * INSTANCE_STRIDE_FLOATS);

    this.buildHuePalette();
    this.initResources();
    this.attachContextEvents();
  }

  private attachContextEvents() {
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
  }

  private detachContextEvents() {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.isContextLost = true;
  };

  private handleContextRestored = () => {
    this.isContextLost = false;
    this.initResources();
  };

  private buildHuePalette() {
    for (let h = 0; h < 360; h++) {
      const [r, g, b] = this.hslToRgb(h / 360, 0.85, 0.65);
      const i = h * 3;
      this.huePalette[i] = r;
      this.huePalette[i + 1] = g;
      this.huePalette[i + 2] = b;
    }
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) return [l, l, l];

    const hue2rgb = (p: number, q: number, t: number) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return [
      hue2rgb(p, q, h + 1 / 3),
      hue2rgb(p, q, h),
      hue2rgb(p, q, h - 1 / 3)
    ];
  }

  private initResources() {
    const gl = this.gl;

    this.disposeGpuResources();

    const vsSource = `#version 300 es
      precision highp float;

      layout(location = 0) in vec2 a_position;
      layout(location = 1) in vec2 a_particlePos;
      layout(location = 2) in float a_particleSize;
      layout(location = 3) in vec3 a_particleColor;
      layout(location = 4) in float a_particleAlpha;

      uniform vec2 u_resolution;
      uniform float u_bloom;

      out vec2 v_uv;
      out vec3 v_color;
      out float v_alpha;
      out float v_bloom;

      void main() {
        float size = a_particleSize * mix(1.0, 3.0, step(0.5, u_bloom));
        vec2 pos = a_particlePos + a_position * size;

        vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;

        gl_Position = vec4(clipSpace, 0.0, 1.0);
        v_uv = a_position;
        v_color = a_particleColor;
        v_alpha = a_particleAlpha;
        v_bloom = u_bloom;
      }
    `;

    const fsSource = `#version 300 es
      precision highp float;

      in vec2 v_uv;
      in vec3 v_color;
      in float v_alpha;
      in float v_bloom;

      out vec4 outColor;

      void main() {
        float dist = length(v_uv);

        float alpha = v_alpha;
        if (v_bloom > 0.5) {
          alpha *= exp(-dist * dist * 4.0);
        } else {
          alpha *= smoothstep(1.0, 0.8, dist);
        }

        alpha *= 1.0 - step(1.0, dist);
        outColor = vec4(v_color * alpha, alpha);
      }
    `;

    const fadeVs = `#version 300 es
      layout(location = 0) in vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fadeFs = `#version 300 es
      precision mediump float;
      out vec4 outColor;
      void main() {
        outColor = vec4(${BG_R.toFixed(8)}, ${BG_G.toFixed(8)}, ${BG_B.toFixed(8)}, 0.28);
      }
    `;

    this.program = this.createProgram(vsSource, fsSource);
    this.fadeProgram = this.createProgram(fadeVs, fadeFs);

    this.uResolutionLoc = gl.getUniformLocation(this.program, 'u_resolution');
    this.uBloomLoc = gl.getUniformLocation(this.program, 'u_bloom');

    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);

    this.quadBuffer = gl.createBuffer();
    if (!this.quadBuffer) throw new Error('Failed to create quad buffer');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    this.vao = gl.createVertexArray();
    if (!this.vao) throw new Error('Failed to create particle VAO');

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuffer = gl.createBuffer();
    if (!this.instanceBuffer) throw new Error('Failed to create instance buffer');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 12);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 24);
    gl.vertexAttribDivisor(4, 1);

    this.fadeVao = gl.createVertexArray();
    if (!this.fadeVao) throw new Error('Failed to create fade VAO');

    gl.bindVertexArray(this.fadeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    this.firstFrame = true;
    this.lastWidth = -1;
    this.lastHeight = -1;
    this.lastBloom = -1;
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) throw new Error('Failed to create vertex shader');
    gl.shaderSource(vertexShader, vs);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(vertexShader) || 'Unknown vertex shader error';
      gl.deleteShader(vertexShader);
      throw new Error(`Vertex shader compile error: ${info}`);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
      gl.deleteShader(vertexShader);
      throw new Error('Failed to create fragment shader');
    }

    gl.shaderSource(fragmentShader, fs);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(fragmentShader) || 'Unknown fragment shader error';
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error(`Fragment shader compile error: ${info}`);
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error('Failed to create program');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }

    return program;
  }

  render(particles: readonly Particle[], width: number, height: number, bloom: boolean) {
    if (this.isContextLost || !this.program || !this.fadeProgram || !this.vao || !this.fadeVao || !this.instanceBuffer) {
      return;
    }

    const gl = this.gl;

    gl.viewport(0, 0, width, height);

    if (this.firstFrame) {
      gl.clearColor(BG_R, BG_G, BG_B, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.firstFrame = false;
    }

    // Fade pass
    gl.useProgram(this.fadeProgram);
    gl.bindVertexArray(this.fadeVao);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Instance upload
    const count = Math.min(particles.length, this.maxParticles);
    let offset = 0;

    for (let i = 0; i < count; i++) {
      const p = particles[i];

      // Avoid sqrt in CPU hot path
      const speedSq = p.vx * p.vx + p.vy * p.vy;
      const visualHue = (p.hue + Math.min(speedSq * 1.25, 60)) | 0;
      const hueIndex = ((visualHue % 360) + 360) % 360;
      const paletteOffset = hueIndex * 3;

      this.instanceData[offset++] = p.x;
      this.instanceData[offset++] = p.y;
      this.instanceData[offset++] = p.size;
      this.instanceData[offset++] = this.huePalette[paletteOffset];
      this.instanceData[offset++] = this.huePalette[paletteOffset + 1];
      this.instanceData[offset++] = this.huePalette[paletteOffset + 2];
      this.instanceData[offset++] = p.life > 0 ? p.life / p.maxLife : 0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

    // Orphan the old store before upload to reduce sync stalls on some drivers
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceData.subarray(0, count * INSTANCE_STRIDE_FLOATS)
    );

    // Particle pass
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    if (width !== this.lastWidth || height !== this.lastHeight) {
      gl.uniform2f(this.uResolutionLoc, width, height);
      this.lastWidth = width;
      this.lastHeight = height;
    }

    const bloomValue = bloom ? 1 : 0;
    if (bloomValue !== this.lastBloom) {
      gl.uniform1f(this.uBloomLoc, bloom ? 1.0 : 0.0);
      this.lastBloom = bloomValue;
    }

    if (bloom) {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

    gl.bindVertexArray(null);
  }

  resizeMaxParticles(maxParticles: number) {
    if (maxParticles === this.maxParticles) return;

    this.maxParticles = maxParticles;
    this.instanceData = new Float32Array(maxParticles * INSTANCE_STRIDE_FLOATS);

    if (this.instanceBuffer) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  private disposeGpuResources() {
    const gl = this.gl;

    if (this.instanceBuffer) {
      gl.deleteBuffer(this.instanceBuffer);
      this.instanceBuffer = null;
    }

    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }

    if (this.vao) {
      gl.deleteVertexArray(this.vao);
      this.vao = null;
    }

    if (this.fadeVao) {
      gl.deleteVertexArray(this.fadeVao);
      this.fadeVao = null;
    }

    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }

    if (this.fadeProgram) {
      gl.deleteProgram(this.fadeProgram);
      this.fadeProgram = null;
    }
  }

  dispose() {
    this.detachContextEvents();
    this.disposeGpuResources();
  }
}