import { AsyncContext, Fn, STACK, Unsubscribe, storeVar, top } from './internal.js'

export interface Atom<State = any> {
  (): State
  __reatom: string
}

export interface AtomMut<State = any> extends Atom<State> {
  (newState?: State): State
}

export interface Action<Params extends any[] = any[], Payload = any>
  extends Atom<Array<{ params: Params; payload: Payload }>> {
  (...a: Params): Payload
}

export interface Effect<T = any> extends Atom<Unsubscribe> {
  (): Unsubscribe
}

export interface Frame<State = any> {
  error: null | NonNullable<unknown>
  state: State
  atom: Atom<State>
  cause: null | Frame
  context: null | Map<AsyncContext.Variable, unknown>
  pubs: Array<Frame>
  subs: Array<Atom>
}

/** have not nullable context */
export interface VariableFrame<T = any> extends Frame<T> {
  context: Map<AsyncContext.Variable, unknown>
}

export interface Queue extends Array<Frame> {}

export interface RootState extends Queue {}

export interface RootFrame extends Frame<RootState> {}

export interface RootAtom extends Atom<RootState> {
  (): RootFrame
}

type Falsy = false | 0 | '' | null | undefined
// Can't be an arrow function due to
//    https://github.com/microsoft/TypeScript/issues/34523
/** Throws `Reatom error: ${message}` */
export function throwReatomError(
  condition: any,
  message: string,
): asserts condition is Falsy {
  if (condition) throw new Error(`Reatom error: ${message}`)
}

/** Throws `Reatom error: ${message}` */
export function throwReatomNullable<T>(
  condition: T,
  message: string,
): asserts condition is NonNullable<T> {
  throwReatomError(!condition, message)
}

// @ts-expect-error TODO declare globals?
throwReatomNullable(globalThis.__reatom_root, 'root duplication')

export let root =
  // @ts-expect-error TODO declare globals?
  (globalThis.__reatom_root = () => {
    let frame = top()
    while (frame.cause !== null) frame = frame.cause
    return frame
  }) as RootAtom
root.__reatom = 'atom'

let copy = (frame: Frame, cause: Frame, store: StoreWeakMap) => {
  frame = {
    error: frame.error,
    state: frame.state,
    atom: frame.atom,
    cause,
    context: frame.context,
    pubs: frame.pubs,
    subs: frame.subs,
  }
  store.set(frame.atom, frame)
  return frame
}

let enqueue = (frame: Frame, store: StoreWeakMap, rootFrame: RootFrame) => {
  for (let i = 0; i < frame.subs.length; i++) {
    let sub = frame.subs[i]!
    let subFrame = store.get(sub)!

    if (subFrame.subs.length !== 0) {
      subFrame = copy(subFrame, frame, store)
      if (sub.__reatom === 'effect') {
        if (rootFrame.state.push(subFrame) === 1) {
          Promise.resolve().then(wrap(notify, rootFrame))
        }

        subFrame.subs.length = 0
      } else {
        enqueue(subFrame, store, rootFrame)
      }
    }
  }
  // frame.subs = []
  frame.subs.length = 0
}

let unlink = (anAtom: Atom, oldPubs: Frame['pubs'], store: StoreWeakMap) => {
  for (let i = 0; i < oldPubs.length; i++) {
    // TODO do not unlink pub if it was updated?
    let pub = oldPubs[i]!

    let idx = pub.subs.indexOf(anAtom)

    // looks like the pub was enqueued
    if (idx === -1) continue

    if (idx === 0) {
      pub.subs.length = 0
      unlink(pub.atom, pub.pubs, store)
    } else {
      // This algorithm might look sub-optimal and have extra complexity,
      // but in the real data, it is in the best case quite often,
      // like `pub.subs[pub.subs.indexOf(anAtom)] = pub.subs.pop()`

      // search the suitable element from the end to reduce the shift (`splice`) complexity
      let shiftIdx = pub.subs.findLastIndex((el) => el.__reatom !== 'effect')
      // if all other elements are an effects (which order shouldn't be changed)
      // we will shift the whole list starting from that element.
      if (shiftIdx === -1) shiftIdx = idx
      if (shiftIdx !== idx) pub.subs[idx] = pub.subs[shiftIdx]!
      pub.subs.splice(shiftIdx, 1)
    }
  }
}

// TODO dirty flag makes node disconnected, is it ok?
export let isConnected = (anAtom: Atom) =>
  !!storeVar.get().get(anAtom)?.subs.length

// TODO configurable
export let notify = () => {
  for (let { atom } of root().state.splice(0)) {
    if (atom.__reatom === 'effect') atom()
  }
}

let i = 0
export let named = (name: string | TemplateStringsArray) => `${name}#${++i}`

export let atom: {
  <T>(computed: (() => T) | ((state?: T) => T), options?: string): Atom<T>
  <T>(init: T extends Fn ? never : T, options?: string): AtomMut<T>
} = <T>(init: {} | ((state?: T) => T), name = named`atom`): Atom<T> => {
  function atom(): T {
    let topFrame = top()
    let rootFrame = root()
    let cause = arguments.length ? topFrame : rootFrame
    let store = storeVar.get(topFrame)
    let frame = store.get(atom)
    // FIXME ASAP doesn't work for nested reading
    let linking =
      topFrame.atom !== root &&
      // topFrame.atom.__reatom !== 'effect' &&
      !arguments.length

    if (!frame) {
      frame = {
        error: null,
        state: (typeof init === 'function' ? undefined : init) as T,
        atom,
        cause,
        context: null,
        pubs: [],
        subs: [],
      }
      store.set(atom, frame)
    } else if (
      arguments.length ||
      (typeof init === 'function' && frame.pubs.length === 0)
    ) {
      frame = copy(frame, cause, store)
    }

    try {
      STACK.push(frame)
      if (frame.error !== null) throw frame.error

      if (!frame.subs.length || arguments.length) {
        let { error, state, pubs } = frame
        if (typeof init === 'function') {
          frame.pubs = []
          if (
            pubs.length === 0 ||
            pubs.some(({ atom, state }) => !Object.is(state, atom()))
          ) {
            frame.pubs = []
            // FIXME
            frame.state = init(state)
            frame.error = null

            if (pubs.length !== frame.pubs.length) {
              unlink(atom, pubs, store)
            } else {
              // TODO move to a child, schedule before notifications queue
              for (let i = 0; i < pubs.length; i++) {
                if (pubs[i]!.atom !== frame.pubs[i]!.atom) {
                  unlink(atom, pubs, store)
                  break
                }
              }
            }
          } else {
            frame.pubs = pubs
          }
        }

        if (arguments.length !== 0) {
          frame.state = arguments[0]
        }

        if (
          frame.atom.__reatom !== 'effect' &&
          frame.subs.length > 0 &&
          (!Object.is(state, frame.state) || error != null)
        ) {
          enqueue(frame, store, rootFrame)
        }
      }
    } catch (error) {
      throw (frame.error = error ?? new Error('Unknown error'))
    } finally {
      if (linking) {
        topFrame.pubs.push(frame)
        frame.subs.push(topFrame.atom)
      }
      STACK.pop()
    }

    return frame.state
  }

  Reflect.defineProperty(atom, 'name', { value: name })
  if (typeof init === 'function') {
    Reflect.defineProperty(init, 'name', { value: `${name}.function` })
  }

  atom.__reatom = 'atom'

  return atom
}

export let action = <Params extends any[] = any[], Payload = any>(
  cb: (...params: Params) => Payload,
  name = named`action`,
): Action<Params, Payload> => {
  let params: undefined | Params
  let action = atom(() => {
    try {
      return cb(...params!)
    } finally {
      params = undefined
      top().pubs.length = 0
    }
  }, name)
  // @ts-expect-error
  return (...a: Params) => action((params = a))
}

export let effect = (fn: Fn, name = named`effect`): Effect => {
  let effect = atom(() => {
    fn()
    let frame = top()
    frame.subs.push(effect)

    return () => {
      let store = storeVar.get(frame)
      let freshFrame = store.get(effect)!
      freshFrame.subs = []
      unlink(effect, freshFrame.pubs, store)
    }
  }, name)
  effect.__reatom = 'effect'
  return effect
}

export interface StoreWeakMap extends WeakMap<Atom, Frame> {
  get<T>(target: Atom<T>): undefined | Frame<T>
  set<T>(target: Atom<T>, frame: Frame<T>): this
}

export let read = <T>(cb: () => T): T =>
  new AsyncContext.Snapshot(root()).run(cb)

export let { wrap } = AsyncContext.Snapshot
