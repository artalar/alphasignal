import { expect, vi, test as viTest } from 'vitest'

import {
  action,
  atom,
  clearStack,
  Frame,
  isConnected,
  notify,
  root,
  top,
  wrap,
} from './atom.ts'
import { sleep } from './utils.ts'
import { mockFn } from './testing.ts'

clearStack()

// Create a properly typed wrapper around vitest's test function
const test = Object.assign(
  (name: string, fn: () => void | Promise<void>, options?: any) =>
    viTest(name, () => root.start(fn), options),
  viTest,
) as typeof viTest

let getStackTrace = (acc = '', frame = top()): string => {
  if (acc.length > 500) throw new Error('RECURSION')
  if (!acc) acc = ` <-- ${frame.atom.name}`
  const cause = frame.pubs.find((pub: Frame | null) => pub && pub.atom !== root)
  return cause ? getStackTrace(`${acc} <-- ${cause.atom.name}`, cause) : acc
}

test('linking', () => {
  const name = 'linking'

  const a1 = atom(0, `${name}.a1`)
  const a2 = atom(() => a1(), `${name}.a2`)
  const fn = mockFn()

  const testEffect = atom(() => fn(a2()), `${name}.testEffect`)

  const { store } = root().state

  expect(store.has(testEffect)).toBeFalsy()

  const un = testEffect.subscribe()
  expect(store.has(testEffect)).toBeTruthy()
  expect(fn.calls.length).toBe(1)
  expect(fn.lastInput()).toBe(0)
  const a1Frame = store.get(a1)!
  const a2Frame = store.get(a2)!
  const testEffectFrame = store.get(testEffect)!
  expect(a1Frame.pubs).toEqual([root()])
  expect(a1Frame.subs).toEqual([a2])
  expect(a2Frame.pubs).toEqual([root(), a1Frame])
  expect(a2Frame.subs).toEqual([testEffect])
  expect(testEffectFrame.pubs).toEqual([root(), a2Frame])

  un()

  expect(a1Frame).toBe(store.get(a1)!)
  expect(a2Frame).toBe(store.get(a2)!)
  expect(testEffectFrame).toBe(store.get(testEffect)!)

  expect(a1Frame.subs.length).toBe(0)
  expect(a2Frame.subs.length).toBe(0)
  expect(testEffectFrame.subs.length).toBe(0)
})

test('async frame stack', async () => {
  const name = 'asyncLoop'

  const a0 = atom(0, `${name}.a0`)
  const a1 = atom(() => {
    return a0() + 1
  }, `${name}.a1`)
  const a2 = atom(() => a1() + 1, `${name}.a2`)

  const logs: Array<string> = []

  await wrap(
    new Promise<void>((resolve, reject) => {
      atom(async () => {
        try {
          const v = a2()

          await wrap(sleep())

          if (v < 5) a0(v)
          else resolve()
        } catch (error) {
          reject(error)
        }
      }, `${name}.loop`).subscribe()

      atom(() => {
        try {
          logs.push(a0() + getStackTrace().replaceAll('asyncLoop.', ''))
        } catch (error) {
          reject(error)
        }
      }, `${name}.log`).subscribe()
    }),
  )

  expect(logs).toEqual([
    '0 <-- log <-- a0',
    '2 <-- log <-- a0 <-- loop <-- a2 <-- a1 <-- a0',
    '4 <-- log <-- a0 <-- loop <-- a2 <-- a1 <-- a0 <-- loop <-- a2 <-- a1 <-- a0',
  ])

  expect(root().pubs).toEqual([null])
  expect(root().subs.length).toBe(0)
})

test('nested deps', () => {
  const name = 'nested'
  const a1 = atom(0, `${name}.a1`)
  const a2 = atom(() => {
    // console.log('a2')
    return a1() + a1() - a1()
  }, `${name}.a2`)
  const a3 = atom(() => {
    // console.log('a3')
    return a1()
  }, `${name}.a3`)
  const a4 = atom(() => {
    // console.log('a4')
    return a2() + a3()
  }, `${name}.a4`)
  const a5 = atom(() => {
    // console.log('a5')
    return a2() + a3()
  }, `${name}.a5`)
  const a6 = atom(() => {
    // console.log('a6')
    return a4() + a5()
  }, `${name}.a6`)
  const fn = mockFn()
  const testEffect = atom(() => fn(a6()), `${name}.testEffect`)
  const un = testEffect.subscribe()

  for (const a of [a1, a2, a3, a4, a5, a6]) {
    expect(isConnected(a), `"${a.name}" should not be stale`).toBe(true)
  }

  expect(fn.calls.length).toBe(1)
  expect(root().state.store.get(a1)!.subs).toEqual([a2, a2, a2, a3])
  expect(root().state.store.get(a2)!.subs).toEqual([a4, a5])
  expect(root().state.store.get(a3)!.subs).toEqual([a4, a5])

  a1(1)
  notify()
  expect(fn.calls.length).toBe(2)
  // expect(touchedAtoms.length, new Set(touchedAtoms).size)

  un()
  for (const a of [a1, a2, a3, a4, a5, a6]) {
    expect(isConnected(a), `"${a.name}" should not be stale`).toBe(false)
  }
})

test('disconnect tail deps', () => {
  const name = 'disconnectTail'
  const aAtom = atom(0, `${name}.aAtom`)
  const track = mockFn(() => aAtom())
  const bAtom = atom(track, `${name}.bAtom`)
  const isActiveAtom = atom(true, `${name}.isActiveAtom`)
  const bAtomControlled = atom(
    (state?: any) => (isActiveAtom() ? bAtom() : state),
    `${name}.bAtomControlled`,
  )

  bAtomControlled.subscribe()
  expect(track.calls.length).toBe(1)
  expect(isConnected(bAtom)).toBe(true)

  isActiveAtom(false)
  notify()
  aAtom(aAtom() + 1)
  notify()
  expect(track.calls.length).toBe(1)
  expect(isConnected(bAtom)).toBe(false)
})

test('deps shift', () => {
  const name = 'depsShift'
  const dep0 = atom(0, `${name}.dep0`)
  const dep1 = atom(0, `${name}.dep1`)
  const dep2 = atom(0, `${name}.dep2`)
  const deps = [dep0, dep1, dep2]

  const a = atom(() => deps.forEach((dep) => dep()), `${name}.a`)

  a.subscribe()

  dep0(dep0() + 1)
  notify()
  expect(isConnected(dep0)).toBeTruthy()

  deps.shift()
  dep0(dep0() + 1)
  expect(isConnected(dep0)).toBeTruthy()
  notify()
  expect(isConnected(dep0)).toBeFalsy()
})

test('subscribe to cached atom', () => {
  const name = 'cachedAtom'
  const a1 = atom(0, `${name}.a1`)
  const a2 = atom(() => a1(), `${name}.a2`)

  // First get the value without subscribing
  a2()
  // Then subscribe
  a2.subscribe()

  // Check that a1 has exactly one subscriber
  const a1Frame = root().state.store.get(a1)
  expect(a1Frame?.subs.length).toBe(1)
})

test('update propagation for atom with listener', () => {
  const a1 = atom(0)
  const a2 = atom(() => a1())
  const a3 = atom(() => a2())

  const cb2 = vi.fn()
  const cb3 = vi.fn()

  a2.subscribe(cb2)
  const un3 = a3.subscribe(cb3)

  expect(cb2.mock.calls.length).toBe(1)
  expect(cb3.mock.calls.length).toBe(1)

  a1(1)
  notify()

  expect(cb2.mock.calls.length).toBe(2)
  expect(cb2.mock.calls[1]?.[0]).toBe(1)
  expect(cb3.mock.calls.length).toBe(2)
  expect(cb3.mock.calls[1]?.[0]).toBe(1)

  un3()
  expect(root().state.store.get(a2)!.subs.length).toBe(1)
  expect(root().state.store.get(a3)!.subs.length).toBe(0)
  a1(2)
  notify()
  expect(cb2.mock.calls.length).toBe(3)
  expect(cb2.mock.calls[2]?.[0]).toBe(2)

  a3.subscribe(cb3)
  expect(root().state.store.get(a2)!.subs.length).toBe(2)

  atom(() => a3()).subscribe()
  expect(root().state.store.get(a2)!.subs.length).toBe(2)
})

test('conditional deps duplication', () => {
  const name = 'conditionalDeps'
  const condition = atom(true, `${name}.condition`)
  const dep1 = atom(1, `${name}.dep1`)
  const dep2 = atom(2, `${name}.dep2`)

  // This atom will depend on different atoms based on the condition
  const conditional = atom(() => {
    if (condition()) {
      return dep1()
    } else {
      return dep2()
    }
  }, `${name}.conditional`)

  const fn = mockFn()
  const testEffect = atom(() => fn(conditional()), `${name}.testEffect`)

  // Subscribe to start tracking dependencies
  const unsub = testEffect.subscribe()
  expect(fn.calls.length).toBe(1)
  expect(fn.lastInput()).toBe(1) // Initially returns dep1's value

  // Verify initial dependency tracking
  expect(isConnected(dep1)).toBe(true)
  expect(isConnected(dep2)).toBe(false) // Not tracked because condition is true

  // Change condition to false to switch the dependency
  condition(false)
  notify()
  expect(fn.calls.length).toBe(2)
  expect(fn.lastInput()).toBe(2) // Now returns dep2's value

  // Verify dependency tracking has switched
  expect(isConnected(dep1)).toBe(false) // No longer tracked
  expect(isConnected(dep2)).toBe(true)

  // Update dep1, should not trigger update since it's not tracked anymore
  dep1(10)
  notify()
  expect(fn.calls.length).toBe(2) // No change

  // Update dep2, should trigger update since it's now tracked
  dep2(20)
  notify()
  expect(fn.calls.length).toBe(3)
  expect(fn.lastInput()).toBe(20)

  // Change condition back to true to switch the dependency again
  condition(true)
  notify()
  expect(fn.calls.length).toBe(4)
  expect(fn.lastInput()).toBe(10) // Now returns updated dep1's value

  // Final dependency checks
  expect(isConnected(dep1)).toBe(true)
  expect(isConnected(dep2)).toBe(false)

  // Cleanup
  unsub()
  expect(isConnected(dep1)).toBe(false)
  expect(isConnected(dep2)).toBe(false)
})

test('computed without dependencies', () => {
  const name = 'noDeps'
  const a = atom((state = 0) => {
    return state + 1
  }, `${name}.a`)

  expect(a()).toBe(1)
  expect(a()).toBe(1)
  // TODO remove ability to write a computed (replace with Atom + withComputed)
  // @ts-ignore
  expect(a(10)).toBe(11)
})

test('action', () => {
  const testAction = action((...params: any[]) => params, 'testAction')
  expect(testAction(1, 2, 3)).toEqual([1, 2, 3])
})

test('action cause stack', () => {
  const a1 = atom(0, 'a1')
  const a2 = atom(() => a1(), 'a2')
  const act = action((number: number) => a1(number), 'act')

  let log
  atom(() => {
    a2()
    log = getStackTrace()
  }, 'log').subscribe()

  act(1)
  notify()

  expect(log).toBe(' <-- log <-- a2 <-- a1 <-- act')
})

// test.skip('action', () => {
//   const act1 = action(noop)
//   const act2 = action(noop)
//   const fn = mockFn()
//   const a1 = atom(0)
//   const a2 = atom((ctx) => {
//     1 //?
//     a1()
//     act1().forEach(() => fn(1))
//     act2().forEach(() => fn(2))
//   })

//   effect(a2)()
//   assert.is(fn.calls.length, 0)

//   act1()
//   assert.is(fn.calls.length, 1)

//   act1(ctx)
//   assert.is(fn.calls.length, 2)

//   act2(ctx)
//   assert.is(fn.calls.length, 3)
//   assert.equal(
//     fn.calls.map(({ i }) => i[0]),
//     [1, 1, 2],
//   )

//   a1(ctx, (s) => s + 1)
//   assert.is(fn.calls.length, 3)
// })
