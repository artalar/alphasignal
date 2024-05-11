import { AsyncContext, Frame, StoreWeakMap } from './internal.js'

export let storeVar = new AsyncContext.Variable<StoreWeakMap>({
  name: 'store',
  defaultValue: undefined as unknown as StoreWeakMap, // `storeVar` should be always initiated with `AsyncContext.Snapshot.createRoot`
})

export let STACK: Array<Frame> = []

export let top = () => {
  if (STACK.length === 0) {
    throw new Error('Reatom error: missing async stack')
  }
  return STACK[STACK.length - 1]!
}

// DEFAULT
STACK.push(AsyncContext.Snapshot.createRoot().frame)
// TODO rename
export let clearDefaults = () => {
  STACK.length = 0
}
