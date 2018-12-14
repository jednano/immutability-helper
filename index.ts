import * as invariant from 'invariant';

const hasOwnProperty = Object.prototype.hasOwnProperty;
const splice = Array.prototype.splice;

const toString = Object.prototype.toString;
function type<T>(obj: T) {
  return (toString.call(obj) as string).slice(8, -1);
}

const assign = Object.assign || /* istanbul ignore next */ (<
  T extends {[key: string]: any},
  S extends {[key: string]: any},
>(
  target: T,
  source: S,
) => {
  getAllKeys(source).forEach(key => {
    if (hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  });
  return target as T & S;
});

const getAllKeys = typeof Object.getOwnPropertySymbols === 'function'
  ? <T>(obj: T) => Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as any)
  /* istanbul ignore next */
  : <T>(obj: T) => Object.keys(obj);

function copy<T, U, K, V, X>(
  object: T extends U[]
    ? U[]
    : T extends Map<K, V>
      ? Map<K, V>
      : T extends Set<X>
        ? Set<X>
        : T extends object
          ? T
          : any,
) {
  return Array.isArray(object)
    ? assign(object.constructor(object.length), object)
    : (type(object) === 'Map')
      ? new Map(object as Map<K, V>)
      : (type(object) === 'Set')
        ? new Set(object as Set<X>)
        : (object && typeof object === 'object')
          ? assign(Object.create(Object.getPrototypeOf(object)), object) as T
          /* istanbul ignore next */
          : object as T;
}

export class Context {
  private commands: typeof defaultCommands & {[key: string]: any} =
    assign({}, defaultCommands);
  constructor() {
    this.update = this.update.bind(this);
    // Deprecated: update.extend, update.isEquals and update.newContext
    (this.update as any).extend = this.extend = this.extend.bind(this);
    (this.update as any).isEquals = (x: any, y: any) => x === y;
    (this.update as any).newContext = () => new Context().update;
  }
  get isEquals() {
    return (this.update as any).isEquals;
  }
  set isEquals(value: (x: any, y: any) => boolean) {
    (this.update as any).isEquals = value;
  }
  public extend<T>(directive: string, fn: (param: any, old: T) => T) {
    this.commands[directive] = fn;
  }
  public update<T, C extends CustomCommands<object> = never>(
    object: T,
    $spec: Spec<T, C>,
  ): T {
    const spec = (typeof $spec === 'function') ? { $apply: $spec } : $spec;

    if (!(Array.isArray(object) && Array.isArray(spec))) {
      invariant(
        !Array.isArray(spec),
        'update(): You provided an invalid spec to update(). The spec may ' +
        'not contain an array except as the value of $set, $push, $unshift, ' +
        '$splice or any custom command allowing an array value.',
      );
    }

    invariant(
      typeof spec === 'object' && spec !== null,
      'update(): You provided an invalid spec to update(). The spec and ' +
      'every included key path must be plain objects containing one of the ' +
      'following commands: %s.',
      Object.keys(this.commands).join(', '),
    );

    let nextObject = object;
    getAllKeys(spec).forEach(key => {
      if (hasOwnProperty.call(this.commands, key)) {
        const objectWasNextObject = object === nextObject;
        nextObject = this.commands[key](spec[key], nextObject, spec, object);
        if (objectWasNextObject && this.isEquals(nextObject, object)) {
          nextObject = object;
        }
      } else {
        const nextValueForKey =
          type(object) === 'Map'
            ? this.update((object as any as Map<any, any>).get(key), spec[key])
            : this.update(object[key], spec[key]);
        const nextObjectValue =
          type(nextObject) === 'Map'
              ? (nextObject as any as Map<any, any>).get(key)
              : nextObject[key];
        if (!this.isEquals(nextValueForKey, nextObjectValue)
          || typeof nextValueForKey === 'undefined'
          && !hasOwnProperty.call(object, key)
        ) {
          if (nextObject === object) {
            nextObject = copy(object);
          }
          if (type(nextObject) === 'Map') {
            (nextObject as any as Map<any, any>).set(key, nextValueForKey);
          } else {
            nextObject[key] = nextValueForKey;
          }
        }
      }
    });
    return nextObject;
  }
}

function $push<T, C extends CustomCommands<object> = never>(
  value: T[],
  nextObject: T[],
  spec: T[] extends (Array<infer U> | ReadonlyArray<infer U>)
    ? ArraySpec<U, C>
    : never,
) {
  invariantPushAndUnshift(nextObject, spec, '$push');
  return value.length ? nextObject.concat(value) : nextObject;
}

function $unshift<T, C extends CustomCommands<object> = never>(
  value: T[],
  nextObject: T[],
  spec: T[] extends (Array<infer U> | ReadonlyArray<infer U>)
    ? ArraySpec<U, C>
    : never,
) {
  invariantPushAndUnshift(nextObject, spec, '$unshift');
  return value.length ? value.concat(nextObject) : nextObject;
}

function $splice<T>(
  value: T[],
  nextObject: T[],
  spec: T[] extends (Array<infer U> | ReadonlyArray<infer U>)
    ? ISpliceSpec<U>
    : never,
  originalObject: T[],
) {
  invariantSplices(nextObject, spec);
  value.forEach((args: any) => {
    invariantSplice(args);
    if (nextObject === originalObject && args.length) {
      nextObject = copy(originalObject);
    }
    splice.apply(nextObject, args);
  });
  return nextObject;
}

function $set<T, C extends CustomCommands<object> = never>(
  value: T,
  _nextObject: T,
  spec: Spec<T, C>,
) {
  invariantSet(spec);
  return value;
}

function $toggle<T>(keys: Array<keyof T>, nextObject: T) {
  invariantSpecArray(keys, '$toggle');
  const nextObjectCopy = keys.length ? copy(nextObject) : nextObject;

  keys.forEach(target => {
    nextObjectCopy[target] = !nextObject[target];
  });

  return nextObjectCopy;
}

function $unset<T extends {[key: string]: any}>(
  keys: Array<keyof T>,
  nextObject: T,
  _spec: IUnsetSpec<T>,
  originalObject: T,
) {
  invariantSpecArray(keys, '$unset');
  keys.forEach((key: any) => {
    if (Object.hasOwnProperty.call(nextObject, key)) {
      if (nextObject === originalObject) {
        nextObject = copy(originalObject);
      }
      delete nextObject[key];
    }
  });
  return nextObject;
}

function $add<T, C extends CustomCommands<object> = never>(
  values: T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>)
    ? Array<[K, V]>
    : T extends (Set<infer X> | ReadonlySet<infer X>)
      ? X[]
      : never,
  nextObject: T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>)
    ? Map<K, V>
    : T extends (Set<infer X> | ReadonlySet<infer X>)
      ? Set<X>
      : never,
  _spec: T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>)
    ? MapAddSpec<K, V, C>
    : T extends (Set<infer X> | ReadonlySet<infer X>)
      ? SetSpec<X>
      : never,
  originalObject: any,
) {
  invariantMapOrSet(nextObject, '$add');
  invariantSpecArray(values, '$add');
  if (type(nextObject) === 'Map') {
    (values as Array<[any, any]>).forEach(([key, value]) => {
      if (nextObject === originalObject && (nextObject as Map<any, any>).get(key) !== value) {
        nextObject = copy(originalObject);
      }
      (nextObject as Map<any, any>).set(key, value);
    });
  } else {
    (values as any[]).forEach(value => {
      if (nextObject === originalObject && !(nextObject as Set<any>).has(value)) {
        nextObject = copy(originalObject);
      }
      (nextObject as Set<any>).add(value);
    });
  }
  return nextObject;
}

function $remove<T, C extends CustomCommands<object> = never>(
  values: T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>)
    ? Array<[K, V]>
    : T extends (Set<infer X> | ReadonlySet<infer X>)
      ? X[]
      : never,
  nextObject: T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>)
    ? Map<K, V>
    : T extends (Set<infer X> | ReadonlySet<infer X>)
      ? Set<X>
      : never,
  _spec: T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>)
    ? MapRemoveSpec<K, V, C>
    : T extends (Set<infer X> | ReadonlySet<infer X>)
      ? SetSpec<X>
      : never,
  originalObject: any,
) {
  invariantMapOrSet(nextObject, '$remove');
  invariantSpecArray(values, '$remove');
  values.forEach((key: any) => {
    if (nextObject === originalObject && nextObject.has(key)) {
      nextObject = copy(originalObject);
    }
    nextObject.delete(key);
  });
  return nextObject;
}

const defaultCommands = {
  $push,
  $unshift,
  $splice,
  $set,
  $toggle,
  $unset,
  $add,
  $remove,
  $merge(value: any, nextObject: any, _spec: any, originalObject: any) {
    invariantMerge(nextObject, value);
    getAllKeys(value).forEach((key: any) => {
      if (value[key] !== nextObject[key]) {
        if (nextObject === originalObject) {
          nextObject = copy(originalObject);
        }
        nextObject[key] = value[key];
      }
    });
    return nextObject;
  },
  $apply(value: any, original: any) {
    invariantApply(value);
    return value(original);
  },
};

const defaultContext = new Context();
export const isEquals = (defaultContext.update as any).isEquals;
export const extend = defaultContext.extend;
export default defaultContext.update;

// @ts-ignore
exports.default.default = module.exports = assign(exports.default, exports);

// invariants

function invariantPushAndUnshift<T, C extends CustomCommands<object> = never>(
  value: T[],
  spec: T[] extends (Array<infer U> | ReadonlyArray<infer U>)
    ? ArraySpec<U, C> & {[key: string]: any}
    : never,
  command: '$push' | '$unshift',
) {
  invariant(
    Array.isArray(value),
    'update(): expected target of %s to be an array; got %s.',
    command,
    value,
  );
  invariantSpecArray(spec[command], command);
}

function invariantSpecArray<T, C extends CustomCommands<object> = never>(
  spec: T[] extends (Array<infer U> | ReadonlyArray<infer U>)
    ? ArraySpec<U, C> & {[key: string]: any}
    : never,
  command: '$add' | '$push' | '$remove' | '$toggle' | '$unset' | '$unshift',
) {
  invariant(
    Array.isArray(spec),
    'update(): expected spec of %s to be an array; got %s. ' +
    'Did you forget to wrap your parameter in an array?',
    command,
    spec,
  );
}

function invariantSplices<T>(
  value: T[],
  spec: T[] extends (Array<infer U> | ReadonlyArray<infer U>)
    ? ISpliceSpec<U>
    : never,
) {
  invariant(
    Array.isArray(value),
    'Expected $splice target to be an array; got %s',
    value,
  );
  invariantSplice(spec.$splice);
}

function invariantSplice<T>(value: T[]) {
  invariant(
    Array.isArray(value),
    'update(): expected spec of $splice to be an array of arrays; got %s. ' +
    'Did you forget to wrap your parameters in an array?',
    value,
  );
}

function invariantApply(fn: any) {
  invariant(
    typeof fn === 'function',
    'update(): expected spec of $apply to be a function; got %s.',
    fn,
  );
}

function invariantSet<T, C extends CustomCommands<object> = never>(
  spec: Spec<T, C>,
) {
  invariant(
    Object.keys(spec).length === 1,
    'Cannot have more than one key in an object with $set',
  );
}

function invariantMerge(target: any, specValue: any) {
  invariant(
    specValue && typeof specValue === 'object',
    'update(): $merge expects a spec of type \'object\'; got %s',
    specValue,
  );
  invariant(
    target && typeof target === 'object',
    'update(): $merge expects a target of type \'object\'; got %s',
    target,
  );
}

function invariantMapOrSet(target: any, command: any) {
  const typeOfTarget = type(target);
  invariant(
    typeOfTarget === 'Map' || typeOfTarget === 'Set',
    'update(): %s expects a target of type Set or Map; got %s',
    command,
    typeOfTarget,
  );
}

// Usage with custom commands is as follows:
//
//   interface MyCommands {
//     $foo: string;
//   }
//
//    update<Foo, CustomCommands<MyCommands>>(..., { $foo: "bar" });
//
// It is suggested that if you use custom commands frequently, you wrap and re-export a
// properly-typed version of `update`:
//
//   function myUpdate<T>(object: T, spec: Spec<T, CustomCommands<MyCommands>>) {
//     return update(object, spec);
//   }
//
// See https://github.com/kolodny/immutability-helper/pull/108 for explanation of why this
// type exists.
export type CustomCommands<T> = T & { __noInferenceCustomCommandsBrand: any };

export type Spec<T, C extends CustomCommands<object> = never> =
  | (
      T extends (Array<infer U> | ReadonlyArray<infer U>) ? ArraySpec<U, C> :
      T extends (Map<infer K, infer V> | ReadonlyMap<infer K, infer V>) ? MapSpec<K, V, C> :
      T extends (Set<infer X> | ReadonlySet<infer X>) ? SetSpec<X> :
      T extends object ? ObjectSpec<T, C> :
      never
    )
  | { $set: T }
  | { $apply: (v: T) => T }
  | ((v: T) => T)
  | (C extends CustomCommands<infer O> ? O : never);

interface ISpliceSpec<T> {
  $splice: Array<[number, number?] | [number, number, ...T[]]>;
}

type ArraySpec<T, C extends CustomCommands<object>> =
  | { $push: T[] }
  | { $unshift: T[] }
  | ISpliceSpec<T>
  | { [index: string]: Spec<T, C> }; // Note that this does not type check properly if index: number.

type MapAddSpec<K, V, C extends CustomCommands<object>> =
  | { $add: Array<[K, V]> }
  | { [key: string]: Spec<V, C> };

type MapRemoveSpec<K, V, C extends CustomCommands<object>> =
  | { $remove: K[] }
  | { [key: string]: Spec<V, C> };

type MapSpec<K, V, C extends CustomCommands<object>> =
  | MapAddSpec<K, V, C>
  | MapRemoveSpec<K, V, C>;

interface ISetAddSpec<T> { $add: T[]; }
interface ISetRemoveSpec<T> { $remove: T[]; }
type SetSpec<T> = ISetAddSpec<T> | ISetRemoveSpec<T>;

interface IUnsetSpec<T> {
  $unset: Array<keyof T>;
}

type ObjectSpec<T, C extends CustomCommands<object>> =
  | { $toggle: Array<keyof T> }
  | IUnsetSpec<T>
  | { $merge: Partial<T> }
  | { [K in keyof T]?: Spec<T[K], C> };
