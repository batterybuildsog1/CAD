/**
 * CAD3D Core Model Types
 *
 * This module defines the in-memory representation of a fully 3D house model.
 * It is intentionally decoupled from React and rendering. The goal is:
 *
 * - Every 3D element (room, wall, stud, window, pipe, etc.) has:
 *   - A stable, AI-addressable ComponentId
 *   - A well-defined kind (ElementKind)
 *   - Geometry or parameters that can be rendered into 3D
 * - The structure is rich enough to:
 *   - Back a SketchUp/Revit-style editor
 *   - Provide meaningful summaries to Gemini without dumping raw meshes
 */

import type { Point2D } from '@/lib/gemini-types';

/** Opaque identifier for any CAD3D element (room, wall, stud, etc.). */
export type ComponentId = string;

/** High-level classification of elements for filtering and rendering. */
export type ElementKind =
  | 'room'
  | 'wall'
  | 'floor_slab'
  | 'roof'
  | 'stud'
  | 'plate'
  | 'joist'
  | 'rafter'
  | 'sheathing_panel'
  | 'window'
  | 'door'
  | 'stair'
  | 'railing'
  | 'pipe'
  | 'duct'
  | 'conduit'
  | 'fixture'
  | 'generic';

/** Simple 3D transform (position, rotation, scale). */
export interface Transform3D {
  position: [number, number, number]; // [x, y, z]
  rotation: [number, number, number]; // Euler radians [rx, ry, rz]
  scale: [number, number, number];    // [sx, sy, sz]
}

/** Base fields shared by all CAD3D elements. */
export interface BaseElement3D {
  /** Global ID, stable across sessions for AI referencing. */
  id: ComponentId;
  /** What kind of element this is (room, wall, stud, etc.). */
  kind: ElementKind;
  /** Human-readable label (e.g., "Bedroom 2", "North Exterior Wall"). */
  name: string;
  /** Free-form tags for querying and AI context (e.g., "primary_suite", "north_elevation"). */
  tags: string[];
  /** Optional parent element (e.g., studs parented to a wall). */
  parentId?: ComponentId;
  /** Optional children elements (e.g., windows hosted by a wall). */
  childrenIds?: ComponentId[];
}

// ============================================================================
// Primary Architectural Elements
// ============================================================================

/**
 * RoomElement - 3D room volume derived from a 2D footprint.
 *
 * For now we store:
 * - footprint: 2D polygon in level coordinates
 * - height: floor-to-ceiling height for the room volume
 */
export interface RoomElement extends BaseElement3D {
  kind: 'room';
  /** Logical level this room belongs to (LevelId from domain, kept as string here). */
  levelId: string;
  /** Room type (e.g., "bedroom", "kitchen") – stringly-typed for now. */
  roomType: string;
  /** 2D footprint polygon in plan coordinates (same convention as RoomSummary.points). */
  footprint: Point2D[];
  /** Clear room height in feet (or project units). */
  height: number;
}

/**
 * WallElement - 3D wall segment associated with a room or footprint edge.
 *
 * This is a simplified wall representation. Detailed assembly layers (studs,
 * sheathing, finishes) are modeled as separate elements attached to this wall.
 */
export interface WallElement extends BaseElement3D {
  kind: 'wall';
  levelId: string;
  /** Optional room this wall primarily bounds. */
  roomId?: ComponentId;
  /** Wall baseline in plan (centerline or reference line). */
  start: Point2D;
  end: Point2D;
  /** Wall height and thickness in feet (or project units). */
  height: number;
  thickness: number;
  /** Is this an exterior wall? */
  isExterior: boolean;
}

/**
 * Floor slab for a level or room (structural representation, not just visual).
 */
export interface FloorSlabElement extends BaseElement3D {
  kind: 'floor_slab';
  levelId: string;
  /** Slab footprint polygon. */
  footprint: Point2D[];
  /** Thickness of the slab. */
  thickness: number;
}

/**
 * Roof element (very simplified for now).
 */
export interface RoofElement extends BaseElement3D {
  kind: 'roof';
  /** Plan footprint of the roof (can be larger than building footprint for overhangs). */
  footprint: Point2D[];
  /** Generic pitch / height for visual experiments. */
  peakHeight: number;
}

// ============================================================================
// Structural Elements
// ============================================================================

/** Stud (2x4, 2x6, etc.) as a 3D element. */
export interface StudElement extends BaseElement3D {
  kind: 'stud';
  /** Host wall ID. */
  wallId: ComponentId;
  /** Stud length and cross-section dimensions in feet. */
  length: number;
  section: {
    width: number;
    depth: number;
  };
  /** Full 3D transform of the stud in model space. */
  transform: Transform3D;
}

/** Top/bottom plate for framing. */
export interface PlateElement extends BaseElement3D {
  kind: 'plate';
  wallId: ComponentId;
  length: number;
  section: {
    width: number;
    depth: number;
  };
  transform: Transform3D;
}

/** Sheathing panel on a wall (e.g., OSB, plywood). */
export interface SheathingPanelElement extends BaseElement3D {
  kind: 'sheathing_panel';
  wallId: ComponentId;
  /** Panel dimensions in feet. */
  width: number;
  height: number;
  thickness: number;
  /** 3D transform positioning the panel on the wall surface. */
  transform: Transform3D;
}

// ============================================================================
// Openings & Stairs
// ============================================================================

export interface WindowElement extends BaseElement3D {
  kind: 'window';
  wallId: ComponentId;
  /** Reference to a window performance spec (U-value, SHGC, etc.). */
  specId?: WindowSpecId;
  /** Window rough opening size. */
  width: number;
  height: number;
  sillHeight: number;
  /** Transform placing the window in the wall. */
  transform: Transform3D;
}

export interface DoorElement extends BaseElement3D {
  kind: 'door';
  wallId: ComponentId;
  /** Reference to a door performance spec (U-value, fire rating, etc.). */
  specId?: DoorSpecId;
  width: number;
  height: number;
  /** Bottom of door (usually 0' above finished floor). */
  thresholdHeight: number;
  transform: Transform3D;
}

export interface StairElement extends BaseElement3D {
  kind: 'stair';
  /** Path of the stair in plan (start to end). */
  path: Point2D[];
  /** Total rise and run. */
  totalRise: number;
  totalRun: number;
  /** Number of risers/treads for visualization/spacing. */
  riserCount: number;
}

// ============================================================================
// MEP Elements (Plumbing / HVAC / Electrical) – future expansion
// ============================================================================

export interface PipeElement extends BaseElement3D {
  kind: 'pipe';
  /** Polyline in 3D for the pipe centerline. */
  path: [number, number, number][];
  diameter: number;
  system: 'supply' | 'return' | 'waste' | 'vent' | 'other';
}

export interface DuctElement extends BaseElement3D {
  kind: 'duct';
  path: [number, number, number][];
  width: number;
  height: number;
  system: 'supply' | 'return' | 'exhaust' | 'other';
}

export interface ConduitElement extends BaseElement3D {
  kind: 'conduit';
  path: [number, number, number][];
  diameter: number;
  /** Optional description of what this conduit serves. */
  circuitLabel?: string;
}

export interface FixtureElement extends BaseElement3D {
  kind: 'fixture';
  /** Category: sink, toilet, shower, receptacle, light, etc. */
  fixtureType: string;
  /** 3D position of the fixture. */
  transform: Transform3D;
}

// ============================================================================
// Generic / Catch-all Element
// ============================================================================

export interface GenericElement extends BaseElement3D {
  kind: 'generic';
  /** Optional param payload for experimental uses. */
  params?: Record<string, unknown>;
}

// ============================================================================
// Specs & Registries (future performance modeling)
// ============================================================================

export type MaterialId = string;
export type WindowSpecId = string;
export type DoorSpecId = string;
export type WallAssemblySpecId = string;
export type RoofAssemblySpecId = string;
export type SlabAssemblySpecId = string;

/**
 * Basic material definition for assemblies (wall, roof, slab, etc.).
 * Units are explicitly documented so we can plug into energy models later.
 */
export interface MaterialSpec {
  id: MaterialId;
  name: string;
  category: 'wood' | 'metal' | 'concrete' | 'masonry' | 'insulation' | 'gypsum' | 'glass' | 'composite' | 'other';
  /**
   * Density (kg/m³ or lb/ft³). Use the `units` field to clarify which.
   */
  density?: number;
  /**
   * Specific heat capacity (J/kg·K or Btu/lb·°F).
   */
  specificHeat?: number;
  /**
   * Thermal conductivity (W/m·K or Btu/hr·ft·°F).
   */
  thermalConductivity?: number;
  /**
   * Vapor permeance (perms or ng/Pa·s·m²).
   */
  vaporPermeance?: number;
  /**
   * Units metadata so we can convert correctly when needed.
   */
  units?: {
    density?: 'kg/m3' | 'lb/ft3';
    specificHeat?: 'J/kgK' | 'Btu/lbF';
    thermalConductivity?: 'W/mK' | 'Btu/hrftF';
    vaporPermeance?: 'perms' | 'ng/Pa·s·m2';
  };
}

/**
 * NFRC-style window performance specification, independent of any one instance.
 */
export interface WindowSpec {
  id: WindowSpecId;
  name: string;
  family: 'double_hung' | 'casement' | 'fixed' | 'slider' | 'picture' | 'other';
  frameMaterial: 'vinyl' | 'wood' | 'aluminum' | 'fiberglass' | 'composite' | 'other';
  glazing: {
    layers: 1 | 2 | 3;
    gas?: 'air' | 'argon' | 'krypton' | 'other';
    lowE: 'none' | 'single' | 'double';
  };
  /**
   * U-value of the whole unit (Btu/hr·ft²·°F or W/m²K).
   */
  uValue?: number;
  /**
   * Solar Heat Gain Coefficient (0–1).
   */
  shgc?: number;
  /**
   * Visible transmittance (0–1).
   */
  vt?: number;
  /**
   * Air leakage at test pressure (cfm/ft²).
   */
  airLeakage?: number;
  certification?: {
    standard: 'NFRC' | 'other';
    label?: string;
  };
  recommendedWidthRange?: [number, number];
  recommendedHeightRange?: [number, number];
}

export interface DoorSpec {
  id: DoorSpecId;
  name: string;
  family: 'swing' | 'sliding' | 'overhead' | 'other';
  material: 'wood' | 'steel' | 'fiberglass' | 'glass' | 'composite' | 'other';
  coreType: 'solid' | 'hollow' | 'insulated';
  uValue?: number;
  airLeakage?: number;
  stcRating?: number;
  fireRatingMinutes?: number;
}

export interface LayerSpec {
  materialId: MaterialId;
  thickness: number; // in feet (or project units)
  role: 'structure' | 'sheathing' | 'insulation' | 'air_barrier' | 'vapor_control' | 'finish';
}

export interface WallAssemblySpec {
  id: WallAssemblySpecId;
  name: string;
  description?: string;
  layers: LayerSpec[];
  /**
   * Optional precomputed nominal R-value (ft²·°F·hr/Btu or m²K/W).
   */
  rValueNominal?: number;
  climateZonesRecommended?: string[];
  useCases?: ('exterior_above_grade' | 'interior_partition' | 'party_wall')[];
}

export interface RoofAssemblySpec {
  id: RoofAssemblySpecId;
  name: string;
  description?: string;
  layers: LayerSpec[];
  rValueNominal?: number;
  climateZonesRecommended?: string[];
}

export interface SlabAssemblySpec {
  id: SlabAssemblySpecId;
  name: string;
  description?: string;
  layersAbove?: LayerSpec[]; // finishes, toppings
  layersBelow?: LayerSpec[]; // insulation, vapor barrier
  hasEdgeInsulation?: boolean;
  edgeInsulationRValue?: number;
  edgeInsulationDepth?: number;
  underSlabInsulationCoverage?: 'none' | 'full' | 'perimeter_band';
  underSlabRValue?: number;
  soilType?: 'sandy' | 'clayey' | 'rock' | 'other';
  climateZonesRecommended?: string[];
}

/**
 * Bundle of spec registries attached to a Cad3DModel. This lets us grow
 * performance modeling over time without changing element shapes.
 */
export interface Cad3DSpecs {
  materials: MaterialSpec[];
  windowSpecs: WindowSpec[];
  doorSpecs: DoorSpec[];
  wallAssemblies: WallAssemblySpec[];
  roofAssemblies: RoofAssemblySpec[];
  slabAssemblies: SlabAssemblySpec[];
}

// ============================================================================
// Union Types & Model Root
// ============================================================================

/** Union of all supported element types. */
export type CadElement =
  | RoomElement
  | WallElement
  | FloorSlabElement
  | RoofElement
  | StudElement
  | PlateElement
  | SheathingPanelElement
  | WindowElement
  | DoorElement
  | StairElement
  | PipeElement
  | DuctElement
  | ConduitElement
  | FixtureElement
  | GenericElement;

/** Root model container for a single building/project. */
export interface Cad3DModel {
  /** Project-level identifier (can map to ProjectId from domain if needed). */
  id: string;
  name: string;
  /** Optional metadata for debugging and versioning. */
  meta?: {
    createdAt?: string;
    updatedAt?: string;
    source?: string; // e.g., "demo", "imported_from_layout"
  };
  /** Flat list of all elements. Relationships are expressed via parent/child IDs. */
  elements: CadElement[];
  /** Optional performance and construction spec registries. */
  specs?: Cad3DSpecs;
}

/** Helper type guard utilities. */
export function isRoomElement(el: CadElement): el is RoomElement {
  return el.kind === 'room';
}

export function isStudElement(el: CadElement): el is StudElement {
  return el.kind === 'stud';
}


