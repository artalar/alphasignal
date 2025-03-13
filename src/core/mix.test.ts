import { expectTypeOf, test } from 'vitest'

import { Action, Assigner, Atom, atom, AtomLike } from './atom'

// Simple extension for testing
const withProp =
  <P extends string, V>(prop: P, value: V): Assigner<AtomLike, Record<P, V>> =>
  () =>
    ({ [prop]: value } as Record<P, V>)

test('1 assigner extension', () => {
  const test1 = atom(0).mix(withProp('a', 1))

  expectTypeOf(test1).toHaveProperty('a')
  expectTypeOf(test1.a).toEqualTypeOf<number>()
})

test('7 assigner extensions', () => {
  const test7 = atom(0).mix(
    withProp('a', 1),
    withProp('b', 2),
    withProp('c', 3),
    withProp('d', 4),
    withProp('e', 5),
    withProp('f', 6),
    withProp('g', 7),
  )

  expectTypeOf(test7).toExtend<
    Atom<number> & {
      a: number
      b: number
      c: number
      d: number
      e: number
      f: number
      g: number
    }
  >()
})

test('bind assigned functions', () => {
  const number = atom(0).mix((target) => ({
    inc: (to = 1) => target(target() + to),
  }))

  expectTypeOf(number.inc).toExtend<Action<[number?], number>>()
})
