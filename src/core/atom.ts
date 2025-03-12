import { COLOR } from '../picocolors.ts'
import type { Fn, Rec, Shallow, Unsubscribe } from './utils.ts'
import { assert } from './utils.ts'

declare const UNDEFINED: unique symbol
type UNDEFINED = typeof UNDEFINED

export interface Assigner<Target extends AtomLike, Result extends Rec> {
  <T extends Target>(target: T): Result
}
export type AssignerBind<T> = T extends AtomLike
  ? T
  : T extends (...params: infer Params) => infer Payload
  ? Action<Params, Payload>
  : T

export interface Middleware<
  Target extends AtomLike,
  Params extends any[] | UNDEFINED = UNDEFINED,
  Result extends unknown | UNDEFINED = UNDEFINED,
> {
  <T extends Target>(target: T): (
    next: (...params: Parameters<T>) => ReturnType<T>,
    ...params: Params extends UNDEFINED ? Parameters<T> : Params
  ) => Result extends UNDEFINED ? ReturnType<T> : Result
}

type Operator<
  Target extends AtomLike = AtomLike,
  T extends
    | Assigner<Target, Rec>
    | Middleware<Target, any[], unknown> = () => {},
> = T extends Assigner<Target, infer Result>
  ? Target & { [K in keyof Result]: AssignerBind<Result[K]> }
  : T extends (
      target: Target,
    ) => (next: any, ...params: infer Params) => infer Result
  ? [Params, Result] extends [Parameters<Target>, ReturnType<Target>]
    ? Target
    : AtomLike<Result> & { (...params: Params): Result } & {
        [K in Exclude<keyof Target, keyof AtomLike>]: Target[K]
      }
  : never

export interface Mix<Target extends AtomLike> {
  /* prettier-ignore */ <T1 extends Assigner<Target, Rec> | Middleware<Target, any[], any>>(operator1: T1): Operator<Target, T1>
  // /* prettier-ignore */ <T1>(operator1: (target: This) => T1): This & T1
}

/** Base atom interface for other userspace implementations */
export interface AtomLike<State = any> {
  (): State

  /** Extension system */
  mix: Mix<this>

  subscribe: (cb?: () => any) => Unsubscribe

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
  extends AtomLike<TemporalArray<{ params: Params; payload: Payload }>> {
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
  subs: Array<AtomLike>
  run<I extends any[], O>(fn: (...args: I) => O, ...args: I): O
}

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
    if (frame.atom === sub) {
      if (rootFrame.state.queue.push(sub) === 1) {
        Promise.resolve().then(() => notify(rootFrame))
      }
    } else {
      let subFrame = rootFrame.state.store.get(sub)!
      if (subFrame.pubs[0] !== null) {
        enqueue(rootFrame, copy(rootFrame, subFrame))
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
let unlink = (sub: Atom, oldPubs: Frame['pubs']) => {
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

let castAtom = <T extends AtomLike>(
  target: Fn,
  name: string,
  type: 'atom' | 'action' = 'atom',
): T => {
  Reflect.defineProperty(target, 'name', { value: name })
  ;(target as AtomLike).__reatom = []
  ;(target as AtomLike).subscribe = () => {
    if (DEBUG) {
      console.log('subscribe', target.name)
    }

    let rootFrame = root()

    target()

    let frame = rootFrame.state.store.get(target as Atom)

    if (frame!.subs.push(target as Atom) === 1) {
      relink(frame!, [null])
    }

    return () => {
      if (DEBUG) {
        console.log('unsubscribe', target.name)
      }

      if (!frame) return

      frame.subs.splice(frame.subs.indexOf(target as Atom), 1)

      if (frame.subs.length === 0) {
        unlink(target as Atom, rootFrame.state.store.get(target as Atom)!.pubs)
      }

      frame = undefined
    }
  }

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
    let frame = rootFrame.state.store.get(atom)
    let init = frame === undefined

    if (DEBUG) {
      console.log(push ? COLOR.cyan('enter') : COLOR.yellow('enter'), atom.name)
    }

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

    let { error, state, pubs } = frame

    if (push) {
      frame = copy(rootFrame, frame)
      frame.pubs[0] = topFrame
      frame.state = arguments[0]
      frame.error = null
    }

    let copied = push || pubs[0] === null

    try {
      STACK.push(frame)

      if (
        typeof setup === 'function' &&
        (frame.pubs[0] === null || !frame.subs.length)
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
            relink(frame, pubs)
          }
        }
      }
    } catch (error) {
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
        // TODO wat?
        pubs[0] !== null &&
        (!Object.is(state, frame.state) || error !== frame.error)
      ) {
        enqueue(rootFrame, frame)
      }

      STACK.pop()
    }

    if (frame.error) {
      throw frame.error
    }

    return frame.state
  }, name)

  if (typeof setup === 'function') {
    Reflect.defineProperty(setup, 'name', { value: `${name}.function` })
  }

  return atom
}

// TODO support generics
export let action = <Params extends any[] = any[], Payload = any>(
  cb: (...params: Params) => Payload,
  name = named('action'),
): Action<Params, Payload> => {
  // let params: Params
  // let action = atom(
  //   (state: Array<{ params: Params; payload: Payload }> = []) => {
  //     try {
  //       return [...state, { params, payload: cb(...params) }]
  //     } finally {
  //       // @ts-expect-error
  //       params = undefined
  //       top().pubs.length = 0
  //     }
  //   },
  //   name,
  // )
  // // action.__reatom.push((next, ...a) => {
  // //   params = a
  // //   let state = next()
  // //   return state[state.length - 1].payload
  // // })

  let action = atom((state: any[] = []): any => {
    try {
      var payload = cb(...(state as any))
      return payload
    } finally {
      top().pubs.length = 1
    }
  }, name)
  // @ts-expect-error
  return (...a: Params) => action((params = a))
}

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

export function clearStack() {
  STACK.length = 0
}

export let top = (): Frame => {
  if (STACK.length === 0) {
    throw new ReatomError('missing async stack')
  }
  return STACK[STACK.length - 1]!
}

export function wrap<T extends Promise<any> | Fn>(target: T, frame = top()): T {
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

/* Bind */
const test0 =
//    ^?
  atom(0).mix((target) => ({
    inc: (to: number = 1) => target(target() + to),
  }))

test0.inc
//    ^?

const test0_2 = test0.inc()
//    ^?

/* Extension test */
const withAsyncData =
  <T>(initState: T): Assigner<AtomLike<Promise<T>>, { data: Atom<T> }> =>
  (target) => {
    const data = atom((state = initState) => {
      target().then(data)
      return state
    }, `${target.name}.data`) as AtomLike as Atom<T>
    return { data }
  }
const test2 = atom(async () => 42).mix(withAsyncData(0))
//    ^?
const test2_1 = test2()
//    ^?
const test2_2 = test2.data()
//    ^?

/* Middleware test */
const withToString =
  <T>(): Middleware<Atom<string>, [value: T]> =>
  () =>
  (next: Fn, value) =>
    next(String(value))

const test1 = atom('').mix(withToString<number>())
//    ^?
const test1_1 = test1()
const test1_2 = test1(1)
// @ts-expect-error
const test1_3 = test1(1n)
// @ts-expect-error
const test1_4 = test1('1')
