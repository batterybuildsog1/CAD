'use client';

/**
 * CAD Lab Page
 *
 * Experimental playground for the CAD3D model and viewer. This page is NOT
 * linked from the main workspace UI; navigate directly to /cad-lab in the
 * browser to use it.
 *
 * When available, it will pull the last Gemini llmState (ObservableState)
 * from localStorage (key: "cad3d:last_llm_state") and convert it into a
 * Cad3DModel for visualization. If no state is available, it falls back to
 * a static demo model.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import type { ObservableState } from '@/lib/observable-state';
import type { Cad3DModel } from '@/cad3d/model';
import { buildCadModelFromObservableState } from '@/cad3d/conversion';
import { createDemoCadModel } from '@/cad3d/demoScene';

// Dynamically import CadLabCanvas to avoid SSR issues with Three.js
const CadLabCanvas = dynamic(
  () => import('@/cad3d/CadLabCanvas').then((mod) => mod.CadLabCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
        Loading CAD Lab viewer...
      </div>
    ),
  }
);

type ModelSource = 'llm' | 'demo' | 'loading';

export default function CadLabPage() {
  const [model, setModel] = useState<Cad3DModel | null>(null);
  const [source, setSource] = useState<ModelSource>('loading');

  useEffect(() => {
    let nextModel: Cad3DModel | null = null;
    let nextSource: ModelSource = 'demo';

    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem('cad3d:last_llm_state');
      if (raw) {
        try {
          const state = JSON.parse(raw) as ObservableState;
          nextModel = buildCadModelFromObservableState(
            state,
            'cad3d-from-llm',
            'CAD3D from last Gemini run'
          );
          nextSource = 'llm';
        } catch (e) {
          console.warn('[CAD3D] Failed to parse stored llmState from localStorage', e);
        }
      }
    }

    if (!nextModel) {
      nextModel = createDemoCadModel();
      nextSource = 'demo';
    }

    setModel(nextModel);
    setSource(nextSource);
  }, []);

  if (!model) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
        Preparing CAD3D model...
      </div>
    );
  }

  return (
    <main className="h-screen bg-gray-900 flex flex-col">
      <header className="border-b border-gray-800 p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">CAD3D Lab</h1>
          <p className="text-sm text-gray-400">
            {source === 'llm'
              ? '3D view of the last Gemini floorplan (experimental)'
              : 'Static demo model (no recent Gemini state found)'}
          </p>
        </div>
        <div className="text-xs text-gray-500">
          <span className="font-mono">{model.name}</span>
          <span className="ml-2 text-gray-400">[{source === 'llm' ? 'from llmState' : 'demo'}]</span>
        </div>
      </header>

      <section className="flex-1">
        <CadLabCanvas model={model} />
      </section>
    </main>
  );
}

