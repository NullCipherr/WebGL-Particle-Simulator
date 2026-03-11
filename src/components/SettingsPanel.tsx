/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { X, Sliders } from 'lucide-react';
import { SimConfig } from '../types/simulation';

interface SettingsPanelProps {
  config: SimConfig;
  setConfig: (config: SimConfig) => void;
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ config, setConfig, onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className="absolute right-6 top-44 z-20 w-72 bg-[#1d1f29]/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl pointer-events-auto"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#668aff]" />
          <h2 className="text-white font-medium">Parameters</h2>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-5">
        {[
          { label: 'Gravity', key: 'gravity', min: -0.5, max: 0.5, step: 0.01 },
          { label: 'Attraction', key: 'attraction', min: 0, max: 50, step: 1 },
          { label: 'Friction', key: 'friction', min: 0.9, max: 1, step: 0.01 },
          { label: 'Size', key: 'particleSize', min: 1, max: 10, step: 1 },
        ].map((item) => (
          <div key={item.key} className="space-y-2">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
              <span>{item.label}</span>
              <span>{(config as any)[item.key]}</span>
            </div>
            <input 
              type="range" min={item.min} max={item.max} step={item.step} 
              value={(config as any)[item.key]} 
              onChange={(e) => setConfig({...config, [item.key]: parseFloat(e.target.value)})}
              className="w-full accent-[#668aff] bg-white/5 rounded-lg h-1 appearance-none cursor-pointer"
            />
          </div>
        ))}

        <div className="flex flex-col gap-3 pt-2">
          {[
            { label: 'Vortex Mode', key: 'vortex' },
            { label: 'Bloom Effect', key: 'bloom' },
            { label: 'Flocking (AI)', key: 'flocking' },
            { label: 'Collisions', key: 'collisions' },
            { label: 'Obstacle Mode', key: 'obstacleMode' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/40">{item.label}</span>
              <button 
                onClick={() => setConfig({...config, [item.key]: !(config as any)[item.key]})}
                className={`w-10 h-5 rounded-full transition-colors relative ${(config as any)[item.key] ? 'bg-[#668aff]' : 'bg-white/10'}`}
              >
                <motion.div 
                  animate={{ x: (config as any)[item.key] ? 20 : 2 }}
                  className="absolute top-1 left-0 w-3 h-3 bg-white rounded-full shadow-sm"
                />
              </button>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};
