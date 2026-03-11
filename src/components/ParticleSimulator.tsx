/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  MousePointer2,
  Sparkles,
  Settings,
  Shield,
  ChevronDown,
  Layers
} from 'lucide-react';

import { SimConfig } from '../types/simulation';
import { PRESETS } from '../constants/presets';
import { Particle } from '../engine/Particle';
import { SpatialGrid } from '../engine/SpatialGrid';
import { Obstacle } from '../engine/Obstacle';
import { SettingsPanel } from './SettingsPanel';
import { WebGLRenderer } from '../engine/WebGLRenderer';

const MAX_PARTICLES = 50000;
const SPAWN_BATCH = 100;
const GRID_CELL_SIZE = 40;
const MAX_DPR = 2;
const UI_UPDATE_INTERVAL_MS = 200;
const EMPTY_NEIGHBORS: Particle[] = [];

export const ParticleSimulator: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);

  const particlesRef = useRef<Particle[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const requestRef = useRef<number | null>(null);
  const isPausedRef = useRef<boolean>(false);
  const mouseRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const gridRef = useRef<SpatialGrid>(new SpatialGrid(GRID_CELL_SIZE));
  const neighborsBufferRef = useRef<Particle[]>([]);

  const overlayDirtyRef = useRef<boolean>(true);
  const lastTimeRef = useRef<number>(performance.now());
  const lastUiUpdateRef = useRef<number>(performance.now());

  const [config, setConfig] = useState<SimConfig>({
    gravity: 0.05,
    friction: 0.98,
    attraction: 6,
    repulsion: 0,
    particleLife: 150,
    particleSize: 3,
    vortex: false,
    bloom: true,
    flocking: true,
    collisions: true,
    obstacleMode: false
  });
  const configRef = useRef<SimConfig>(config);

  const [particleCount, setParticleCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('nebula');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const clearSimulation = useCallback(() => {
    particlesRef.current.length = 0;
    obstaclesRef.current.length = 0;
    neighborsBufferRef.current.length = 0;
    overlayDirtyRef.current = true;
    setParticleCount(0);
  }, []);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;

    const nextConfig = { ...configRef.current, ...preset } as Record<string, unknown>;
    delete nextConfig.label;
    delete nextConfig.icon;

    setConfig(nextConfig as unknown as SimConfig);
    setActivePreset(key);
  }, []);

  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;

    if (!container || !canvas || !overlayCanvas) return;

    const rect = container.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }

    if (overlayCanvas.width !== pixelWidth || overlayCanvas.height !== pixelHeight) {
      overlayCanvas.width = pixelWidth;
      overlayCanvas.height = pixelHeight;
      overlayCanvas.style.width = `${cssWidth}px`;
      overlayCanvas.style.height = `${cssHeight}px`;
      overlayDirtyRef.current = true;
    }

    const ctx = overlayCtxRef.current;
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
  }, []);

  const spawnParticles = useCallback((x: number, y: number) => {
    const particles = particlesRef.current;
    if (particles.length >= MAX_PARTICLES) return;

    const colors = [
      'rgba(102, 138, 255, 1)',
      'rgba(156, 135, 188, 1)',
      'rgba(52, 211, 153, 1)'
    ];

    const available = MAX_PARTICLES - particles.length;
    const amount = available < SPAWN_BATCH ? available : SPAWN_BATCH;
    const currentConfig = configRef.current;

    for (let i = 0; i < amount; i++) {
      const color = colors[(Math.random() * colors.length) | 0];
      particles.push(new Particle(x, y, color, currentConfig));
    }
  }, []);

  const addObstacle = useCallback((x: number, y: number) => {
    obstaclesRef.current.push(new Obstacle(x, y));
    overlayDirtyRef.current = true;
  }, []);

  const redrawOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCtxRef.current;
    const container = containerRef.current;

    if (!overlayCanvas || !ctx || !container) return;
    if (!overlayDirtyRef.current) return;

    const rect = container.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    const obstacles = obstaclesRef.current;
    for (let i = 0; i < obstacles.length; i++) {
      obstacles[i].draw(ctx);
    }

    overlayDirtyRef.current = false;
  }, []);

  const animate = useCallback((currentTime: number) => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;

    if (!canvas || !renderer) {
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    if (!isPausedRef.current) {
      const dt = Math.min((currentTime - lastTimeRef.current) / 16.666, 3);
      lastTimeRef.current = currentTime;

      const currentConfig = configRef.current;
      const { x: mx, y: my } = mouseRef.current;
      const particles = particlesRef.current;
      const obstacles = obstaclesRef.current;
      const grid = gridRef.current;
      const neighbors = neighborsBufferRef.current;

      grid.clear();
      for (let i = 0; i < particles.length; i++) {
        grid.add(particles[i]);
      }

      const useNeighbors = currentConfig.flocking || currentConfig.collisions;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        let particleNeighbors = EMPTY_NEIGHBORS;
        if (useNeighbors) {
          grid.getNeighborsInto(p, neighbors);
          particleNeighbors = neighbors;
        } else {
          neighbors.length = 0;
        }

        p.update(
          currentConfig,
          canvas.width,
          canvas.height,
          mx,
          my,
          particleNeighbors,
          obstacles,
          dt
        );

        if (p.isDead()) {
          particles.splice(i, 1);
        }
      }

      renderer.render(particles, canvas.width, canvas.height, currentConfig.bloom);
      redrawOverlay();

      frameCountRef.current++;
      const now = currentTime;
      const elapsed = now - lastFpsTimeRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      if (currentTime - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateRef.current = currentTime;
        setParticleCount(particles.length);
      }
    } else {
      lastTimeRef.current = currentTime;
    }

    requestRef.current = requestAnimationFrame(animate);
  }, [redrawOverlay]);

  const getPointerPosition = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return null;

    const rect = overlayCanvas.getBoundingClientRect();
    const clientX =
      'touches' in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX;
    const clientY =
      'touches' in e ? e.touches[0]?.clientY ?? 0 : (e as React.MouseEvent).clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }, []);

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPointerPosition(e);
    if (!pos) return;

    mouseRef.current = pos;

    if (!configRef.current.obstacleMode) {
      if (('buttons' in e && e.buttons === 1) || 'touches' in e) {
        spawnParticles(pos.x, pos.y);
      }
    }
  }, [getPointerPosition, spawnParticles]);

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPointerPosition(e);
    if (!pos) return;

    mouseRef.current = pos;

    if (configRef.current.obstacleMode) {
      addObstacle(pos.x, pos.y);
    } else {
      spawnParticles(pos.x, pos.y);
    }
  }, [addObstacle, getPointerPosition, spawnParticles]);

  const handlePointerLeave = useCallback(() => {
    mouseRef.current = { x: null, y: null };
  }, []);

  useEffect(() => {
    if (overlayCanvasRef.current && !overlayCtxRef.current) {
      overlayCtxRef.current = overlayCanvasRef.current.getContext('2d');
    }

    if (canvasRef.current && !rendererRef.current) {
      try {
        rendererRef.current = new WebGLRenderer(canvasRef.current, MAX_PARTICLES);
      } catch (e) {
        console.error('WebGL initialization failed', e);
        setErrorMessage('WebGL2 is not supported by your browser.');
      }
    }

    handleResize();
    redrawOverlay();

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
      redrawOverlay();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      resizeObserver.disconnect();

      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [animate, handleResize, redrawOverlay]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#11131c] overflow-hidden flex flex-col"
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      <canvas
        ref={overlayCanvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerLeave}
        className="absolute inset-0 cursor-crosshair"
      />

      <div className="relative z-10 p-6 flex justify-between items-start pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 backdrop-blur-xl border border-white/10 p-4 rounded-2xl pointer-events-auto shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-1">
            <Sparkles className="w-5 h-5 text-[#668aff]" />
            <h1 className="text-white font-medium tracking-tight">Quantum Engine</h1>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-white/40 text-[10px] font-mono uppercase tracking-widest">
              Live: <span className="text-[#668aff]">{particleCount}</span>
            </p>
            <div className="h-1 w-1 rounded-full bg-white/20" />
            <p className="text-white/40 text-[10px] font-mono uppercase tracking-widest">
              FPS: <span className="text-[#4cd137]">{fps}</span>
            </p>
            <div className="h-1 w-1 rounded-full bg-white/20" />
            <p className="text-white/40 text-[10px] font-mono uppercase tracking-widest">
              Preset: <span className="text-[#9c87bc]">{activePreset}</span>
            </p>
          </div>
        </motion.div>

        <div className="flex flex-col items-end gap-3 pointer-events-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex gap-2"
          >
            <div className="relative">
              <button
                onClick={() => setShowPresets(prev => !prev)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all active:scale-95 backdrop-blur-xl h-full ${
                  showPresets
                    ? 'bg-white/10 border-white/20 text-white'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                }`}
              >
                <Layers size={18} className="text-[#9c87bc]" />
                <span className="text-xs font-medium uppercase tracking-wider hidden sm:inline">
                  {PRESETS[activePreset]?.label || 'Presets'}
                </span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-300 ${showPresets ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {showPresets && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 top-full mt-2 w-56 bg-[#1d1f29]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 p-2 grid grid-cols-1 gap-1"
                  >
                    <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                      {Object.entries(PRESETS).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => {
                            applyPreset(key);
                            setShowPresets(false);
                          }}
                          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all ${
                            activePreset === key
                              ? 'bg-[#668aff]/20 text-[#668aff]'
                              : 'hover:bg-white/5 text-white/60 hover:text-white'
                          }`}
                        >
                          <preset.icon size={16} />
                          <span className="text-[11px] font-medium uppercase tracking-wider">
                            {preset.label}
                          </span>
                          {activePreset === key && (
                            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#668aff]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={() => setConfig(prev => ({ ...prev, obstacleMode: !prev.obstacleMode }))}
              className={`p-3 backdrop-blur-xl border border-white/10 rounded-xl text-white transition-all active:scale-95 ${
                config.obstacleMode ? 'bg-[#ff6b6b]' : 'bg-white/5 hover:bg-white/10'
              }`}
              title="Obstacle Mode"
            >
              <Shield size={20} />
            </button>

            <button
              onClick={() => {
                isPausedRef.current = !isPausedRef.current;
                setIsPaused(isPausedRef.current);
              }}
              className="p-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all active:scale-95"
            >
              {isPaused ? <Play size={20} /> : <Pause size={20} />}
            </button>

            <button
              onClick={clearSimulation}
              className="p-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all active:scale-95"
            >
              <RotateCcw size={20} />
            </button>

            <button
              onClick={() => setShowSettings(prev => !prev)}
              className={`p-3 backdrop-blur-xl border border-white/10 rounded-xl text-white transition-all active:scale-95 ${
                showSettings ? 'bg-[#668aff]' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              <Settings size={20} />
            </button>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 bg-red-500/20 backdrop-blur-xl border border-red-500/50 px-6 py-3 rounded-2xl text-white text-sm font-medium shadow-2xl"
          >
            {errorMessage}
          </motion.div>
        )}

        {showSettings && (
          <SettingsPanel
            config={config}
            setConfig={setConfig}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {particleCount === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="flex flex-col items-center gap-4 text-white/20">
              <MousePointer2 className="w-8 h-8 animate-pulse" />
              <p className="text-xs font-medium uppercase tracking-[0.3em]">
                {config.obstacleMode ? 'Click to place barriers' : 'Drag to create matter'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ParticleSimulator;