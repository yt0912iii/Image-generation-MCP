import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Volume2, VolumeX, UserCheck, Sparkles, Brain, Radio, ChevronDown } from 'lucide-react';
import { AvatarPreset, AvatarState } from '../types';
import { AVATAR_PRESETS } from '../data/workflowsAndPresets';

interface AvatarViewProps {
  currentAvatar: AvatarPreset;
  avatarState: AvatarState;
  latestSpeechText?: string;
  onSelectAvatar: (preset: AvatarPreset) => void;
  isAudioMuted: boolean;
  onToggleAudioMute: () => void;
}

export const AvatarView: React.FC<AvatarViewProps> = ({
  currentAvatar,
  avatarState,
  latestSpeechText,
  onSelectAvatar,
  isAudioMuted,
  onToggleAudioMute
}) => {
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);

  // Trigger Web Speech Synthesis when avatar enters 'speaking' state
  useEffect(() => {
    if (avatarState === 'speaking' && latestSpeechText && !isAudioMuted && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(latestSpeechText);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.05;
      utterance.pitch = currentAvatar.gender === 'female' ? 1.1 : 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }, [avatarState, latestSpeechText, isAudioMuted, currentAvatar]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden relative shadow-md flex flex-col">
      {/* Top Header Overlay Bar */}
      <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-zinc-950/90 to-transparent z-20 flex items-center justify-between">
        {/* Preset Selector Button */}
        <div className="relative">
          <button
            onClick={() => setShowPresetDropdown(!showPresetDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 transition-all shadow-sm"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>{currentAvatar.name} ({currentAvatar.title})</span>
            <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${showPresetDropdown ? 'rotate-180' : ''}`} />
          </button>

          {/* Preset Selector Dropdown */}
          <AnimatePresence>
            {showPresetDropdown && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                className="absolute left-0 mt-2 w-72 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl p-2 z-50 divide-y divide-zinc-800"
              >
                <div className="px-2 py-1 text-[11px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
                  切換數位人角色 (Avatar Preset)
                </div>
                <div className="py-1 space-y-1">
                  {AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        onSelectAvatar(preset);
                        setShowPresetDropdown(false);
                      }}
                      className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all ${
                        currentAvatar.id === preset.id
                          ? 'bg-zinc-800 border border-zinc-700 text-zinc-100'
                          : 'hover:bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <img
                        src={preset.avatarUrl}
                        alt={preset.name}
                        className="w-9 h-9 rounded-full object-cover border border-zinc-700"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-zinc-100">{preset.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                            {'AI'}
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-400 truncate">{preset.description}</p>
                      </div>
                      {currentAvatar.id === preset.id && (
                        <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Audio Mute Button */}
        <button
          onClick={onToggleAudioMute}
          className={`p-2 rounded-xl border transition-all ${
            isAudioMuted
              ? 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200'
          }`}
          title={isAudioMuted ? '解除靜音' : '靜音'}
        >
          {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Center Avatar Stage Area */}
      <div className="relative aspect-[4/3] sm:aspect-square w-full bg-zinc-950 overflow-hidden flex items-center justify-center">
        {/* Avatar Character Image */}
        <motion.img
          key={currentAvatar.id}
          src={currentAvatar.avatarUrl}
          alt={currentAvatar.name}
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
          animate={{
            scale: avatarState === 'speaking' ? [1, 1.01, 1] : 1
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            repeatType: 'mirror'
          }}
        />

        {/* Status Mode HUD Animations */}
        {avatarState === 'thinking' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 bg-zinc-950/40 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 shadow-xl">
              <Brain className="w-5 h-5 text-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-bold text-zinc-200 tracking-wider">
                THINKING...
              </span>
              <span className="text-[10px] text-zinc-400 font-mono">語音意圖與 Workflow 分析中</span>
            </div>
          </div>
        )}

        {/* Speaking Audio Equalizer Waveform Overlay */}
        {avatarState === 'speaking' && (
          <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between px-4 py-2.5 rounded-xl bg-zinc-950/90 border border-zinc-800 shadow-lg">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold text-emerald-400">
                SPEAKING
              </span>
            </div>
            {/* Audio Wave Visualizer Bars */}
            <div className="flex items-center gap-1">
              {[40, 80, 50, 90, 60, 100, 70, 45, 85].map((height, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-emerald-400 rounded-full"
                  animate={{ height: [6, height * 0.25, 6] }}
                  transition={{
                    duration: 0.4 + (i % 3) * 0.1,
                    repeat: Infinity,
                    repeatType: 'mirror',
                    delay: i * 0.05
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* State Badge (Bottom Left) */}
        <div className="absolute top-4 right-4 z-20">
          <div className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold flex items-center gap-1.5 border bg-zinc-900/90 border-zinc-700 text-zinc-200 backdrop-blur-md">
            <span className={`w-2 h-2 rounded-full ${
              avatarState === 'thinking'
                ? 'bg-amber-400 animate-pulse'
                : avatarState === 'speaking'
                ? 'bg-emerald-400'
                : 'bg-zinc-500'
            }`} />
            {avatarState === 'thinking' ? 'Thinking' : avatarState === 'speaking' ? 'Speaking' : 'Idle'}
          </div>
        </div>
      </div>

      {/* Character Info Footer */}
      <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-semibold text-zinc-200">{currentAvatar.name}</span>
          <span className="text-zinc-400 text-[11px] hidden sm:inline">| {currentAvatar.title}</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
          Voice: {currentAvatar.voiceName}
        </span>
      </div>
    </div>
  );
};

