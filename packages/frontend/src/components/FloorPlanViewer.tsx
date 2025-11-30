'use client';

import { useMemo } from 'react';
import type { ObservableToolResult } from '@/lib/gemini-cad';
import type { ToolCall } from '@/lib/gemini-types';
import type { RoomSummary } from '@/lib/observable-state';

// ============================================================================
// Types
// ============================================================================

interface Room {
  name: string;
  type: string;
  points: [number, number][];
  center: [number, number];
  area: number;
  levelId?: string;
}

interface FloorPlanViewerProps {
  history: Array<{ call: ToolCall; result: ObservableToolResult }>;
}

// Room type to color mapping
const ROOM_COLORS: Record<string, string> = {
  living: '#4ade80',      // green
  kitchen: '#fbbf24',     // yellow
  bedroom: '#60a5fa',     // blue
  bathroom: '#a78bfa',    // purple
  garage: '#9ca3af',      // gray
  utility: '#fb923c',     // orange
  circulation: '#f472b6', // pink
  hallway: '#f472b6',     // pink
  other: '#e5e7eb',       // light gray
};

// ============================================================================
// FloorPlanViewer Component
// ============================================================================

export function FloorPlanViewer({ history }: FloorPlanViewerProps) {
  // Extract rooms from the LLM-friendly observable state.
  // This is the canonical source of truth for room geometry. If it is
  // missing or empty, we deliberately show "no rooms" rather than guessing
  // shapes from tool history to avoid misleading boxes.
  const rooms = useMemo(() => {
    if (history.length === 0) return [] as Room[];

    const latest = history[history.length - 1]?.result;
    const llmRooms: RoomSummary[] | undefined = latest?.llmState?.floorplan?.rooms;

    if (llmRooms && llmRooms.length > 0) {
      return llmRooms.map((room) => {
        const pts =
          room.points && room.points.length >= 3
            ? room.points
            : ([
                [room.bounds.minX, room.bounds.minY],
                [room.bounds.maxX, room.bounds.minY],
                [room.bounds.maxX, room.bounds.maxY],
                [room.bounds.minX, room.bounds.maxY],
              ] as [number, number][]);

        const center = room.center as [number, number];

        return {
          name: room.name,
          type: room.type,
          points: pts,
          center,
          area: room.area,
          levelId: undefined,
        } as Room;
      });
    }

    // No reliable observable state yet – fail fast with "no rooms"
    // instead of fabricating boxes from partial tool history.
    return [] as Room[];
  }, [history]);

  // Calculate view bounds
  const viewBounds = useMemo(() => {
    if (rooms.length === 0) {
      return { minX: -10, minY: -10, maxX: 50, maxY: 40 };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const room of rooms) {
      for (const [x, y] of room.points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    // Add padding
    const padding = 10;
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }, [rooms]);

  const width = viewBounds.maxX - viewBounds.minX;
  const height = viewBounds.maxY - viewBounds.minY;

  // SVG viewBox - flip Y axis so NORTH is up
  const viewBox = `${viewBounds.minX} ${-viewBounds.maxY} ${width} ${height}`;

  if (rooms.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
          2D Floor Plan
        </h3>
        <div className="flex items-center justify-center h-64 text-gray-500">
          No rooms created yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
        2D Floor Plan ({rooms.length} rooms)
      </h3>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {Object.entries(ROOM_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
            <span className="text-gray-400 capitalize">{type}</span>
          </div>
        ))}
      </div>

      {/* SVG Floor Plan */}
      <svg
        viewBox={viewBox}
        className="w-full h-80 bg-gray-900 rounded border border-gray-700"
        style={{ transform: 'scaleY(-1)' }} // Flip so Y+ is up (NORTH)
      >
        {/* Grid */}
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#374151" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect
          x={viewBounds.minX}
          y={-viewBounds.maxY}
          width={width}
          height={height}
          fill="url(#grid)"
        />

        {/* Compass */}
        <g transform={`translate(${viewBounds.maxX - 8}, ${-viewBounds.maxY + 8})`} style={{ transform: 'scaleY(-1)' }}>
          <circle r="6" fill="#1f2937" stroke="#4b5563" strokeWidth="0.5" />
          <text x="0" y="-2" textAnchor="middle" fill="#9ca3af" fontSize="4" style={{ transform: 'scaleY(-1)' }}>N</text>
          <path d="M 0 -4 L 1 0 L -1 0 Z" fill="#ef4444" />
        </g>

        {/* Rooms */}
        {rooms.map((room, i) => {
          const color = ROOM_COLORS[room.type] || ROOM_COLORS.other;
          const pathData = room.points.map((p, j) =>
            `${j === 0 ? 'M' : 'L'} ${p[0]} ${-p[1]}`
          ).join(' ') + ' Z';

          return (
            <g key={i}>
              {/* Room fill */}
              <path
                d={pathData}
                fill={color}
                fillOpacity={0.3}
                stroke={color}
                strokeWidth="0.5"
              />

              {/* Room label - need to flip text */}
              <g transform={`translate(${room.center[0]}, ${-room.center[1]})`}>
                <g style={{ transform: 'scaleY(-1)' }}>
                  <text
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="3"
                    fontWeight="bold"
                  >
                    {room.name}
                  </text>
                  <text
                    y="4"
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize="2.5"
                  >
                    {room.area.toFixed(0)} sqft
                  </text>
                </g>
              </g>
            </g>
          );
        })}

        {/* Scale bar */}
        <g transform={`translate(${viewBounds.minX + 5}, ${-viewBounds.minY - 5})`}>
          <line x1="0" y1="0" x2="10" y2="0" stroke="#9ca3af" strokeWidth="0.5" />
          <line x1="0" y1="-1" x2="0" y2="1" stroke="#9ca3af" strokeWidth="0.5" />
          <line x1="10" y1="-1" x2="10" y2="1" stroke="#9ca3af" strokeWidth="0.5" />
          <g style={{ transform: 'scaleY(-1)' }}>
            <text x="5" y="3" textAnchor="middle" fill="#9ca3af" fontSize="2">10'</text>
          </g>
        </g>
      </svg>

      {/* Room list */}
      <div className="mt-3 text-xs text-gray-400">
        <div className="font-semibold text-gray-300 mb-1">Rooms:</div>
        <div className="grid grid-cols-2 gap-1">
          {rooms.map((room, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded"
                style={{ backgroundColor: ROOM_COLORS[room.type] || ROOM_COLORS.other }}
              />
              <span>{room.name}: {room.area.toFixed(0)} sqft</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateCenter(points: [number, number][]): [number, number] {
  let sumX = 0, sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }
  return [sumX / points.length, sumY / points.length];
}

function calculateArea(points: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area / 2);
}

function getBounds(points: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}
