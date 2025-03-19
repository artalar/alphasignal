import type { Fn, Unsubscribe } from './utils.ts'
import { assert, noop } from './utils.js'
import type { Assigner, Extension, Mix } from './mix.ts'

import { COLOR } from '../picocolors.js'

export * from './mix.js'

/** Base atom interface for other userspace implementations */
export interface AtomLike<State = any> {
  (): State

  /** Extension system */
  mix: Mix<this>

  subscribe: (cb?: (state: State) => any) => Unsubscribe

  /** @internal The list of applied mixins (middlewares). */
  __reatom: Array<Fn>
}

/** Base changeable state container */
export interface Atom<State = any> extends AtomLike<State> {
  (newState?: State): State
}

/** Derived state container */
export interface Computed<State = any> extends AtomLike<State> {
  (): State
}

/** Autoclearable array of processed events */
export interface TemporalArray<T = any> extends Array<T> {}

/** Logic container with atom features */
export interface Action<Params extends any[] = any[], Payload = any>
  extends AtomLike /* <TemporalArray<{ params: Params; payload: Payload }>> */ {
  // TODO
  // (): never
  (...a: Params): Payload
}

/** Callstack snapshot */
export interface Frame<State = any> {
  error: null | NonNullable<unknown>
  state: State
  atom: AtomLike<State>
  /** Immutable list of dependencies.
   * The first element is actualization flag and an imperative write cause. */
  pubs: [actualization: null | Frame, ...dependencies: Array<Frame>]
  subs: Array<Fn | AtomLike>
  run<I extends any[], O>(fn: (...args: I) => O, ...args: I): O
}

export type AtomState<T extends AtomLike> = T extends AtomLike<infer State>
  ? State
  : never

/** Computed's derivations queue */
export interface Queue extends Array<Fn> {}

/** Atom's state mappings for context */
export interface Store extends WeakMap<Atom, Frame> {
  get<T>(target: Atom<T>): undefined | Frame<T>
  set<T>(target: Atom<T>, frame: Frame<T>): this
}

export interface RootState {
  store: Store
  queue: Queue
}

export interface RootFrame extends Frame<RootState> {}

export interface RootAtom extends AtomLike<RootState> {
  (): RootFrame
  start<T>(cb: () => T): T
}

let DEBUG = false

export class ReatomError extends Error {}

function run<I extends any[], O>(
  this: Frame,
  fn: (...args: I) => O,
  ...args: I
): O {
  // TODO root check?
  STACK.push(this)
  try {
    return fn(...args)
  } finally {
    STACK.pop()
  }
}

let copy = (rootFrame: RootFrame, frame: Frame) => {
  if (DEBUG) {
    console.log(COLOR.dimGreen('copy'), frame.atom.name)
  }

  let pubs = frame.pubs.slice() as typeof frame.pubs

  // let pubs = new Array(frame.pubs.length) as typeof frame.pubs
  // for (let i = 1; i < frame.pubs.length; i++) {
  //   pubs[i] = frame.pubs[i]!
  // }

  pubs[0] = null

  frame = {
    error: frame.error,
    state: frame.state,
    atom: frame.atom,
    pubs,
    subs: frame.subs,
    run,
  }
  rootFrame.state.store.set(frame.atom, frame)
  return frame
}

let enqueue = (rootFrame: RootFrame, frame: Frame) => {
  if (DEBUG) {
    console.log(COLOR.dimGreen('enqueue'), frame.atom.name)
  }

  for (let i = 0; i < frame.subs.length; i++) {
    let sub = frame.subs[i]!
    if ('__reatom' in sub) {
      let subFrame = rootFrame.state.store.get(sub)!
      if (subFrame.pubs[0] !== null) {
        enqueue(rootFrame, copy(rootFrame, subFrame))
      }
    } else {
      if (rootFrame.state.queue.push(sub) === 1) {
        Promise.resolve().then(() => notify(rootFrame))
      }
    }
  }
}

export let schedule = async <T>(fn: (...a: any[]) => T): Promise<T> => {
  if (DEBUG) {
    console.log(COLOR.magenta('schedule in'), top().atom.name)
  }

  let { queue } = root().state

  do await null
  while (queue.length)

  return fn()
}

let link = (frame: Frame) => {
  if (DEBUG) {
    console.log(COLOR.green('link'), frame.atom.name)
  }

  for (let i = 1; i < frame.pubs.length; i++) {
    if (frame.pubs[i]!.subs.push(frame.atom) === 1) {
      link(frame.pubs[i]!)
    }
  }
}

// The algorithm might look sub-optimal and have extra "complexity",
// but in the real data, it is in the best case quite often (pub.subs.pop()).
// For example, as we run `link` before `unlink` during deps invalidation,
// for deps duplication we want to find just added dep.
let unlink = (sub: Atom | Fn, oldPubs: Frame['pubs']) => {
  if (DEBUG) {
    console.log(COLOR.red('unlink'), sub.name)
  }

  // Start from the end to try to revet the link sequence with just "pop" complexity.
  // Do not unlink the zero pub, as it is just an actualization flag.
  for (let i = oldPubs.length - 1; i > 0; i--) {
    let pub = oldPubs[i]!

    let idx = pub.subs.lastIndexOf(sub)

    // looks like the pub was enqueued
    if (idx === -1) continue

    if (pub.subs.length === 1) {
      pub.subs.length = 0
      unlink(pub.atom, pub.pubs)
    }
    // This should be the most common case
    else if (idx === pub.subs.length - 1) {
      pub.subs.pop()
    } else {
      // Search the suitable element (not effect) from the end to reduce the shift (`splice`) complexity.
      let shiftIdx = pub.subs.findLastIndex((el) => '__reatom' in el)

      if (shiftIdx === -1) {
        console.warn('IS IT OK???')
        shiftIdx = idx
      }
      pub.subs[idx] = pub.subs[shiftIdx]!
      pub.subs.splice(shiftIdx, 1)
    }
  }
}

let relink = (frame: Frame, oldPubs: Frame['pubs']) => {
  if (oldPubs.length !== frame.pubs.length) {
    link(frame)
    unlink(frame.atom, oldPubs)
  } else {
    for (let i = 1; i < oldPubs.length; i++) {
      if (oldPubs[i]!.atom !== frame.pubs[i]!.atom) {
        link(frame)
        unlink(frame.atom, oldPubs)
        break
      }
    }
  }
}

export let isConnected = (anAtom: Atom): boolean =>
  !!root().state.store.get(anAtom)?.subs.length

let i = 0
export let named = (name: string | TemplateStringsArray) => `${name}#${++i}`

let mix = (target: AtomLike, ext: Extension<AtomLike>): AtomLike => {
  let result = ext(target)
  if (typeof result === 'function') {
    target.__reatom.push(result)
  } else {
    for (let key in result) {
      assert(
        !(key in target),
        `Key ${key} already exist in atom ${target.name}`,
      )
      let value = result[key]
      // @ts-expect-error
      target[key] =
        typeof value === 'function' && !('__reatom' in value)
          ? action(value as Fn, `${target.name}.${key}`)
          : value
    }
  }
  return target
}

function subscribe(this: AtomLike, userCb = noop) {
  if (DEBUG) {
    console.log('subscribe', this.name)
  }

  let rootFrame = root()

  let lastState = {}
  let cb = () => {
    try {
      if (!Object.is(lastState, (lastState = this()))) {
        userCb(lastState)
      }
    } catch (error) {
      // do not allow to subscribe for error state
      if (!frame) throw error
    }
  }
  cb()

  var frame = rootFrame.state.store.get(this)

  if (frame!.subs.push(cb) === 1) {
    relink(frame!, [null])
  }

  return () => {
    if (DEBUG) {
      console.log('unsubscribe', this.name)
    }

    if (!frame) return

    // TODO optimize
    frame.subs.splice(frame.subs.indexOf(cb), 1)

    if (frame.subs.length === 0) {
      unlink(this, rootFrame.state.store.get(this as Atom)!.pubs)
    }

    frame = undefined
  }
}

let castAtom = <T extends AtomLike>(
  target: Fn,
  name: string,
  // type: 'atom' | 'action' = 'atom',
): T => {
  Reflect.defineProperty(target, 'name', { value: name })
  target.toString = () => `[Atom ${name}]`
  ;(target as AtomLike).__reatom = []
  // @ts-ignore
  ;(target as AtomLike).mix = (...extensions) =>
    extensions.reduce(mix, target as AtomLike)
  ;(target as AtomLike).subscribe = subscribe.bind(target as AtomLike)

  return target as T
}

export let atom: {
  <T>(computed: (() => T) | ((state?: T) => T), name?: string): Computed<T>
  <T>(init: T extends Fn ? never : T, name?: string): Atom<T>
} = <T>(setup: {} | ((state?: T) => T), name = named('atom')): Atom<T> => {
  let atom = castAtom<Atom<T>>(function (): T {
    let rootFrame = root()
    let topFrame = top()
    let push = arguments.length !== 0
    let frame = rootFrame.state.store.get(atom)! // TODO improve types handling in the computed
    let init = frame === undefined

    if (frame === undefined) {
      frame = {
        error: null,
        state: (typeof setup === 'function' ? undefined : setup) as T,
        atom,
        pubs: [null],
        subs: [],
        run,
      }
      rootFrame.state.store.set(atom, frame)
    }

    let { error, state } = frame
    let newState = state

    try {
      STACK.push(frame)

      function computed() {
        let push = arguments.length > 0
        let { pubs } = frame

        if (DEBUG) {
          console.log((push ? COLOR.cyan : COLOR.yellow)('enter'), atom.name)
        }

        if (push) {
          frame = copy(rootFrame, frame)
          frame.pubs[0] = topFrame
          frame.state = arguments[0]
          frame.error = null
        }

        let copied = push || pubs[0] === null

        if (
          typeof setup === 'function' &&
          (pubs[0] === null || !frame.subs.length)
        ) {
          let shouldUpdate = init || push
          if (!shouldUpdate) {
            pubs = frame.pubs
            frame.pubs = [null]
            try {
              for (let i = 1; i < pubs.length; i++) {
                let { error, state, atom } = pubs[i]!

                let pubFrame = rootFrame.state.store.get(atom)!
                let isFresh =
                  pubFrame.subs.length &&
                  pubFrame.pubs[0] !== null &&
                  !pubFrame.error

                if (isFresh) {
                  frame.pubs.push(pubFrame)
                }

                if (
                  !Object.is(state, isFresh ? pubFrame.state : atom()) ||
                  error
                ) {
                  shouldUpdate = true
                  break
                }
              }
            } finally {
              frame.pubs = pubs
            }
          }

          if (shouldUpdate) {
            // TODO there are extra invalidations in diamond case
            if (!copied) {
              STACK[STACK.length - 1] = frame = copy(rootFrame, frame)
            }

            frame.pubs = [null]
            frame.state = setup(frame.state)
            frame.error = null

            if (frame.subs.length) {
              // TODO may be a bug with resubscribing
              relink(frame, pubs)
            }
          }
        }

        return frame.state
      }
      Reflect.defineProperty(computed, 'name', { value: `${name}.computed` })

      let fn = computed
      for (let middleware of atom.__reatom) {
        fn = middleware.bind(null, fn)
      }
      // TODO why not `frame.state = fn.apply(null, arguments)`
      // @ts-expect-error
      newState = fn.apply(null, arguments)
    } catch (error) {
      if (DEBUG) {
        console.log(COLOR.red('error'), atom.name)
      }
      frame.error = error ?? new ReatomError('Unknown error')
    } finally {
      frame.pubs[0] ??= push ? topFrame : rootFrame

      // if the puller is an action it will cleanup itself by itself
      if (!push && topFrame !== rootFrame) {
        if (DEBUG && topFrame.atom === frame.atom) {
          console.log(COLOR.bgRed('topFrame.atom === frame.atom'))
        }
        topFrame.pubs.push(frame)
      }

      if (
        frame.subs.length !== 0 &&
        (!Object.is(state, newState) || error !== frame.error)
      ) {
        enqueue(rootFrame, frame)
      }

      STACK.pop()
    }

    if (frame.error) {
      throw frame.error
    }

    return newState
  }, name)

  if (typeof setup === 'function') {
    Reflect.defineProperty(setup, 'name', { value: `${name}.function` })
  }

  return atom
}

// @ts-expect-error
export let isAction: {
  <T extends Action>(target: T): target is T
  (target: any): target is Action
} = (target: any) =>
  '__reatom' in target && target.__reatom[0]?.name === 'actionComputed'

// TODO support generics
export let action = <Params extends any[] = any[], Payload = any>(
  cb: (...params: Params) => Payload,
  name = named('action'),
): Action<Params, Payload> =>
  atom(null, name).mix(
    () =>
      // @ts-ignore
      function actionComputed(_computed, ...params: Params): Payload {
        try {
          return cb(...params)
        } finally {
          top().pubs.length = 1
        }
      },
  )

// /** https://github.com/tc39/proposal-async-context?tab=readme-ov-file#asynccontextvariable */
// /** Variable of async context - process specific state, coupled with callstack frame */
// export interface Framevar<T = any> extends AtomLike<T> {
//   (frame?: Frame): T

//   run<I extends any[], O>(value: T, fn: (...args: I) => O, ...args: I): O
// }

export let root = castAtom<RootAtom>(() => {
  let rootFrame = STACK[0] as RootFrame
  if (rootFrame?.atom !== root) {
    throw new ReatomError('broken async stack')
  }
  return rootFrame
}, 'root')
root.start = (cb) =>
  ((
    {
      error: null,
      state: { store: new WeakMap() as Store, queue: [] },
      atom: root,
      pubs: [null],
      subs: [],
      run,
    } satisfies RootFrame
  ).run(cb))
// @ts-expect-error TODO declare globals?
assert(!globalThis.__reatom_root, 'root duplication', ReatomError)
// @ts-expect-error TODO declare globals?
globalThis.__reatom_root = root

// export let findFrame = <T>(
//   target: AtomLike<T>,
//   frame = top(),
// ): Frame<T> | null => {
//   while (frame !== null && frame.atom !== target) frame = frame.pubs[0]!
//   return frame
// }

// TODO configurable
export let notify = (rootFrame = root()) =>
  rootFrame.run(() => {
    if (DEBUG) {
      console.log('notify')
    }
    let {
      state: { queue },
    } = rootFrame
    for (let cb of queue.splice(0)) {
      // FIXME scoped counter
      cb()
    }
  })

export let peek = <T>(cb: () => T): T => root().run(cb)

export let STACK: Array<Frame> = []

STACK.push(root.start(() => root()))

export let clearStack = () => {
  STACK.length = 0
}

export let top = (): Frame => {
  if (STACK.length === 0) {
    throw new ReatomError('missing async stack')
  }
  return STACK[STACK.length - 1]!
}

export let wrap = <T extends Promise<any> | Fn>(
  target: T,
  frame = top(),
): T => {
  let rootFrame = root()

  if (typeof target === 'function') {
    return ((...args: any) => {
      assert(
        STACK.length === 0 || STACK[0] === rootFrame,
        'root collision',
        ReatomError,
      )

      STACK.push(rootFrame, frame)
      try {
        return target(...args)
      } finally {
        STACK.length -= 2
      }
    }) as T
  }

  assert(target instanceof Promise, 'target should be promise', ReatomError)

  return new Promise(async (resolve, reject) => {
    try {
      let value = await target
      var seal = () => resolve(value)
    } catch (error) {
      seal = () => reject(error)
    }
    Promise.resolve().then(() => {
      assert(
        STACK.length === 0 || STACK[0] === rootFrame,
        'root collision',
        ReatomError,
      )
      STACK.push(rootFrame, frame)
    })
    seal()
    Promise.resolve().then(() => (STACK.length -= 2))
  }) as T
}

let SETTLED = new WeakMap<
  Promise<any>,
  { kind: 'pending' | 'fulfilled' | 'rejected'; value: any }
>()
export let settled = <Result, Fallback = undefined>(
  promise: Promise<Result>,
  fallback?: Fallback,
): Result | Fallback => {
  assert(promise instanceof Promise, 'promise expected', ReatomError)

  let settled = SETTLED.get(promise)
  if (!settled) {
    SETTLED.set(promise, (settled = { kind: 'pending', value: undefined }))
    promise
      .then((value) => {
        SETTLED.set(promise, { kind: 'fulfilled', value })
      })
      .catch((error) => {
        SETTLED.set(promise, { kind: 'rejected', value: error })
      })
  }

  if (settled.kind === 'fulfilled') {
    return settled.value
  }

  if (settled.kind === 'rejected') {
    throw settled.value
  }

  // if (arguments.length === 2) {
  //   return fallback as T
  // } else {
  //   throw promise
  // }
  return fallback as Fallback
}

export type WithSuspend<T extends AtomLike> = T & {
  suspended: Computed<Awaited<AtomState<T>>>
}
export let withSuspend =
  <T extends AtomLike>(): Assigner<
    T,
    { suspended: Computed<Awaited<AtomState<T>>> }
  > =>
  (target) => {
    if ('suspended' in target) return {} as any

    let suspended = atom(() => {
      let promise = target()

      if (promise instanceof Promise === false) return promise

      let result = settled(promise, promise)
      if (result === promise) {
        let resolver = wrap(() => {
          if (DEBUG) {
            console.log(COLOR.magenta('resolved'), suspended.name)
          }
          // @ts-expect-error
          suspended({})
        })
        promise.then(resolver).catch(resolver)
        throw promise
      }
      return result
    }, `${target.name}.suspended`).mix(() => (next, ...a) => {
      if (a.length) {
        let frame = top()
        let { pubs } = frame
        frame.pubs = [null]
        try {
          // @ts-expect-error
          return next(frame.state)
        } finally {
          frame.pubs = pubs
        }
      }
      return next()
    })

    return { suspended }
  }

export let suspense = <T>(
  target: AtomLike<T>,
  // preserve = false,
): Awaited<T> => target.mix(withSuspend()).suspended()
