import { b as bind_props, s as spread_props, a as store_get, u as unsubscribe_stores, c as attr_style, e as ensure_array_like, d as stringify, f as attr_class, g as attr, h as head } from "../../chunks/index2.js";
import "clsx";
import { g as get, w as writable, d as derived, r as readable } from "../../chunks/index.js";
import * as THREE from "three";
import { REVISION, DefaultLoadingManager, Vector3, Sphere, Matrix4, Ray, Object3D, Vector2, DoubleSide, Mesh, Plane, Color, ShaderChunk, Box3, MeshBasicMaterial, BufferGeometry, BufferAttribute, MeshStandardMaterial } from "three";
import mittModule from "mitt";
import { Y as ssr_context, W as getContext, U as setContext, X as escape_html } from "../../chunks/context.js";
import "camera-controls";
import "three-viewport-gizmo";
import { OrbitControls as OrbitControls$1 } from "three/examples/jsm/controls/OrbitControls.js";
import { shaderStructs, shaderIntersectFunction } from "three-mesh-bvh";
import "@threejs-kit/instanced-sprite-mesh";
function fromStore(store) {
  if ("set" in store) {
    return {
      get current() {
        return get(store);
      },
      set current(v) {
        store.set(v);
      }
    };
  }
  return {
    get current() {
      return get(store);
    }
  };
}
function onDestroy(fn) {
  /** @type {SSRContext} */
  ssr_context.r.on_destroy(fn);
}
const signal = Symbol();
const isStore = (dep) => {
  return typeof dep?.subscribe === "function";
};
const runObserve = (dependencies, callback, pre) => {
  const stores = dependencies().map((d) => {
    if (isStore(d)) {
      return fromStore(d);
    }
    return signal;
  });
  dependencies().map((d, i) => {
    if (stores[i] === signal) return d;
    return stores[i].current;
  });
};
const observePost = (dependencies, callback) => {
  return runObserve(dependencies);
};
const observePre = (dependencies, callback) => {
  return runObserve(dependencies);
};
Object.assign(observePost, { pre: observePre });
const isInstanceOf = (obj, type) => {
  return obj?.[`is${type}`] === true;
};
const browser = typeof window !== "undefined";
REVISION.replace("dev", "");
const currentWritable = (value) => {
  const store = writable(value);
  const extendedWritable = {
    set: (value2) => {
      extendedWritable.current = value2;
      store.set(value2);
    },
    subscribe: store.subscribe,
    update: (fn) => {
      const newValue = fn(extendedWritable.current);
      extendedWritable.current = newValue;
      store.set(newValue);
    },
    current: value
  };
  return extendedWritable;
};
const resolvePropertyPath = (target, propertyPath) => {
  if (propertyPath.includes(".")) {
    const path = propertyPath.split(".");
    const key = path.pop();
    for (let i = 0; i < path.length; i += 1) {
      target = target[path[i]];
    }
    return {
      target,
      key
    };
  } else {
    return {
      target,
      key: propertyPath
    };
  }
};
const useDOM = () => {
  const context = getContext("threlte-dom-context");
  if (!context) {
    throw new Error("useDOM can only be used in a child component to <Canvas>.");
  }
  return context;
};
const mitt = mittModule;
class DAG {
  allVertices = {};
  /** Nodes that are fully unlinked */
  isolatedVertices = {};
  connectedVertices = {};
  sortedConnectedValues = [];
  needsSort = false;
  emitter = mitt();
  emit = this.emitter.emit.bind(this.emitter);
  on = this.emitter.on.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);
  get sortedVertices() {
    return this.mapNodes((value) => value);
  }
  moveToIsolated(key) {
    const vertex = this.connectedVertices[key];
    if (!vertex)
      return;
    this.isolatedVertices[key] = vertex;
    delete this.connectedVertices[key];
  }
  moveToConnected(key) {
    const vertex = this.isolatedVertices[key];
    if (!vertex)
      return;
    this.connectedVertices[key] = vertex;
    delete this.isolatedVertices[key];
  }
  getKey = (v) => {
    if (typeof v === "object") {
      return v.key;
    }
    return v;
  };
  add(key, value, options) {
    if (this.allVertices[key] && this.allVertices[key].value !== void 0) {
      throw new Error(`A node with the key ${key.toString()} already exists`);
    }
    let vertex = this.allVertices[key];
    if (!vertex) {
      vertex = {
        value,
        previous: /* @__PURE__ */ new Set(),
        next: /* @__PURE__ */ new Set()
      };
      this.allVertices[key] = vertex;
    } else if (vertex.value === void 0) {
      vertex.value = value;
    }
    const hasEdges = vertex.next.size > 0 || vertex.previous.size > 0;
    if (!options?.after && !options?.before && !hasEdges) {
      this.isolatedVertices[key] = vertex;
      this.emit("node:added", {
        key,
        type: "isolated",
        value
      });
      return;
    } else {
      this.connectedVertices[key] = vertex;
    }
    if (options?.after) {
      const afterArr = Array.isArray(options.after) ? options.after : [options.after];
      afterArr.forEach((after) => {
        vertex.previous.add(this.getKey(after));
      });
      afterArr.forEach((after) => {
        const afterKey = this.getKey(after);
        const linkedAfter = this.allVertices[afterKey];
        if (!linkedAfter) {
          this.allVertices[afterKey] = {
            value: void 0,
            // uninitialized
            previous: /* @__PURE__ */ new Set(),
            next: /* @__PURE__ */ new Set([key])
          };
          this.connectedVertices[afterKey] = this.allVertices[afterKey];
        } else {
          linkedAfter.next.add(key);
          this.moveToConnected(afterKey);
        }
      });
    }
    if (options?.before) {
      const beforeArr = Array.isArray(options.before) ? options.before : [options.before];
      beforeArr.forEach((before) => {
        vertex.next.add(this.getKey(before));
      });
      beforeArr.forEach((before) => {
        const beforeKey = this.getKey(before);
        const linkedBefore = this.allVertices[beforeKey];
        if (!linkedBefore) {
          this.allVertices[beforeKey] = {
            value: void 0,
            // uninitialized
            previous: /* @__PURE__ */ new Set([key]),
            next: /* @__PURE__ */ new Set()
          };
          this.connectedVertices[beforeKey] = this.allVertices[beforeKey];
        } else {
          linkedBefore.previous.add(key);
          this.moveToConnected(beforeKey);
        }
      });
    }
    this.emit("node:added", {
      key,
      type: "connected",
      value
    });
    this.needsSort = true;
  }
  remove(key) {
    const removeKey = this.getKey(key);
    const unlinkedVertex = this.isolatedVertices[removeKey];
    if (unlinkedVertex) {
      delete this.isolatedVertices[removeKey];
      delete this.allVertices[removeKey];
      this.emit("node:removed", {
        key: removeKey,
        type: "isolated"
      });
      return;
    }
    const linkedVertex = this.connectedVertices[removeKey];
    if (!linkedVertex) {
      return;
    }
    linkedVertex.next.forEach((nextKey) => {
      const nextVertex = this.connectedVertices[nextKey];
      if (nextVertex) {
        nextVertex.previous.delete(removeKey);
        if (nextVertex.previous.size === 0 && nextVertex.next.size === 0) {
          this.moveToIsolated(nextKey);
        }
      }
    });
    linkedVertex.previous.forEach((prevKey) => {
      const prevVertex = this.connectedVertices[prevKey];
      if (prevVertex) {
        prevVertex.next.delete(removeKey);
        if (prevVertex.previous.size === 0 && prevVertex.next.size === 0) {
          this.moveToIsolated(prevKey);
        }
      }
    });
    delete this.connectedVertices[removeKey];
    delete this.allVertices[removeKey];
    this.emit("node:removed", {
      key: removeKey,
      type: "connected"
    });
    this.needsSort = true;
  }
  mapNodes(callback) {
    if (this.needsSort) {
      this.sort();
    }
    const result = [];
    this.forEachNode((value, index) => {
      result.push(callback(value, index));
    });
    return result;
  }
  forEachNode(callback) {
    if (this.needsSort) {
      this.sort();
    }
    let index = 0;
    for (; index < this.sortedConnectedValues.length; index++) {
      callback(this.sortedConnectedValues[index], index);
    }
    Reflect.ownKeys(this.isolatedVertices).forEach((key) => {
      const vertex = this.isolatedVertices[key];
      if (vertex.value !== void 0)
        callback(vertex.value, index++);
    });
  }
  getValueByKey(key) {
    return this.allVertices[key]?.value;
  }
  getKeyByValue(value) {
    return Reflect.ownKeys(this.connectedVertices).find((key) => this.connectedVertices[key].value === value) ?? Reflect.ownKeys(this.isolatedVertices).find((key) => this.isolatedVertices[key].value === value);
  }
  sort() {
    const inDegree = /* @__PURE__ */ new Map();
    const zeroInDegreeQueue = [];
    const result = [];
    const connectedVertexKeysWithValues = Reflect.ownKeys(this.connectedVertices).filter((key) => {
      const vertex = this.connectedVertices[key];
      return vertex.value !== void 0;
    });
    connectedVertexKeysWithValues.forEach((vertex) => {
      inDegree.set(vertex, 0);
    });
    connectedVertexKeysWithValues.forEach((vertexKey) => {
      const vertex = this.connectedVertices[vertexKey];
      vertex.next.forEach((next) => {
        const nextVertex = this.connectedVertices[next];
        if (!nextVertex)
          return;
        inDegree.set(next, (inDegree.get(next) || 0) + 1);
      });
    });
    inDegree.forEach((degree, value) => {
      if (degree === 0) {
        zeroInDegreeQueue.push(value);
      }
    });
    while (zeroInDegreeQueue.length > 0) {
      const vertexKey = zeroInDegreeQueue.shift();
      result.push(vertexKey);
      const v = connectedVertexKeysWithValues.find((key) => key === vertexKey);
      if (v) {
        this.connectedVertices[v]?.next.forEach((adjVertex) => {
          const adjVertexInDegree = (inDegree.get(adjVertex) || 0) - 1;
          inDegree.set(adjVertex, adjVertexInDegree);
          if (adjVertexInDegree === 0) {
            zeroInDegreeQueue.push(adjVertex);
          }
        });
      }
    }
    if (result.length !== connectedVertexKeysWithValues.length) {
      throw new Error("The graph contains a cycle, and thus can not be sorted topologically.");
    }
    const filterUndefined = (value) => value !== void 0;
    this.sortedConnectedValues = result.map((key) => this.connectedVertices[key].value).filter(filterUndefined);
    this.needsSort = false;
  }
  clear() {
    this.allVertices = {};
    this.isolatedVertices = {};
    this.connectedVertices = {};
    this.sortedConnectedValues = [];
    this.needsSort = false;
  }
  static isKey(value) {
    return typeof value === "string" || typeof value === "symbol";
  }
  static isValue(value) {
    return typeof value === "object" && "key" in value;
  }
}
const useScheduler = () => {
  const context = getContext("threlte-scheduler-context");
  if (!context) {
    throw new Error("useScheduler can only be used in a child component to <Canvas>.");
  }
  return context;
};
const useCamera = () => {
  const context = getContext("threlte-camera-context");
  if (!context) {
    throw new Error("useCamera can only be used in a child component to <Canvas>.");
  }
  return context;
};
const parentContextKey = Symbol("threlte-parent-context");
const createParentContext = (parent) => {
  const ctx = currentWritable(parent);
  setContext(parentContextKey, ctx);
  return ctx;
};
const useParent = () => {
  const parent = getContext(parentContextKey);
  return parent;
};
const parentObject3DContextKey = Symbol("threlte-parent-object3d-context");
const createParentObject3DContext = (object) => {
  const parentObject3D = getContext(parentObject3DContextKey);
  const object3D = writable(object);
  const ctx = derived([object3D, parentObject3D], ([object3D2, parentObject3D2]) => {
    return object3D2 ?? parentObject3D2;
  });
  setContext(parentObject3DContextKey, ctx);
  return object3D;
};
const useParentObject3D = () => {
  return getContext(parentObject3DContextKey);
};
function useTask(keyOrFn, fnOrOptions, options) {
  if (!browser) {
    return {
      task: void 0,
      start: () => void 0,
      stop: () => void 0,
      started: readable(false)
    };
  }
  let key;
  let fn;
  let opts;
  if (DAG.isKey(keyOrFn)) {
    key = keyOrFn;
    fn = fnOrOptions;
    opts = options;
  } else {
    key = Symbol("useTask");
    fn = keyOrFn;
    opts = fnOrOptions;
  }
  const schedulerCtx = useScheduler();
  let stage = schedulerCtx.mainStage;
  if (opts) {
    if (opts.stage) {
      if (DAG.isValue(opts.stage)) {
        stage = opts.stage;
      } else {
        const maybeStage = schedulerCtx.scheduler.getStage(opts.stage);
        if (!maybeStage) {
          throw new Error(`No stage found with key ${opts.stage.toString()}`);
        }
        stage = maybeStage;
      }
    } else if (opts.after) {
      if (Array.isArray(opts.after)) {
        for (let index = 0; index < opts.after.length; index++) {
          const element = opts.after[index];
          if (DAG.isValue(element)) {
            stage = element.stage;
            break;
          }
        }
      } else if (DAG.isValue(opts.after)) {
        stage = opts.after.stage;
      }
    } else if (opts.before) {
      if (Array.isArray(opts.before)) {
        for (let index = 0; index < opts.before.length; index++) {
          const element = opts.before[index];
          if (DAG.isValue(element)) {
            stage = element.stage;
            break;
          }
        }
      } else if (DAG.isValue(opts.before)) {
        stage = opts.before.stage;
      }
    }
  }
  const started = writable(false);
  const task = stage.createTask(key, fn, opts);
  const start = () => {
    started.set(true);
    if (opts?.autoInvalidate ?? true) {
      schedulerCtx.autoInvalidations.add(fn);
    }
    task.start();
  };
  const stop = () => {
    started.set(false);
    if (opts?.autoInvalidate ?? true) {
      schedulerCtx.autoInvalidations.delete(fn);
    }
    task.stop();
  };
  if (opts?.autoStart ?? true) {
    start();
  } else {
    stop();
  }
  onDestroy(() => {
    stop();
    stage.removeTask(key);
  });
  return {
    task,
    start,
    stop,
    started: {
      subscribe: started.subscribe
    }
  };
}
const useScene = () => {
  const context = getContext("threlte-scene-context");
  if (!context) {
    throw new Error("useScene can only be used in a child component to <Canvas>.");
  }
  return context;
};
const useRenderer = () => {
  const context = getContext("threlte-renderer-context");
  if (!context) {
    throw new Error("useRenderer can only be used in a child component to <Canvas>.");
  }
  return context;
};
const useUserContext = () => {
  const context = getContext("threlte-user-context");
  if (!context) {
    throw new Error("useUserContext can only be used in a child component to <Canvas>.");
  }
  return context;
};
function Canvas($$renderer, $$props) {
  let { children, $$slots, $$events, ...rest } = $$props;
  $$renderer.push(`<div class="svelte-vlsfif"><canvas class="svelte-vlsfif">`);
  {
    $$renderer.push("<!--[!-->");
  }
  $$renderer.push(`<!--]--></canvas></div>`);
}
const useThrelte = () => {
  const schedulerCtx = useScheduler();
  const rendererCtx = useRenderer();
  const cameraCtx = useCamera();
  const sceneCtx = useScene();
  const domCtx = useDOM();
  const context = {
    advance: schedulerCtx.advance,
    autoRender: schedulerCtx.autoRender,
    autoRenderTask: rendererCtx.autoRenderTask,
    camera: cameraCtx.camera,
    colorManagementEnabled: rendererCtx.colorManagementEnabled,
    colorSpace: rendererCtx.colorSpace,
    dpr: rendererCtx.dpr,
    invalidate: schedulerCtx.invalidate,
    mainStage: schedulerCtx.mainStage,
    renderer: rendererCtx.renderer,
    renderMode: schedulerCtx.renderMode,
    renderStage: schedulerCtx.renderStage,
    scheduler: schedulerCtx.scheduler,
    shadows: rendererCtx.shadows,
    shouldRender: schedulerCtx.shouldRender,
    dom: domCtx.dom,
    canvas: domCtx.canvas,
    size: domCtx.size,
    toneMapping: rendererCtx.toneMapping,
    get scene() {
      return sceneCtx.scene;
    },
    set scene(scene) {
      sceneCtx.scene = scene;
    }
  };
  return context;
};
const useAttach = (getRef, getAttach) => {
  const { invalidate } = useThrelte();
  fromStore(useParent());
  fromStore(useParentObject3D());
  createParentContext();
  createParentObject3DContext();
};
const contextName = Symbol("threlte-disposable-object-context");
const useSetDispose = (getDispose) => {
  const parentDispose = getContext(contextName);
  const mergedDispose = getDispose() ?? parentDispose?.() ?? true;
  setContext(contextName, () => mergedDispose);
};
const useEvents = (getRef, propKeys, props) => {
  for (const key of propKeys) {
    props[key];
    if (key.startsWith("on")) ;
  }
};
let currentIs;
const setIs = (is) => {
  currentIs = is;
};
const useIs = () => {
  const is = currentIs;
  currentIs = void 0;
  return is;
};
const pluginContextKey = "threlte-plugin-context";
const usePlugins = (args) => {
  const plugins = getContext(pluginContextKey);
  if (!plugins)
    return;
  const pluginsProps = [];
  const pluginsArray = Object.values(plugins);
  if (pluginsArray.length > 0) {
    const pluginArgs = args();
    for (let i = 0; i < pluginsArray.length; i++) {
      const plugin = pluginsArray[i];
      const p = plugin(pluginArgs);
      if (p && p.pluginProps) {
        pluginsProps.push(...p.pluginProps);
      }
    }
  }
  return {
    pluginsProps
  };
};
const ignoredProps = /* @__PURE__ */ new Set(["$$scope", "$$slots", "type", "args", "attach", "instance"]);
const updateProjectionMatrixKeys = /* @__PURE__ */ new Set([
  "fov",
  "aspect",
  "near",
  "far",
  "left",
  "right",
  "top",
  "bottom",
  "zoom"
]);
const memoizeProp = (value) => {
  if (typeof value === "string")
    return true;
  if (typeof value === "number")
    return true;
  if (typeof value === "boolean")
    return true;
  if (typeof value === "undefined")
    return true;
  if (value === null)
    return true;
  return false;
};
const createSetter = (target, key, value) => {
  if (!Array.isArray(value) && typeof value === "number" && typeof target[key] === "object" && target[key] !== null && typeof target[key]?.setScalar === "function" && // colors do have a setScalar function, but we don't want to use it, because
  // the hex notation (i.e. 0xff0000) is very popular and matches the number
  // type. So we exclude colors here.
  !target[key]?.isColor) {
    return (target2, key2, value2) => {
      target2[key2].setScalar(value2);
    };
  } else {
    if (typeof target[key]?.set === "function" && typeof target[key] === "object" && target[key] !== null) {
      if (Array.isArray(value)) {
        return (target2, key2, value2) => {
          target2[key2].set(...value2);
        };
      } else {
        return (target2, key2, value2) => {
          target2[key2].set(value2);
        };
      }
    } else {
      return (target2, key2, value2) => {
        target2[key2] = value2;
      };
    }
  }
};
const useProps = () => {
  const { invalidate } = useThrelte();
  const memoizedProps = /* @__PURE__ */ new Map();
  const memoizedSetters = /* @__PURE__ */ new Map();
  const setProp = (instance, propertyPath, value, manualCamera) => {
    if (memoizeProp(value)) {
      const memoizedProp = memoizedProps.get(propertyPath);
      if (memoizedProp && memoizedProp.instance === instance && memoizedProp.value === value) {
        return;
      }
      memoizedProps.set(propertyPath, {
        instance,
        value
      });
    }
    const { key, target } = resolvePropertyPath(instance, propertyPath);
    if (value !== void 0 && value !== null) {
      const memoizedSetter = memoizedSetters.get(propertyPath);
      if (memoizedSetter) {
        memoizedSetter(target, key, value);
      } else {
        const setter = createSetter(target, key, value);
        memoizedSetters.set(propertyPath, setter);
        setter(target, key, value);
      }
    } else {
      createSetter(target, key, value)(target, key, value);
    }
    if (manualCamera)
      return;
    if (updateProjectionMatrixKeys.has(key) && (target.isPerspectiveCamera || target.isOrthographicCamera)) {
      target.updateProjectionMatrix();
    }
  };
  const updateProp = (instance, key, value, pluginsProps, manualCamera) => {
    if (!ignoredProps.has(key) && !pluginsProps?.includes(key)) {
      setProp(instance, key, value, manualCamera);
    }
    invalidate();
  };
  return {
    updateProp
  };
};
const isClass = (input) => {
  return typeof input === "function" && Function.prototype.toString.call(input).startsWith("class ");
};
const determineRef = (is, args) => {
  if (isClass(is)) {
    if (Array.isArray(args)) {
      return new is(...args);
    } else {
      return new is();
    }
  }
  return is;
};
function T$1($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      is = useIs(),
      args,
      attach,
      manual = false,
      makeDefault = false,
      dispose,
      ref = void 0,
      oncreate,
      children,
      $$slots,
      $$events,
      ...props
    } = $$props;
    const internalRef = determineRef(is, args);
    usePlugins(() => ({
      get ref() {
        return internalRef;
      },
      get args() {
        return args;
      },
      get attach() {
        return attach;
      },
      get manual() {
        return manual;
      },
      get makeDefault() {
        return makeDefault;
      },
      get dispose() {
        return dispose;
      },
      get props() {
        return props;
      }
    }));
    const propKeys = Object.keys(props);
    useProps();
    propKeys.forEach((key) => {
      props[key];
    });
    useAttach();
    useSetDispose(() => dispose);
    useEvents(() => internalRef, propKeys, props);
    children?.($$renderer2, { ref: internalRef });
    $$renderer2.push(`<!---->`);
    bind_props($$props, { ref });
  });
}
const catalogue = {};
const T = new Proxy(T$1, {
  get(_target, is) {
    if (typeof is !== "string") {
      return T$1;
    }
    const module = catalogue[is] || THREE[is];
    if (module === void 0) {
      throw new Error(`No Three.js module found for ${is}. Did you forget to extend the catalogue?`);
    }
    setIs(module);
    return T$1;
  }
});
function useThrelteUserContext(namespace, value, options) {
  const userCtxStore = useUserContext();
  if (!userCtxStore) {
    throw new Error("No user context store found, did you invoke this function outside of your main <Canvas> component?");
  }
  if (!value) {
    return derived(userCtxStore, (ctx) => ctx[namespace]);
  }
  userCtxStore.update((ctx) => {
    if (namespace in ctx) {
      return ctx;
    }
    const v = typeof value === "function" ? value() : value;
    ctx[namespace] = v;
    return ctx;
  });
  return userCtxStore.current[namespace];
}
const toCurrentReadable = (store) => {
  return {
    subscribe: store.subscribe,
    get current() {
      return store.current;
    }
  };
};
let previousTotalLoaded = 0;
const finishedOnce = currentWritable(false);
const activeStore = currentWritable(false);
const itemStore = currentWritable(void 0);
const loadedStore = currentWritable(0);
const totalStore = currentWritable(0);
const errorsStore = currentWritable([]);
const progressStore = currentWritable(0);
const { onStart, onLoad, onError } = DefaultLoadingManager;
DefaultLoadingManager.onStart = (url, loaded, total) => {
  onStart?.(url, loaded, total);
  activeStore.set(true);
  itemStore.set(url);
  loadedStore.set(loaded);
  totalStore.set(total);
  const progress = (loaded - previousTotalLoaded) / (total - previousTotalLoaded);
  progressStore.set(progress);
  if (progress === 1)
    finishedOnce.set(true);
};
DefaultLoadingManager.onLoad = () => {
  onLoad?.();
  activeStore.set(false);
};
DefaultLoadingManager.onError = (url) => {
  onError?.(url);
  errorsStore.update((errors) => {
    return [...errors, url];
  });
};
DefaultLoadingManager.onProgress = (url, loaded, total) => {
  if (loaded === total) {
    previousTotalLoaded = total;
  }
  activeStore.set(true);
  itemStore.set(url);
  loadedStore.set(loaded);
  totalStore.set(total);
  const progress = (loaded - previousTotalLoaded) / (total - previousTotalLoaded) || 1;
  progressStore.set(progress);
  if (progress === 1)
    finishedOnce.set(true);
};
({
  active: toCurrentReadable(activeStore),
  item: toCurrentReadable(itemStore),
  loaded: toCurrentReadable(loadedStore),
  total: toCurrentReadable(totalStore),
  errors: toCurrentReadable(errorsStore),
  progress: toCurrentReadable(progressStore),
  finishedOnce: toCurrentReadable(finishedOnce)
});
new Vector3();
new Vector3();
new Vector3();
new Sphere();
new Matrix4();
new Ray();
new Vector3();
new Vector3();
new Matrix4();
new Vector3();
new Vector3();
new Object3D();
new Vector3();
new Vector3();
new Vector3();
new Vector2();
const vertexShader = (
  /*glsl*/
  `
  varying vec3 localPosition;
  varying vec4 worldPosition;

  uniform vec3 worldCamProjPosition;
	uniform vec3 worldPlanePosition;
	uniform float fadeDistance;
	uniform bool infiniteGrid;
	uniform bool followCamera;

	uniform int coord0;
	uniform int coord1;
	uniform int coord2;

	void main() {
		localPosition = vec3(
		  position[coord0],
			position[coord1],
			position[coord2]
		);

		if (infiniteGrid) {
		  localPosition *= 1.0 + fadeDistance;
		}

		worldPosition = modelMatrix * vec4(localPosition, 1.0);
		if (followCamera) {
		  worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
      localPosition = (inverse(modelMatrix) * worldPosition).xyz;
		}

		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`
);
const fragmentShader = (
  /*glsl*/
  `
  #define PI 3.141592653589793

	varying vec3 localPosition;
	varying vec4 worldPosition;

	uniform vec3 worldCamProjPosition;
	uniform float cellSize;
	uniform float sectionSize;
	uniform vec3 cellColor;
	uniform vec3 sectionColor;
	uniform float fadeDistance;
	uniform float fadeStrength;
	uniform vec3 fadeOrigin;
	uniform float cellThickness;
	uniform float sectionThickness;
	uniform vec3 backgroundColor;
	uniform float backgroundOpacity;

	uniform bool infiniteGrid;

	uniform int coord0;
	uniform int coord1;
	uniform int coord2;

	// 0 - default; 1 - lines; 2 - circles; 3 - polar
	uniform int gridType;

  // lineGrid coord for lines
	uniform int lineGridCoord;

	// circlegrid max radius
	uniform float circleGridMaxRadius;

	// polar grid dividers
	uniform float polarCellDividers;
	uniform float polarSectionDividers;

	float getSquareGrid(float size, float thickness, vec3 localPos) {
		vec2 coord = localPos.xy / size;

		vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
		float line = min(grid.x, grid.y) + 1.0 - thickness;

		return 1.0 - min(line, 1.0);
	}

	float getLinesGrid(float size, float thickness, vec3 localPos) {
		float coord = localPos[lineGridCoord] / size;
		float line = abs(fract(coord - 0.5) - 0.5) / fwidth(coord) - thickness * 0.2;

		return 1.0 - min(line, 1.0);
	}

	float getCirclesGrid(float size, float thickness, vec3 localPos) {
		float coord = length(localPos.xy) / size;
		float line = abs(fract(coord - 0.5) - 0.5) / fwidth(coord) - thickness * 0.2;

		if (!infiniteGrid && circleGridMaxRadius > 0. && coord > circleGridMaxRadius + thickness * 0.05) {
		  discard;
		}

		return 1.0 - min(line, 1.0);
	}

	float getPolarGrid(float size, float thickness, float polarDividers, vec3 localPos) {
		float rad = length(localPos.xy) / size;
		vec2 coord = vec2(rad, atan(localPos.x, localPos.y) * polarDividers / PI) ;

		vec2 wrapped = vec2(coord.x, fract(coord.y / (2.0 * polarDividers)) * (2.0 * polarDividers));
		vec2 coordWidth = fwidth(coord);
		vec2 wrappedWidth = fwidth(wrapped);
		vec2 width = (coord.y < -polarDividers * 0.5 || coord.y > polarDividers * 0.5 ? wrappedWidth : coordWidth) * (1.+thickness*0.25);

		// Compute anti-aliased world-space grid lines
		vec2 grid = abs(fract(coord - 0.5) - 0.5) / width;
		float line = min(grid.x, grid.y);

if (!infiniteGrid && circleGridMaxRadius > 0.0 && rad > circleGridMaxRadius + thickness * 0.05) {
		  discard;
		}

		return 1.0 - min(line, 1.0);
	}

	void main() {
		float g1 = 0.0;
		float g2 = 0.0;

		vec3 localPos = vec3(localPosition[coord0], localPosition[coord1], localPosition[coord2]);

		if (gridType == 0) {
			g1 = getSquareGrid(cellSize, cellThickness, localPos);
			g2 = getSquareGrid(sectionSize, sectionThickness, localPos);

		} else if (gridType == 1) {
			g1 = getLinesGrid(cellSize, cellThickness, localPos);
			g2 = getLinesGrid(sectionSize, sectionThickness, localPos);

		} else if (gridType == 2) {
			g1 = getCirclesGrid(cellSize, cellThickness, localPos);
			g2 = getCirclesGrid(sectionSize, sectionThickness, localPos);

		} else if (gridType == 3) {
			g1 = getPolarGrid(cellSize, cellThickness, polarCellDividers, localPos);
			g2 = getPolarGrid(sectionSize, sectionThickness, polarSectionDividers, localPos);
		}

		float dist = distance(fadeOrigin, worldPosition.xyz);
		float d = 1.0 - min(dist / fadeDistance, 1.0);
		float fadeFactor = pow(d, fadeStrength) * 0.95;

		vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));

		if (backgroundOpacity > 0.0) {
			float linesAlpha = clamp((g1 + g2) * fadeFactor, 0.0,1.0);
			vec3 finalColor = mix(backgroundColor, color, linesAlpha);
			float blendedAlpha = max(linesAlpha, backgroundOpacity * fadeFactor);
			gl_FragColor = vec4(finalColor, blendedAlpha);

		} else {
			gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
			gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
		}

		if (gl_FragColor.a <= 0.0) {
		  discard;
		}

		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	}
`
);
function Grid($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      cellColor = "#000000",
      sectionColor = "#0000ee",
      cellSize = 1,
      backgroundColor = "#dadada",
      backgroundOpacity = 0,
      sectionSize = 10,
      plane = "xz",
      gridSize = [20, 20],
      followCamera = false,
      infiniteGrid = false,
      fadeDistance = 100,
      fadeStrength = 1,
      fadeOrigin = void 0,
      cellThickness = 1,
      sectionThickness = 2,
      side = DoubleSide,
      type = "grid",
      axis = "x",
      maxRadius = 0,
      cellDividers = 6,
      sectionDividers = 2,
      ref = void 0,
      children,
      $$slots,
      $$events,
      ...props
    } = $$props;
    const mesh = new Mesh();
    const { invalidate, camera } = useThrelte();
    const gridPlane = new Plane();
    const upVector = new Vector3(0, 1, 0);
    const zeroVector = new Vector3(0, 0, 0);
    const axisToInt = { x: 0, y: 1, z: 2 };
    const gridType = { grid: 0 };
    const uniforms = {
      cellSize: { value: cellSize },
      sectionSize: { value: sectionSize },
      cellColor: { value: new Color(cellColor) },
      sectionColor: { value: new Color(sectionColor) },
      backgroundColor: { value: new Color(backgroundColor) },
      backgroundOpacity: { value: backgroundOpacity },
      fadeDistance: { value: fadeDistance },
      fadeStrength: { value: fadeStrength },
      fadeOrigin: { value: new Vector3() },
      cellThickness: { value: cellThickness },
      sectionThickness: { value: sectionThickness },
      infiniteGrid: { value: infiniteGrid },
      followCamera: { value: followCamera },
      coord0: { value: 0 },
      coord1: { value: 2 },
      coord2: { value: 1 },
      gridType: { value: gridType.grid },
      lineGridCoord: { value: axisToInt[axis] },
      circleGridMaxRadius: { value: maxRadius },
      polarCellDividers: { value: cellDividers },
      polarSectionDividers: { value: sectionDividers },
      worldCamProjPosition: { value: new Vector3() },
      worldPlanePosition: { value: new Vector3() }
    };
    useTask(
      () => {
        gridPlane.setFromNormalAndCoplanarPoint(upVector, zeroVector).applyMatrix4(mesh.matrixWorld);
        const material = mesh.material;
        const worldCamProjPosition = material.uniforms.worldCamProjPosition;
        const worldPlanePosition = material.uniforms.worldPlanePosition;
        const uFadeOrigin = material.uniforms.fadeOrigin;
        const projectedPoint = gridPlane.projectPoint(camera.current.position, worldCamProjPosition.value);
        if (!fadeOrigin) {
          uFadeOrigin.value = projectedPoint;
        }
        worldPlanePosition.value.set(0, 0, 0).applyMatrix4(mesh.matrixWorld);
      },
      { autoInvalidate: false }
    );
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      T($$renderer3, spread_props([
        { is: mesh, frustumCulled: false },
        props,
        {
          get ref() {
            return ref;
          },
          set ref($$value) {
            ref = $$value;
            $$settled = false;
          },
          children: ($$renderer4) => {
            $$renderer4.push(`<!---->`);
            T.ShaderMaterial($$renderer4, {
              fragmentShader,
              vertexShader,
              uniforms,
              transparent: true,
              side
            });
            $$renderer4.push(`<!----> `);
            if (children) {
              $$renderer4.push("<!--[-->");
              children($$renderer4, { ref: mesh });
              $$renderer4.push(`<!---->`);
            } else {
              $$renderer4.push("<!--[!-->");
              $$renderer4.push(`<!---->`);
              T.PlaneGeometry($$renderer4, {
                args: typeof gridSize == "number" ? [gridSize, gridSize] : gridSize
              });
              $$renderer4.push(`<!---->`);
            }
            $$renderer4.push(`<!--]-->`);
          },
          $$slots: { default: true }
        }
      ]));
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
    bind_props($$props, { ref });
  });
}
const useControlsContext = () => {
  return useThrelteUserContext("threlte-controls", {
    orbitControls: writable(void 0),
    trackballControls: writable(void 0)
  });
};
function OrbitControls($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let { ref = void 0, children, $$slots, $$events, ...props } = $$props;
    const parent = useParent();
    const { dom, invalidate } = useThrelte();
    if (!isInstanceOf(store_get($$store_subs ??= {}, "$parent", parent), "Camera")) {
      throw new Error("Parent missing: <OrbitControls> need to be a child of a <Camera>");
    }
    const controls = new OrbitControls$1(store_get($$store_subs ??= {}, "$parent", parent), dom);
    const { orbitControls } = useControlsContext();
    const { start, stop } = useTask(
      () => {
        controls.update();
      },
      { autoStart: false, autoInvalidate: false }
    );
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      T($$renderer3, spread_props([
        { is: controls },
        props,
        {
          get ref() {
            return ref;
          },
          set ref($$value) {
            ref = $$value;
            $$settled = false;
          },
          children: ($$renderer4) => {
            children?.($$renderer4, { ref: controls });
            $$renderer4.push(`<!---->`);
          },
          $$slots: { default: true }
        }
      ]));
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
    if ($$store_subs) unsubscribe_stores($$store_subs);
    bind_props($$props, { ref });
  });
}
new Matrix4();
new Matrix4();
new Mesh();
`
    #include <common>
    ${ShaderChunk.logdepthbuf_pars_vertex}
    ${ShaderChunk.fog_pars_vertex}

    attribute vec3 previous;
    attribute vec3 next;
    attribute float side;
    attribute float width;
    attribute float counters;

    uniform vec2 resolution;
    uniform float lineWidth;
    uniform vec3 color;
    uniform float opacity;
    uniform float sizeAttenuation;
    uniform float scaleDown;

    varying vec2 vUV;
    varying vec4 vColor;
    varying float vCounters;

    vec2 intoScreen(vec4 i) {
        return resolution * (0.5 * i.xy / i.w + 0.5);
    }

    void main() {
        float aspect = resolution.y / resolution.x;

        mat4 m = projectionMatrix * modelViewMatrix;

        vec4 currentClip = m * vec4( position, 1.0 );
        vec4 prevClip = m * vec4( previous, 1.0 );
        vec4 nextClip = m * vec4( next, 1.0 );

        vec4 currentNormed = currentClip / currentClip.w;
        vec4 prevNormed = prevClip / prevClip.w;
        vec4 nextNormed = nextClip / nextClip.w;

        vec2 currentScreen = intoScreen(currentNormed);
        vec2 prevScreen = intoScreen(prevNormed);
        vec2 nextScreen = intoScreen(nextNormed);

        float actualWidth = lineWidth * width;

        vec2 dir;
        if(nextScreen == currentScreen) {
            dir = normalize( currentScreen - prevScreen );
        } else if(prevScreen == currentScreen) {
            dir = normalize( nextScreen - currentScreen );
        } else {
            vec2 inDir = currentScreen - prevScreen;
            vec2 outDir = nextScreen - currentScreen;
            vec2 fullDir = nextScreen - prevScreen;

            if(length(fullDir) > 0.0) {
                dir = normalize(fullDir);
            } else if(length(inDir) > 0.0){
                dir = normalize(inDir);
            } else {
                dir = normalize(outDir);
            }
        }

        vec2 normal = vec2(-dir.y, dir.x);

        if(sizeAttenuation != 0.0) {
            normal /= currentClip.w;
            normal *= min(resolution.x, resolution.y);
        }

        if (scaleDown > 0.0) {
            float dist = length(nextNormed - prevNormed);
            normal *= smoothstep(0.0, scaleDown, dist);
        }

        vec2 offsetInScreen = actualWidth * normal * side * 0.5;

        vec2 withOffsetScreen = currentScreen + offsetInScreen;
        vec3 withOffsetNormed = vec3((2.0 * withOffsetScreen/resolution - 1.0), currentNormed.z);

        vCounters = counters;
        vColor = vec4( color, opacity );
        vUV = uv;

        gl_Position = currentClip.w * vec4(withOffsetNormed, 1.0);

        ${ShaderChunk.logdepthbuf_vertex}
        ${ShaderChunk.fog_vertex}
    }
`;
`
uniform vec3 glowColor;
uniform float falloffAmount;
uniform float glowSharpness;
uniform float glowInternalRadius;

varying vec3 vPosition;
varying vec3 vNormal;

void main()
{
	// Normal
	vec3 normal = normalize(vNormal);
	if(!gl_FrontFacing)
			normal *= - 1.0;
	vec3 viewDirection = normalize(cameraPosition - vPosition);
	float fresnel = dot(viewDirection, normal);
	fresnel = pow(fresnel, glowInternalRadius + 0.1);
	float falloff = smoothstep(0., falloffAmount, fresnel);
	float fakeGlow = fresnel;
	fakeGlow += fresnel * glowSharpness;
	fakeGlow *= falloff;
	gl_FragColor = vec4(clamp(glowColor * fresnel, 0., 1.0), clamp(fakeGlow, 0., 1.0));

	${ShaderChunk.tonemapping_fragment}
	${ShaderChunk.colorspace_fragment}
}`;
`
uniform sampler2D pointTexture;
uniform float fade;
uniform float opacity;

varying vec3 vColor;
void main() {
	float pointOpacity = 1.0;
	if (fade == 1.0) {
		float d = distance(gl_PointCoord, vec2(0.5, 0.5));
		pointOpacity = 1.0 / (1.0 + exp(16.0 * (d - 0.25)));
	}
	gl_FragColor = vec4(vColor, pointOpacity * opacity);

	${ShaderChunk.tonemapping_fragment}
	${ShaderChunk.colorspace_fragment}
}`;
`#define ENVMAP_TYPE_CUBE_UV
precision highp isampler2D;
precision highp usampler2D;
varying vec3 vWorldPosition;
varying vec3 vNormal;
varying mat4 vModelMatrixInverse;

#ifdef USE_INSTANCING_COLOR
	varying vec3 vInstanceColor;
#endif

#ifdef ENVMAP_TYPE_CUBEM
	uniform samplerCube envMap;
#else
	uniform sampler2D envMap;
#endif

uniform float bounces;
${shaderStructs}
${shaderIntersectFunction}
uniform BVH bvh;
uniform float ior;
uniform bool correctMips;
uniform vec2 resolution;
uniform float fresnel;
uniform mat4 modelMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 viewMatrixInverse;
uniform float aberrationStrength;
uniform vec3 color;

float fresnelFunc(vec3 viewDirection, vec3 worldNormal) {
	return pow( 1.0 + dot( viewDirection, worldNormal), 10.0 );
}

vec3 totalInternalReflection(vec3 ro, vec3 rd, vec3 normal, float ior, mat4 modelMatrixInverse) {
	vec3 rayOrigin = ro;
	vec3 rayDirection = rd;
	rayDirection = refract(rayDirection, normal, 1.0 / ior);
	rayOrigin = vWorldPosition + rayDirection * 0.001;
	rayOrigin = (modelMatrixInverse * vec4(rayOrigin, 1.0)).xyz;
	rayDirection = normalize((modelMatrixInverse * vec4(rayDirection, 0.0)).xyz);
	for(float i = 0.0; i < bounces; i++) {
		uvec4 faceIndices = uvec4( 0u );
		vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
		vec3 barycoord = vec3( 0.0 );
		float side = 1.0;
		float dist = 0.0;
		bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
		vec3 hitPos = rayOrigin + rayDirection * max(dist - 0.001, 0.0);
		vec3 tempDir = refract(rayDirection, faceNormal, ior);
		if (length(tempDir) != 0.0) {
			rayDirection = tempDir;
			break;
		}
		rayDirection = reflect(rayDirection, faceNormal);
		rayOrigin = hitPos + rayDirection * 0.01;
	}
	rayDirection = normalize((modelMatrix * vec4(rayDirection, 0.0)).xyz);
	return rayDirection;
}

#include <common>
#include <cube_uv_reflection_fragment>

#ifdef ENVMAP_TYPE_CUBEM
	vec4 textureGradient(samplerCube envMap, vec3 rayDirection, vec3 directionCamPerfect) {
		return textureGrad(envMap, rayDirection, dFdx(correctMips ? directionCamPerfect: rayDirection), dFdy(correctMips ? directionCamPerfect: rayDirection));
	}
#else
	vec4 textureGradient(sampler2D envMap, vec3 rayDirection, vec3 directionCamPerfect) {
		vec2 uvv = equirectUv( rayDirection );
		vec2 smoothUv = equirectUv( directionCamPerfect );
		return textureGrad(envMap, uvv, dFdx(correctMips ? smoothUv : uvv), dFdy(correctMips ? smoothUv : uvv));
	}
#endif

void main() {
	vec2 uv = gl_FragCoord.xy / resolution;
	vec3 directionCamPerfect = (projectionMatrixInverse * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
	directionCamPerfect = (viewMatrixInverse * vec4(directionCamPerfect, 0.0)).xyz;
	directionCamPerfect = normalize(directionCamPerfect);
	vec3 normal = vNormal;
	vec3 rayOrigin = cameraPosition;
	vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
	vec3 finalColor;
	#ifdef CHROMATIC_ABERRATIONS
		vec3 rayDirectionG = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), vModelMatrixInverse);
		#ifdef FAST_CHROMA
			vec3 rayDirectionR = normalize(rayDirectionG + 1.0 * vec3(aberrationStrength / 2.0));
			vec3 rayDirectionB = normalize(rayDirectionG - 1.0 * vec3(aberrationStrength / 2.0));
		#else
			vec3 rayDirectionR = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 - aberrationStrength), 1.0), vModelMatrixInverse);
			vec3 rayDirectionB = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 + aberrationStrength), 1.0), vModelMatrixInverse);
		#endif
		float finalColorR = textureGradient(envMap, rayDirectionR, directionCamPerfect).r;
		float finalColorG = textureGradient(envMap, rayDirectionG, directionCamPerfect).g;
		float finalColorB = textureGradient(envMap, rayDirectionB, directionCamPerfect).b;
		finalColor = vec3(finalColorR, finalColorG, finalColorB);
	#else
		rayDirection = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), vModelMatrixInverse);
		finalColor = textureGradient(envMap, rayDirection, directionCamPerfect).rgb;
	#endif

	finalColor *= color;
	#ifdef USE_INSTANCING_COLOR
		finalColor *= vInstanceColor;
	#endif

	vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
	float nFresnel = fresnelFunc(viewDirection, normal) * fresnel;
	gl_FragColor = vec4(mix(finalColor, vec3(1.0), nFresnel), 1.0);
	${ShaderChunk.tonemapping_fragment}
	${ShaderChunk.colorspace_fragment}
}`;
new Box3();
typeof window !== "undefined" ? document.createElement("div") : void 0;
new MeshBasicMaterial();
new Vector3();
new Matrix4();
new Ray();
new Sphere();
new Box3();
new Vector3();
new Vector3();
let wasmStore = null;
let initPromise = null;
async function getWasmStore() {
  if (wasmStore) return wasmStore;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const wasm = await import("../../chunks/geometry_wasm.js");
    await wasm.default();
    wasm.init_panic_hook();
    wasmStore = new wasm.WasmStore();
    return wasmStore;
  })();
  return initPromise;
}
async function resetWasmStore() {
  if (wasmStore) {
    wasmStore.free();
  }
  wasmStore = null;
  initPromise = null;
  return getWasmStore();
}
const materialCache = /* @__PURE__ */ new Map();
class WasmGeometryLoader {
  /**
   * Convert a WasmMesh to a THREE.BufferGeometry
   */
  static load(wasmMesh) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(wasmMesh.positions, 3)
    );
    geometry.setAttribute(
      "normal",
      new BufferAttribute(wasmMesh.normals, 3)
    );
    geometry.setIndex(new BufferAttribute(wasmMesh.indices, 1));
    wasmMesh.free();
    return geometry;
  }
  /**
   * Get cached material for a color - prevents memory leaks from duplicate materials
   */
  static getCachedMaterial(color = 14870768) {
    if (!materialCache.has(color)) {
      materialCache.set(color, new MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.05,
        side: DoubleSide
      }));
    }
    return materialCache.get(color);
  }
  /**
   * Create a new material (for cases where caching isn't desired)
   */
  static createMaterial(color = 14870768) {
    return new MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
      side: DoubleSide
    });
  }
  /**
   * Clear material cache (call on cleanup)
   */
  static clearCache() {
    materialCache.forEach((m) => m.dispose());
    materialCache.clear();
  }
}
function createEmptyState() {
  return {
    floorplan: { rooms: [], walls: [], openings: [] },
    layout: {
      totalArea: 0,
      boundingBox: { width: 0, depth: 0 },
      roomAdjacencies: [],
      circulation: []
    },
    constraints: { satisfied: [], violated: [], warnings: [] },
    footprint: { width: 0, depth: 0 }
  };
}
function deriveObservableState(store, levelId) {
  if (store.get_observable_state) {
    try {
      const wasmState = store.get_observable_state(levelId);
      if (wasmState) {
        return wasmState;
      }
    } catch (e) {
      console.warn("[deriveObservableState] WASM query failed, falling back to empty state:", e);
    }
  }
  return createEmptyState();
}
class WasmStoreManager {
  // Reactive state using Svelte 5 runes
  #store = null;
  #loading = true;
  #error = null;
  #levelIds = [];
  #observableState = createEmptyState();
  #mutationCount = 0;
  // Getters for reactive access
  get store() {
    return this.#store;
  }
  get loading() {
    return this.#loading;
  }
  get error() {
    return this.#error;
  }
  get levelIds() {
    return this.#levelIds;
  }
  get observableState() {
    return this.#observableState;
  }
  get mutationCount() {
    return this.#mutationCount;
  }
  /**
   * Initialize WASM store
   */
  async init() {
    if (this.#store) return;
    try {
      this.#store = await getWasmStore();
      this.#loading = false;
    } catch (e) {
      this.#error = e instanceof Error ? e.message : "WASM load failed";
      this.#loading = false;
      throw e;
    }
  }
  /**
   * Reset to fresh state
   */
  async reset() {
    this.#store = await resetWasmStore();
    this.#levelIds = [];
    this.#observableState = createEmptyState();
    this.#mutationCount = 0;
  }
  /**
   * Add a level ID
   */
  addLevel(levelId) {
    if (!this.#levelIds.includes(levelId)) {
      this.#levelIds = [...this.#levelIds, levelId];
    }
  }
  /**
   * Remove a level ID and clear state
   */
  removeLevel(levelId) {
    this.#levelIds = this.#levelIds.filter((id) => id !== levelId);
    if (this.#levelIds.length === 0) {
      this.#observableState = createEmptyState();
    }
  }
  /**
   * Sync observable state from WASM - call after every tool execution
   */
  syncFromWasm() {
    if (!this.#store || this.#levelIds.length === 0) {
      this.#observableState = createEmptyState();
      return;
    }
    const extStore = this.#store;
    this.#observableState = deriveObservableState(extStore, this.#levelIds[0]);
    this.#mutationCount++;
  }
  /**
   * Update observable state directly (for manual updates before WASM query methods exist)
   */
  updateState(updater) {
    this.#observableState = updater(this.#observableState);
    this.#mutationCount++;
  }
  /**
   * Set footprint dimensions
   */
  setFootprint(width, depth) {
    this.#observableState = { ...this.#observableState, footprint: { width, depth } };
  }
}
const wasmManager = new WasmStoreManager();
function Viewer3D($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      showGrid = true,
      backgroundColor = "#f3f4f6",
      selectedLevelIds = [],
      onLevelClick
    } = $$props;
    let meshes = [];
    let camera = null;
    let geometries = [];
    onDestroy(() => {
      geometries.forEach((g) => g.dispose());
      WasmGeometryLoader.clearCache();
    });
    function handleMeshClick(levelId) {
      onLevelClick?.(levelId);
    }
    function isSelected(levelId) {
      return selectedLevelIds.includes(levelId);
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      $$renderer3.push(`<div class="relative w-full h-full"${attr_style(`background-color: ${stringify(backgroundColor)}`)}>`);
      {
        $$renderer3.push("<!--[-->");
        $$renderer3.push(`<div class="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10"><div class="text-white text-sm">Loading WASM module...</div></div>`);
      }
      $$renderer3.push(`<!--]--> `);
      {
        $$renderer3.push("<!--[!-->");
        Canvas($$renderer3, {
          children: ($$renderer4) => {
            $$renderer4.push(`<!---->`);
            T.PerspectiveCamera($$renderer4, {
              makeDefault: true,
              position: [20, 20, 20],
              fov: 50,
              get ref() {
                return camera;
              },
              set ref($$value) {
                camera = $$value;
                $$settled = false;
              }
            });
            $$renderer4.push(`<!----> <!---->`);
            T.Color($$renderer4, { attach: "background", args: [backgroundColor] });
            $$renderer4.push(`<!----> <!---->`);
            T.AmbientLight($$renderer4, { intensity: 0.6, color: "#ffffff" });
            $$renderer4.push(`<!----> <!---->`);
            T.DirectionalLight($$renderer4, {
              position: [20, 40, 20],
              intensity: 1,
              color: "#ffffff",
              castShadow: true
            });
            $$renderer4.push(`<!----> <!---->`);
            T.PointLight($$renderer4, { position: [-15, 25, -15], intensity: 0.4, color: "#ffffff" });
            $$renderer4.push(`<!----> `);
            if (showGrid) {
              $$renderer4.push("<!--[-->");
              Grid($$renderer4, {
                infiniteGrid: true,
                fadeDistance: 100,
                sectionColor: "#d1d5db",
                cellColor: "#e5e7eb"
              });
            } else {
              $$renderer4.push("<!--[!-->");
            }
            $$renderer4.push(`<!--]--> <!---->`);
            T.Mesh($$renderer4, {
              "rotation.x": -Math.PI / 2,
              "position.y": -0.01,
              receiveShadow: true,
              children: ($$renderer5) => {
                $$renderer5.push(`<!---->`);
                T.PlaneGeometry($$renderer5, { args: [500, 500] });
                $$renderer5.push(`<!----> <!---->`);
                T.MeshStandardMaterial($$renderer5, { color: "#e5e7eb", roughness: 0.9, metalness: 0 });
                $$renderer5.push(`<!---->`);
              },
              $$slots: { default: true }
            });
            $$renderer4.push(`<!----> `);
            OrbitControls($$renderer4, {});
            $$renderer4.push(`<!----> <!--[-->`);
            const each_array = ensure_array_like(meshes);
            for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
              let { levelId, geometry, color } = each_array[$$index];
              $$renderer4.push(`<!---->`);
              T.Mesh($$renderer4, {
                geometry,
                castShadow: true,
                receiveShadow: true,
                onclick: () => handleMeshClick(levelId),
                children: ($$renderer5) => {
                  $$renderer5.push(`<!---->`);
                  T.MeshStandardMaterial($$renderer5, {
                    color: isSelected(levelId) ? 16498468 : color,
                    roughness: 0.85,
                    metalness: 0.05,
                    side: 2
                  });
                  $$renderer5.push(`<!---->`);
                },
                $$slots: { default: true }
              });
              $$renderer4.push(`<!---->`);
            }
            $$renderer4.push(`<!--]-->`);
          },
          $$slots: { default: true }
        });
      }
      $$renderer3.push(`<!--]--></div>`);
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
  });
}
function buildGoalOrientedPrompt(prompt, successCriteria) {
  const criteriaList = successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `${prompt}

GOALS (complete ALL before stopping):
${criteriaList}

EXECUTION:
- Work continuously until ALL goals are achieved.
- Start by understanding the room program and circulation, then derive the shell/footprint dimensions from that plan.
- Only call shell tools (skill_create_house_shell or raw shell tools) **after** you have a tentative program and target interior_width/depth.
- Treat vague gross area targets (e.g., "about 1200 sqft") as a range, not a fixed rectangle; size the shell from summed room areas + circulation.
- When rooms do not depend on each other, emit multiple room-creation tool calls in a single step rather than one at a time.
- A project without rooms and circulation is NOT complete - keep building.
- Only pause for: blocking errors or design trade-offs needing user input.

WHEN FINISHED: Briefly summarize what was created.`;
}
const DEFAULT_SUCCESS_CRITERIA = [
  "All requested core spaces are created (at least one living area, kitchen, bedrooms, and bathrooms, as implied by the prompt).",
  "There is a circulation path (entries and/or hallways) connecting the main entry to all bedrooms and bathrooms.",
  "The building shell/footprint exists and fully encloses all rooms with reasonable clearances at exterior walls.",
  "Total interior area is reasonable for the described program and any user-provided target (e.g., approximate gross sqft), not wildly under- or oversized.",
  "No validation errors."
];
const IMAGE_QUALITY = 0.85;
const MAX_ITERATIONS = 2;
async function captureWithLabels(canvas, rooms) {
  const offscreen = document.createElement("canvas");
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const ctx = offscreen.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const room of rooms) {
    const screenX = room.center[0] / 50 * canvas.width + canvas.width / 2;
    const screenY = canvas.height / 2 - room.center[1] / 50 * canvas.height;
    const label = `${room.name}
${room.dimensions.width}'×${room.dimensions.depth}'`;
    const lines = label.split("\n");
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.beginPath();
    ctx.roundRect(screenX - 50, screenY - 20, 100, 40, 6);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    lines.forEach((line, i) => {
      ctx.fillText(line, screenX, screenY + (i - 0.5) * 16);
    });
  }
  return offscreen.toDataURL("image/jpeg", IMAGE_QUALITY);
}
const VISUAL_VALIDATION_PROMPT = `Review this floor plan rendering. Analyze the spatial layout and identify any issues:

1. ROOM OVERLAPS: Are any rooms overlapping each other?
2. BOUNDARY VIOLATIONS: Are any rooms extending outside the building footprint?
3. MISSING ROOMS: Based on a standard residential layout, are there obvious missing rooms?
4. DIMENSION ISSUES: Do room proportions look reasonable for their types?

If the layout is correct and has no issues, respond with exactly: "VALIDATED"

Otherwise, list the specific corrections needed in this format:
CORRECTIONS:
- [Issue 1]: [Specific fix needed]
- [Issue 2]: [Specific fix needed]`;
function parseVisualFeedback(responseText) {
  const text = responseText.trim();
  if (text.toUpperCase().includes("VALIDATED")) {
    return {
      validated: true,
      corrections: null,
      issues: []
    };
  }
  const issues = [];
  const correctionsMatch = text.match(/CORRECTIONS:([\s\S]*)/i);
  if (correctionsMatch) {
    const correctionLines = correctionsMatch[1].split("\n").filter((line) => line.trim().startsWith("-"));
    for (const line of correctionLines) {
      const cleaned = line.replace(/^-\s*/, "").trim();
      let type = "other";
      if (/overlap/i.test(cleaned)) type = "overlap";
      else if (/out|bounds|outside/i.test(cleaned)) type = "out_of_bounds";
      else if (/missing/i.test(cleaned)) type = "missing_room";
      else if (/dimension|size|proportion/i.test(cleaned)) type = "wrong_dimensions";
      issues.push({
        type,
        description: cleaned
      });
    }
  }
  return {
    validated: false,
    corrections: text,
    issues
  };
}
function getVisualValidationPrompt() {
  return VISUAL_VALIDATION_PROMPT;
}
function getMaxIterations() {
  return MAX_ITERATIONS;
}
const TOKENS_PER_IMAGE = 560;
const COST_PER_1K_TOKENS = 2e-3;
function estimateVisualFeedbackCost(iterationCount) {
  const tokens = TOKENS_PER_IMAGE * iterationCount;
  const costUSD = tokens / 1e3 * COST_PER_1K_TOKENS;
  return {
    tokens,
    costUSD: Math.round(costUSD * 1e4) / 1e4
    // Round to 4 decimal places
  };
}
const ADJACENCY_TOLERANCE = 0.5;
const DEFAULT_DOOR_WIDTH = 3;
const CLOSET_DOOR_WIDTH = 2.5;
const CASED_OPENING_WIDTH = 4;
const DEFAULT_DOOR_HEIGHT = 6.67;
const PUBLIC_ROOMS = ["living", "kitchen", "dining", "family", "great_room", "foyer", "mudroom"];
const PRIVATE_ROOMS = ["bedroom", "bathroom", "closet"];
const CIRCULATION_ROOMS = ["hallway", "foyer", "stair", "landing", "circulation"];
const SERVICE_ROOMS = ["garage", "laundry", "utility", "pantry"];
const ENTRY_ROOM_TYPES = ["foyer", "mudroom", "living", "garage"];
const AUTO_CONNECT_PAIRS = [
  ["bedroom", "hallway"],
  ["bedroom", "closet"],
  ["bedroom", "bathroom"],
  // ensuite
  ["bathroom", "hallway"],
  ["closet", "hallway"],
  ["hallway", "hallway"],
  // hallway segments
  ["hallway", "living"],
  ["hallway", "kitchen"],
  ["hallway", "dining"],
  ["hallway", "family"],
  ["hallway", "great_room"],
  ["hallway", "foyer"],
  ["hallway", "mudroom"],
  ["hallway", "laundry"],
  ["hallway", "utility"],
  ["hallway", "office"],
  ["hallway", "pantry"],
  ["foyer", "living"],
  ["foyer", "dining"],
  ["mudroom", "garage"],
  ["mudroom", "laundry"],
  ["garage", "utility"],
  ["kitchen", "pantry"],
  ["kitchen", "dining"],
  ["kitchen", "laundry"]
];
const OPEN_PLAN_PAIRS = [
  ["living", "kitchen"],
  ["living", "dining"],
  ["kitchen", "dining"],
  ["living", "family"],
  ["living", "great_room"],
  ["kitchen", "family"],
  ["dining", "family"]
];
const INVALID_CONNECTIONS = [
  ["bedroom", "bedroom", "Consider adding hallway between bedrooms"],
  ["bathroom", "kitchen", "Bathroom should not open directly to kitchen"],
  ["bathroom", "dining", "Bathroom should not open directly to dining room"],
  ["bedroom", "kitchen", "Bedroom should access kitchen via common area"],
  ["garage", "bedroom", "Garage should not connect directly to bedroom"],
  ["garage", "kitchen", "Garage should connect via mudroom (fire safety)"]
];
function roomToBounds(room) {
  return {
    id: room.id,
    name: room.name,
    x: room.center[0] - room.dimensions.width / 2,
    y: room.center[1] - room.dimensions.depth / 2,
    width: room.dimensions.width,
    depth: room.dimensions.depth,
    type: room.type
  };
}
function findSharedWall(room1, room2) {
  const r1 = {
    left: room1.x,
    right: room1.x + room1.width,
    bottom: room1.y,
    top: room1.y + room1.depth
  };
  const r2 = {
    left: room2.x,
    right: room2.x + room2.width,
    bottom: room2.y,
    top: room2.y + room2.depth
  };
  const verticalOverlap = Math.min(r1.top, r2.top) - Math.max(r1.bottom, r2.bottom);
  if (verticalOverlap > ADJACENCY_TOLERANCE) {
    if (Math.abs(r1.right - r2.left) < ADJACENCY_TOLERANCE) {
      return {
        start: [r1.right, Math.max(r1.bottom, r2.bottom)],
        end: [r1.right, Math.min(r1.top, r2.top)],
        direction: "east",
        length: verticalOverlap
      };
    }
    if (Math.abs(r2.right - r1.left) < ADJACENCY_TOLERANCE) {
      return {
        start: [r1.left, Math.max(r1.bottom, r2.bottom)],
        end: [r1.left, Math.min(r1.top, r2.top)],
        direction: "west",
        length: verticalOverlap
      };
    }
  }
  const horizontalOverlap = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
  if (horizontalOverlap > ADJACENCY_TOLERANCE) {
    if (Math.abs(r1.top - r2.bottom) < ADJACENCY_TOLERANCE) {
      return {
        start: [Math.max(r1.left, r2.left), r1.top],
        end: [Math.min(r1.right, r2.right), r1.top],
        direction: "north",
        length: horizontalOverlap
      };
    }
    if (Math.abs(r2.top - r1.bottom) < ADJACENCY_TOLERANCE) {
      return {
        start: [Math.max(r1.left, r2.left), r1.bottom],
        end: [Math.min(r1.right, r2.right), r1.bottom],
        direction: "south",
        length: horizontalOverlap
      };
    }
  }
  return null;
}
function calculateDoorPosition(wall, doorWidth = DEFAULT_DOOR_WIDTH) {
  if (wall.length < doorWidth) {
    return null;
  }
  return [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2
  ];
}
function getDoorWidth(type1, type2) {
  if (type1 === "closet" || type2 === "closet") {
    return CLOSET_DOOR_WIDTH;
  }
  if (isOpenPlanPair(type1, type2)) {
    return CASED_OPENING_WIDTH;
  }
  return DEFAULT_DOOR_WIDTH;
}
function isOpenPlanPair(type1, type2) {
  return OPEN_PLAN_PAIRS.some(
    ([a, b]) => type1 === a && type2 === b || type1 === b && type2 === a
  );
}
function shouldAutoConnect(type1, type2) {
  if (isOpenPlanPair(type1, type2)) return true;
  return AUTO_CONNECT_PAIRS.some(
    ([a, b]) => type1 === a && type2 === b || type1 === b && type2 === a
  );
}
function checkRoomTypeRules(type1, type2) {
  for (const [a, b, message] of INVALID_CONNECTIONS) {
    if (type1 === a && type2 === b || type1 === b && type2 === a) {
      return {
        type: "invalid_connection",
        message,
        affectedRooms: []
        // Will be filled in by caller
      };
    }
  }
  return null;
}
function findAdjacentRooms(newRoom, existingRooms) {
  const newBounds = roomToBounds(newRoom);
  const adjacent = [];
  for (const room of existingRooms) {
    if (room.id === newRoom.id) continue;
    const existingBounds = roomToBounds(room);
    const wall = findSharedWall(newBounds, existingBounds);
    if (wall) {
      adjacent.push({ room, wall });
    }
  }
  return adjacent;
}
function autoGenerateDoors(newRoom, existingRooms, existingDoors) {
  const doors = [];
  const warnings = [];
  const adjacentRooms = findAdjacentRooms(newRoom, existingRooms);
  for (const { room: adjacentRoom, wall } of adjacentRooms) {
    const existingDoor = existingDoors.find(
      (d) => d.room1 === newRoom.id && d.room2 === adjacentRoom.id || d.room1 === adjacentRoom.id && d.room2 === newRoom.id
    );
    if (existingDoor) continue;
    const ruleWarning = checkRoomTypeRules(newRoom.type, adjacentRoom.type);
    if (ruleWarning) {
      ruleWarning.affectedRooms = [newRoom.id, adjacentRoom.id];
      warnings.push(ruleWarning);
    }
    if (shouldAutoConnect(newRoom.type, adjacentRoom.type)) {
      const doorWidth = getDoorWidth(newRoom.type, adjacentRoom.type);
      const position = calculateDoorPosition(wall, doorWidth);
      if (position) {
        const isOpenPlan = isOpenPlanPair(newRoom.type, adjacentRoom.type);
        doors.push({
          id: crypto.randomUUID(),
          type: isOpenPlan ? "cased_opening" : "door",
          room1: newRoom.id,
          room2: adjacentRoom.id,
          position,
          width: doorWidth,
          height: DEFAULT_DOOR_HEIGHT,
          wallDirection: wall.direction,
          autoGenerated: true
        });
      }
    }
  }
  return { doors, warnings };
}
function validateConnectivity(rooms, doors) {
  const result = {
    isFullyConnected: true,
    reachableRooms: [],
    orphanedRooms: [],
    entryRoom: null,
    warnings: [],
    suggestions: []
  };
  if (rooms.length === 0) {
    return result;
  }
  const entryRoom = rooms.find((r) => ENTRY_ROOM_TYPES.includes(r.type)) || rooms[0];
  result.entryRoom = entryRoom;
  const graph = /* @__PURE__ */ new Map();
  rooms.forEach((r) => graph.set(r.id, /* @__PURE__ */ new Set()));
  for (const door of doors) {
    graph.get(door.room1)?.add(door.room2);
    graph.get(door.room2)?.add(door.room1);
  }
  const visited = /* @__PURE__ */ new Set([entryRoom.id]);
  const queue = [entryRoom.id];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of graph.get(current) || /* @__PURE__ */ new Set()) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  result.reachableRooms = Array.from(visited);
  const orphaned = rooms.filter((r) => !visited.has(r.id));
  result.orphanedRooms = orphaned;
  result.isFullyConnected = orphaned.length === 0;
  for (const orphan of orphaned) {
    result.warnings.push(`${orphan.name} has no door connection (orphaned)`);
    const orphanBounds = roomToBounds(orphan);
    for (const reachableId of visited) {
      const reachable = rooms.find((r) => r.id === reachableId);
      const wall = findSharedWall(orphanBounds, roomToBounds(reachable));
      if (wall && wall.length >= DEFAULT_DOOR_WIDTH) {
        result.suggestions.push(`Add door from ${orphan.name} to ${reachable.name}`);
        break;
      }
    }
  }
  return result;
}
function getRoomZone(type) {
  if (PUBLIC_ROOMS.includes(type)) return "public";
  if (PRIVATE_ROOMS.includes(type)) return "private";
  if (CIRCULATION_ROOMS.includes(type)) return "circulation";
  if (SERVICE_ROOMS.includes(type)) return "service";
  return "public";
}
function groupRoomsByZone(rooms) {
  return {
    public: rooms.filter((r) => getRoomZone(r.type) === "public"),
    private: rooms.filter((r) => getRoomZone(r.type) === "private"),
    circulation: rooms.filter((r) => getRoomZone(r.type) === "circulation"),
    service: rooms.filter((r) => getRoomZone(r.type) === "service")
  };
}
const MAX_HISTORY_TURNS = 10;
class GeminiCADManager {
  // Reactive state using Svelte 5 runes
  #messages = [];
  #loading = false;
  #error = null;
  #history = [];
  #pendingQuestion = null;
  #totalTokens = 0;
  #visualIterations = 0;
  // Canvas reference for visual feedback
  #canvasRef = null;
  // Getters for reactive access
  get messages() {
    return this.#messages;
  }
  get loading() {
    return this.#loading;
  }
  get error() {
    return this.#error;
  }
  get history() {
    return this.#history;
  }
  get pendingQuestion() {
    return this.#pendingQuestion;
  }
  get totalTokens() {
    return this.#totalTokens;
  }
  get visualIterations() {
    return this.#visualIterations;
  }
  /**
   * Set canvas reference for visual feedback
   */
  setCanvas(canvas) {
    this.#canvasRef = canvas;
  }
  /**
   * Add a message to the chat
   */
  addMessage(message) {
    this.#messages = [...this.#messages, message];
  }
  /**
   * Clear all messages
   */
  clearMessages() {
    this.#messages = [];
    this.#history = [];
    this.#totalTokens = 0;
    this.#visualIterations = 0;
  }
  /**
   * Prune history to prevent unbounded conversation growth.
   * Keeps only the last MAX_HISTORY_TURNS conversation turns (user + model pairs).
   * Each turn = 2 Content entries (user message + model response).
   */
  pruneHistory() {
    const maxEntries = MAX_HISTORY_TURNS * 2;
    if (this.#history.length > maxEntries) {
      this.#history = this.#history.slice(-maxEntries);
      console.log(`[GeminiCAD] Pruned history to ${MAX_HISTORY_TURNS} turns (${this.#history.length} entries)`);
    }
  }
  /**
   * Generate CAD from natural language prompt
   */
  async generate(prompt, successCriteria = DEFAULT_SUCCESS_CRITERIA) {
    this.#loading = true;
    this.#error = null;
    this.#visualIterations = 0;
    this.addMessage({
      role: "user",
      content: prompt,
      timestamp: /* @__PURE__ */ new Date()
    });
    try {
      const fullPrompt = buildGoalOrientedPrompt(prompt, successCriteria);
      let result = await this.executeGenerationLoop(fullPrompt);
      if (this.#canvasRef && result.success) {
        for (let i = 0; i < getMaxIterations(); i++) {
          const feedback = await this.performVisualValidation();
          this.#visualIterations++;
          if (feedback.validated) {
            console.log("[GeminiCAD] Visual validation passed");
            break;
          }
          if (feedback.corrections) {
            console.log("[GeminiCAD] Applying visual corrections:", feedback.corrections);
            result = await this.executeGenerationLoop(feedback.corrections);
          }
        }
      }
      const costEstimate = estimateVisualFeedbackCost(this.#visualIterations);
      return {
        success: result.success,
        text: result.text,
        toolsExecuted: result.toolsExecuted,
        visualIterations: this.#visualIterations,
        costEstimate
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Generation failed";
      this.#error = errorMsg;
      return {
        success: false,
        error: errorMsg,
        toolsExecuted: 0,
        visualIterations: this.#visualIterations
      };
    } finally {
      this.#loading = false;
    }
  }
  /**
   * Execute the main generation loop (prompt -> tools -> response)
   */
  async executeGenerationLoop(prompt) {
    let toolsExecuted = 0;
    let currentPrompt = prompt;
    while (true) {
      const response = await this.callServerAPI(currentPrompt);
      if (!response.success) {
        return { success: false, text: response.error, toolsExecuted };
      }
      if (response.history) {
        this.#history = response.history;
      }
      if (response.usage) {
        this.#totalTokens += response.usage.totalTokens;
      }
      if (response.functionCalls && response.functionCalls.length > 0) {
        const toolResults = await this.executeTools(response.functionCalls);
        toolsExecuted += toolResults.length;
        wasmManager.syncFromWasm();
        currentPrompt = this.formatToolResults(toolResults);
        continue;
      }
      if (response.text) {
        this.addMessage({
          role: "assistant",
          content: response.text,
          timestamp: /* @__PURE__ */ new Date(),
          thinking: response.thinking
        });
      }
      return { success: true, text: response.text, toolsExecuted };
    }
  }
  /**
   * Perform visual validation using Gemini vision
   */
  async performVisualValidation() {
    if (!this.#canvasRef) {
      return { validated: true, corrections: null, issues: [] };
    }
    try {
      const rooms = wasmManager.observableState.floorplan.rooms;
      const imageBase64 = await captureWithLabels(this.#canvasRef, rooms);
      const response = await fetch("/api/ai/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64, prompt: getVisualValidationPrompt() })
      });
      if (!response.ok) {
        console.warn("[GeminiCAD] Visual validation API failed");
        return { validated: true, corrections: null, issues: [] };
      }
      const data = await response.json();
      return parseVisualFeedback(data.text || "");
    } catch (e) {
      console.error("[GeminiCAD] Visual validation error:", e);
      return { validated: true, corrections: null, issues: [] };
    }
  }
  /**
   * Call the server API for Gemini chat
   */
  async callServerAPI(prompt) {
    this.pruneHistory();
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          history: this.#history,
          stateForLLM: this.formatStateForLLM()
        })
      });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "API call failed"
      };
    }
  }
  /**
   * Execute CAD tools via WASM
   */
  async executeTools(calls) {
    const results = [];
    const store = wasmManager.store;
    if (!store) {
      return calls.map((c) => ({
        name: c.name,
        result: { error: "WASM store not initialized" },
        success: false
      }));
    }
    for (const call of calls) {
      try {
        const result = await this.executeTool(store, call.name, call.args);
        results.push({ name: call.name, result, success: true });
        if (call.name === "add_level" && typeof result === "string") {
          wasmManager.addLevel(result);
        } else if (call.name === "remove_level") {
          const levelId = call.args.level_id;
          wasmManager.removeLevel(levelId);
        }
      } catch (e) {
        results.push({
          name: call.name,
          result: {
            error: e instanceof Error ? e.message : "Tool execution failed"
          },
          success: false
        });
      }
    }
    return results;
  }
  /**
   * Execute a single CAD tool - 5 collaborative tools
   */
  async executeTool(store, toolName, args) {
    const s = store;
    switch (toolName) {
      case "create_room": {
        const levelId = await this.ensureLevelExists(s, args.floor || 0);
        const x = args.x;
        const y = args.y;
        const width = args.width;
        const depth = args.depth;
        const points = [
          [x, y],
          [x + width, y],
          [x + width, y + depth],
          [x, y + depth]
        ];
        const roomId = s.create_room(levelId, args.room_type, args.name, points);
        const newRoom = {
          id: roomId,
          name: args.name,
          type: args.room_type,
          area: width * depth,
          center: [x + width / 2, y + depth / 2],
          dimensions: { width, depth }
        };
        const existingRooms = wasmManager.observableState.floorplan.rooms;
        const existingDoors = (wasmManager.observableState.floorplan.openings || []).filter((o) => o.type === "door" || o.type === "cased_opening");
        const { doors: autoDoors, warnings: doorWarnings } = autoGenerateDoors(newRoom, existingRooms, existingDoors);
        wasmManager.updateState((state) => ({
          ...state,
          floorplan: {
            ...state.floorplan,
            rooms: [...state.floorplan.rooms, newRoom],
            openings: [
              ...state.floorplan.openings || [],
              ...autoDoors.map((d) => ({
                id: d.id,
                type: d.type,
                room1: d.room1,
                room2: d.room2,
                width: d.width,
                height: d.height,
                position: d.position,
                wallDirection: d.wallDirection,
                autoGenerated: d.autoGenerated
              }))
            ]
          }
        }));
        const allRooms = [...existingRooms, newRoom];
        const allDoors = [...existingDoors, ...autoDoors];
        const connectivity = validateConnectivity(allRooms, allDoors);
        const warnings = [
          ...doorWarnings.map((w) => w.message),
          ...connectivity.warnings
        ];
        wasmManager.updateState((state) => ({ ...state, constraints: { ...state.constraints, warnings } }));
        this.deriveFootprintFromRooms();
        const connectedNames = autoDoors.map((d) => {
          const room = existingRooms.find((r) => r.id === d.room2);
          return room?.name || d.room2;
        });
        let message = `Created ${args.name} (${width}'×${depth}')`;
        if (autoDoors.length > 0) {
          message += `. Auto-connected to: ${connectedNames.join(", ")}`;
        }
        if (warnings.length > 0) {
          message += `

Warnings:
${warnings.map((w) => `! ${w}`).join("\n")}`;
        }
        if (connectivity.suggestions.length > 0) {
          message += `

Suggestions:
${connectivity.suggestions.map((s2) => `→ ${s2}`).join("\n")}`;
        }
        return {
          room_id: roomId,
          auto_doors: autoDoors.length,
          warnings,
          suggestions: connectivity.suggestions,
          message
        };
      }
      case "update_room": {
        const roomId = args.room_id;
        wasmManager.updateState((state) => ({
          ...state,
          floorplan: {
            ...state.floorplan,
            rooms: state.floorplan.rooms.map((room) => {
              if (room.id !== roomId) return room;
              const newWidth = args.width ?? room.dimensions.width;
              const newDepth = args.depth ?? room.dimensions.depth;
              const newX = args.x ?? room.center[0] - room.dimensions.width / 2;
              const newY = args.y ?? room.center[1] - room.dimensions.depth / 2;
              return {
                ...room,
                name: args.name ?? room.name,
                dimensions: { width: newWidth, depth: newDepth },
                center: [newX + newWidth / 2, newY + newDepth / 2],
                area: newWidth * newDepth
              };
            })
          }
        }));
        this.deriveFootprintFromRooms();
        return { success: true, message: `Updated room ${roomId}` };
      }
      case "delete_room": {
        const roomId = args.room_id;
        const roomToDelete = wasmManager.observableState.floorplan.rooms.find((r) => r.id === roomId);
        const roomName = roomToDelete?.name || roomId;
        wasmManager.updateState((state) => ({
          ...state,
          floorplan: {
            ...state.floorplan,
            rooms: state.floorplan.rooms.filter((r) => r.id !== roomId),
            openings: (state.floorplan.openings || []).filter((o) => o.room1 !== roomId && o.room2 !== roomId)
          }
        }));
        const remainingRooms = wasmManager.observableState.floorplan.rooms;
        const remainingDoors = (wasmManager.observableState.floorplan.openings || []).filter((o) => o.type === "door" || o.type === "cased_opening");
        const connectivity = validateConnectivity(remainingRooms, remainingDoors);
        wasmManager.updateState((state) => ({
          ...state,
          constraints: { ...state.constraints, warnings: connectivity.warnings }
        }));
        this.deriveFootprintFromRooms();
        let message = `Deleted ${roomName}`;
        if (connectivity.warnings.length > 0) {
          message += `

Warnings:
${connectivity.warnings.map((w) => `! ${w}`).join("\n")}`;
        }
        return { success: true, message };
      }
      case "add_opening": {
        const opening = {
          type: args.opening_type,
          room1: args.room1_id,
          room2: args.room2_id,
          width: args.width,
          height: args.height
        };
        wasmManager.updateState((state) => ({
          ...state,
          floorplan: {
            ...state.floorplan,
            openings: [...state.floorplan.openings || [], opening]
          }
        }));
        return {
          success: true,
          message: `Added ${opening.type} (${opening.width}'×${opening.height}')`
        };
      }
      case "ask_user": {
        return {
          type: "question",
          question: args.question,
          options: args.options,
          context: args.context
        };
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
  /**
   * Auto-create project/building/level if they don't exist
   */
  levelIds = /* @__PURE__ */ new Map();
  projectId = null;
  buildingId = null;
  async ensureLevelExists(s, floor) {
    if (this.levelIds.has(floor)) {
      return this.levelIds.get(floor);
    }
    if (!this.projectId) {
      this.projectId = s.create_project("New Project", "imperial", "US_IRC_2021");
    }
    if (!this.buildingId) {
      this.buildingId = s.add_building(this.projectId, "Main Building");
    }
    const elevation = floor * 9;
    const levelName = floor === 0 ? "Ground Floor" : `Floor ${floor + 1}`;
    const levelId = s.add_level(this.buildingId, levelName, elevation, 9);
    this.levelIds.set(floor, levelId);
    wasmManager.addLevel(levelId);
    return levelId;
  }
  /**
   * Derive footprint from room bounding box
   */
  deriveFootprintFromRooms() {
    const rooms = wasmManager.observableState.floorplan.rooms;
    if (rooms.length === 0) {
      wasmManager.setFootprint(0, 0);
      return;
    }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const room of rooms) {
      const halfW = room.dimensions.width / 2;
      const halfD = room.dimensions.depth / 2;
      minX = Math.min(minX, room.center[0] - halfW);
      maxX = Math.max(maxX, room.center[0] + halfW);
      minY = Math.min(minY, room.center[1] - halfD);
      maxY = Math.max(maxY, room.center[1] + halfD);
    }
    const width = maxX - minX;
    const depth = maxY - minY;
    wasmManager.setFootprint(width, depth);
  }
  /**
   * Format tool results for Gemini
   */
  formatToolResults(results) {
    const formatted = results.map((r) => {
      if (r.success) {
        return `${r.name}: ${JSON.stringify(r.result)}`;
      }
      return `${r.name}: ERROR - ${JSON.stringify(r.result)}`;
    }).join("\n");
    return `Tool execution results:
${formatted}

Current state:
${this.formatStateForLLM()}`;
  }
  /**
   * Format observable state for LLM context
   */
  formatStateForLLM() {
    const state = wasmManager.observableState;
    const { footprint, floorplan, constraints } = state;
    let output = `=== BUILDING FOOTPRINT ===
`;
    output += `Size: ${footprint.width.toFixed(0)}' × ${footprint.depth.toFixed(0)}'
`;
    output += `Coordinates: (0,0) at SW corner, X→East, Y→North
`;
    const usedArea = floorplan.rooms.reduce((sum, r) => sum + r.area, 0);
    const totalArea = footprint.width * footprint.depth;
    output += `Total area: ${Math.round(totalArea)} sq ft | Used: ${Math.round(usedArea)} sq ft

`;
    const zones = groupRoomsByZone(floorplan.rooms);
    output += `=== ROOMS BY ZONE ===
`;
    if (zones.public.length > 0) {
      output += `PUBLIC: ${zones.public.map((r) => r.name).join(", ")}
`;
    }
    if (zones.private.length > 0) {
      output += `PRIVATE: ${zones.private.map((r) => r.name).join(", ")}
`;
    }
    if (zones.circulation.length > 0) {
      output += `CIRCULATION: ${zones.circulation.map((r) => r.name).join(", ")}
`;
    }
    if (zones.service.length > 0) {
      output += `SERVICE: ${zones.service.map((r) => r.name).join(", ")}
`;
    }
    if (floorplan.rooms.length > 0) {
      output += `
=== ROOM DETAILS ===
`;
      for (const room of floorplan.rooms) {
        const x = (room.center[0] - room.dimensions.width / 2).toFixed(0);
        const y = (room.center[1] - room.dimensions.depth / 2).toFixed(0);
        output += `${room.name} [${room.id.slice(0, 8)}]: ${room.dimensions.width}'×${room.dimensions.depth}' at (${x},${y}) - ${Math.round(room.area)} sqft
`;
      }
    }
    const doors = (floorplan.openings || []).filter((o) => o.type === "door" || o.type === "cased_opening");
    if (doors.length > 0) {
      output += `
=== DOOR CONNECTIONS ===
`;
      for (const door of doors) {
        const room1 = floorplan.rooms.find((r) => r.id === door.room1);
        const room2 = floorplan.rooms.find((r) => r.id === door.room2);
        const doorType = door.type === "cased_opening" ? "opening" : "door";
        const position = door.position ? ` at (${door.position[0].toFixed(1)}, ${door.position[1].toFixed(1)})` : "";
        output += `${room1?.name || door.room1} <-> ${room2?.name || door.room2 || "exterior"} (${doorType} ${door.width}'${position})
`;
      }
    }
    if (constraints.warnings.length > 0) {
      output += `
=== CIRCULATION WARNINGS ===
`;
      for (const warning of constraints.warnings) {
        output += `! ${warning}
`;
      }
    }
    const doorsSet = /* @__PURE__ */ new Set();
    for (const door of doors) {
      doorsSet.add(door.room1);
      if (door.room2) doorsSet.add(door.room2);
    }
    const orphanedRooms = floorplan.rooms.filter((r) => !doorsSet.has(r.id));
    if (orphanedRooms.length > 0 && floorplan.rooms.length > 1) {
      output += `
=== ORPHANED ROOMS (need doors) ===
`;
      for (const room of orphanedRooms) {
        output += `- ${room.name} (${room.type})
`;
      }
    }
    return output;
  }
  // ============================================================================
  // Geometry Helpers
  // ============================================================================
  calculatePolygonArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i][0] * points[j][1];
      area -= points[j][0] * points[i][1];
    }
    return Math.abs(area) / 2;
  }
  calculateCentroid(points) {
    let cx = 0, cy = 0;
    for (const [x, y] of points) {
      cx += x;
      cy += y;
    }
    return [cx / points.length, cy / points.length];
  }
  calculateBoundingBox(points) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...ys) - Math.min(...ys)
    };
  }
}
const geminiCAD = new GeminiCADManager();
function ChatPanel($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let inputValue = "";
    let messages = geminiCAD.messages;
    let loading = geminiCAD.loading;
    let error = geminiCAD.error;
    let totalTokens = geminiCAD.totalTokens;
    function formatTimestamp(date) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    $$renderer2.push(`<div class="flex flex-col h-full bg-white border-l border-gray-200"><div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50"><div class="flex items-center gap-2"><h2 class="text-sm font-semibold text-gray-900">Gemini CAD Assistant</h2> `);
    if (totalTokens > 0) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<span class="text-xs text-gray-500">(${escape_html(totalTokens.toLocaleString())} tokens)</span>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--></div> <button class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">Clear</button></div> <div class="flex-1 overflow-y-auto p-4 space-y-4">`);
    if (messages.length === 0) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="text-center text-gray-500 py-8"><p class="text-sm">Start designing by describing what you want to build.</p> <p class="text-xs mt-2 text-gray-400">Example: "Create a 1200 sqft house with 2 bedrooms and 1 bathroom"</p></div>`);
    } else {
      $$renderer2.push("<!--[!-->");
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(messages);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let message = each_array[$$index];
        $$renderer2.push(`<div${attr_class(`flex ${stringify(message.role === "user" ? "justify-end" : "justify-start")}`)}><div${attr_class(`max-w-[85%] rounded-lg px-4 py-2 ${stringify(message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900")}`)}>`);
        if (message.thinking) {
          $$renderer2.push("<!--[-->");
          $$renderer2.push(`<details class="mb-2"><summary class="text-xs opacity-70 cursor-pointer">Thinking...</summary> <p class="text-xs opacity-60 mt-1 whitespace-pre-wrap">${escape_html(message.thinking)}</p></details>`);
        } else {
          $$renderer2.push("<!--[!-->");
        }
        $$renderer2.push(`<!--]--> <p class="text-sm whitespace-pre-wrap">${escape_html(message.content)}</p> <p class="text-xs opacity-60 mt-1">${escape_html(formatTimestamp(message.timestamp))}</p></div></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--> `);
    if (loading) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="flex justify-start"><div class="bg-gray-100 rounded-lg px-4 py-2"><div class="flex items-center gap-2"><div class="animate-pulse flex gap-1"><div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms"></div> <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div> <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms"></div></div> <span class="text-sm text-gray-500">Generating...</span></div></div></div>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (error) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-2"><p class="text-sm text-red-600">${escape_html(error)}</p></div>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--></div> <div class="border-t border-gray-200 p-4"><div class="flex gap-2"><textarea placeholder="Describe what you want to build..." rows="2"${attr("disabled", loading, true)} class="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed">`);
    const $$body = escape_html(inputValue);
    if ($$body) {
      $$renderer2.push(`${$$body}`);
    }
    $$renderer2.push(`</textarea> <button${attr("disabled", loading || !inputValue.trim(), true)} class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">${escape_html(loading ? "Generating..." : "Send")}</button></div></div></div>`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    wasmManager.levelIds;
    let loading = wasmManager.loading;
    let footprint = wasmManager.observableState.footprint;
    let roomCount = wasmManager.observableState.floorplan.rooms.length;
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>Gemini CAD</title>`);
      });
    });
    $$renderer2.push(`<div class="h-full flex flex-col bg-gray-100"><header class="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm"><div class="flex items-center gap-4"><h1 class="text-lg font-bold text-gray-900">Gemini CAD</h1> <div class="flex rounded-lg bg-gray-100 p-0.5"><button${attr_class(`px-3 py-1 text-sm font-medium rounded-md transition-colors ${stringify(
      "bg-white shadow text-gray-900"
    )}`)}>3D</button> <button${attr_class(`px-3 py-1 text-sm font-medium rounded-md transition-colors ${stringify("text-gray-600 hover:text-gray-900")}`)}>2D</button> <button${attr_class(`px-3 py-1 text-sm font-medium rounded-md transition-colors ${stringify("text-gray-600 hover:text-gray-900")}`)}>Split</button></div> `);
    {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="flex rounded-lg bg-gray-100 p-0.5"><button${attr_class(`px-3 py-1 text-sm font-medium rounded-md transition-colors ${stringify("text-gray-600 hover:text-gray-900")}`)}>Solid</button> <button${attr_class(`px-3 py-1 text-sm font-medium rounded-md transition-colors ${stringify("text-gray-600 hover:text-gray-900")}`)}>Shell</button> <button${attr_class(`px-3 py-1 text-sm font-medium rounded-md transition-colors ${stringify(
        "bg-white shadow text-gray-900"
      )}`)}>Combined</button></div>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="flex items-center gap-4 text-sm text-gray-600">`);
    if (footprint.width > 0) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<span>Footprint: ${escape_html(footprint.width)}' × ${escape_html(footprint.depth)}'</span>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (roomCount > 0) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<span>Rooms: ${escape_html(roomCount)}</span>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (loading) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<span class="text-blue-600">Loading WASM...</span>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--></div></header> <div class="flex-1 flex overflow-hidden"><div class="flex-1 flex">`);
    {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="flex-1">`);
      Viewer3D($$renderer2, {});
      $$renderer2.push(`<!----></div>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="w-96 flex-shrink-0">`);
    ChatPanel($$renderer2);
    $$renderer2.push(`<!----></div></div></div>`);
  });
}
export {
  _page as default
};
