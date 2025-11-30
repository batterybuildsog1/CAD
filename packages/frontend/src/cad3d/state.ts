/**
 * CAD3D Model State Helpers
 *
 * Lightweight, pure functions for constructing and querying a Cad3DModel.
 * This is NOT a global store or React hook – just utilities that make it
 * easier to build and manipulate models in tests and the CAD Lab.
 */

import type {
  Cad3DModel,
  CadElement,
  ComponentId,
  ElementKind,
  Cad3DSpecs,
} from './model';

/** Create an empty CAD3D model for a project/building. */
export function createEmptyCadModel(name: string, id: string = `cad3d-${Date.now()}`): Cad3DModel {
  const timestamp = new Date().toISOString();
  return {
    id,
    name,
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp,
      source: 'demo',
    },
    elements: [],
    specs: {
      materials: [],
      windowSpecs: [],
      doorSpecs: [],
      wallAssemblies: [],
      roofAssemblies: [],
      slabAssemblies: [],
    },
  };
}

/** Replace the specs bundle on a model (used for bulk updates/imports). */
export function setSpecs(model: Cad3DModel, specs: Cad3DSpecs): Cad3DModel {
  return {
    ...model,
    meta: {
      ...model.meta,
      updatedAt: new Date().toISOString(),
    },
    specs,
  };
}

/** Add a new element to the model, returning a new model instance. */
export function addElement(model: Cad3DModel, element: CadElement): Cad3DModel {
  return {
    ...model,
    meta: {
      ...model.meta,
      updatedAt: new Date().toISOString(),
    },
    elements: [...model.elements, element],
  };
}

/** Replace an existing element (by id) with an updated one. */
export function updateElement(
  model: Cad3DModel,
  elementId: ComponentId,
  updater: (el: CadElement) => CadElement
): Cad3DModel {
  let changed = false;
  const elements = model.elements.map((el) => {
    if (el.id !== elementId) return el;
    changed = true;
    return updater(el);
  });

  if (!changed) return model;

  return {
    ...model,
    meta: {
      ...model.meta,
      updatedAt: new Date().toISOString(),
    },
    elements,
  };
}

/** Find elements by kind (e.g., all studs, all rooms). */
export function findElementsByKind<T extends CadElement>(
  model: Cad3DModel,
  kind: ElementKind
): T[] {
  return model.elements.filter((el) => el.kind === kind) as T[];
}

/** Find a single element by ID. */
export function findElementById<T extends CadElement = CadElement>(
  model: Cad3DModel,
  id: ComponentId
): T | undefined {
  return model.elements.find((el) => el.id === id) as T | undefined;
}


