/**
 * Workspace Page - Combined Chat + 3D Viewer with Shared WASM Store
 *
 * This page demonstrates the hybrid architecture:
 * - Left panel: ChatPanelHybrid (Gemini + WASM tool execution)
 * - Right panel: Viewer3D (shared WasmStore for instant updates)
 *
 * The WasmStore singleton is shared between components, so when
 * Gemini creates geometry via tool calls, it instantly appears
 * in the 3D viewer.
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ChatPanelHybrid } from '@/components/ChatPanelHybrid';

// Dynamically import Viewer3D to avoid SSR issues with Three.js
const Viewer3D = dynamic(() => import('@/components/Viewer3D').then((mod) => mod.Viewer3D), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
      Loading 3D viewer...
    </div>
  ),
});

export default function WorkspacePage() {
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [viewerKey, setViewerKey] = useState(0);

  // Force viewer to re-render when level IDs change
  const handleLevelIdsChange = useCallback((newLevelIds: string[]) => {
    setLevelIds(newLevelIds);
    // Increment key to force re-render of Viewer3D
    setViewerKey((k) => k + 1);
  }, []);

  return (
    <main className="h-screen bg-gray-900 flex overflow-hidden">
      {/* Left Panel - Chat */}
      <div className="w-1/2 h-full border-r border-gray-700 flex flex-col">
        <ChatPanelHybrid onLevelIdsChange={handleLevelIdsChange} />
      </div>

      {/* Right Panel - 3D Viewer */}
      <div className="w-1/2 h-full flex flex-col">
        {/* Viewer Header */}
        <div className="border-b border-gray-700 p-4 bg-gray-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">3D Preview</h2>
              <p className="text-sm text-gray-400">
                {levelIds.length > 0
                  ? `Showing ${levelIds.length} level${levelIds.length !== 1 ? 's' : ''}`
                  : 'Generate geometry to see preview'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${levelIds.length > 0 ? 'bg-green-500' : 'bg-gray-500'}`}
              />
              <span className="text-xs text-gray-400">
                {levelIds.length > 0 ? 'Live' : 'Waiting'}
              </span>
            </div>
          </div>
        </div>

        {/* 3D Viewer */}
        <div className="flex-1 relative">
          <Viewer3D
            key={viewerKey}
            levelIds={levelIds}
            showGrid={true}
            backgroundColor="#1a1a1a"
            renderMode="combined"
            wallThickness={0.667}
          />

          {/* Level IDs overlay */}
          {levelIds.length > 0 && (
            <div className="absolute bottom-4 left-4 bg-gray-800/90 backdrop-blur rounded-lg p-3 text-xs">
              <div className="text-gray-400 mb-1">Level IDs:</div>
              <div className="space-y-1">
                {levelIds.map((id, i) => (
                  <div key={id} className="font-mono text-gray-300">
                    {i + 1}. {id.slice(0, 20)}...
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
