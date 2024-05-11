import {
  action,
  assert,
  atom,
  Atom,
  AtomMut,
  clearDefaults,
  effect,
  isConnected,
  mockFn,
  named,
  noop,
  notify,
  read,
  root,
  sleep,
  storeVar,
  StoreWeakMap,
  test,
  top,
  withResolvers,
  wrap,
} from './index.js'

test('should not drop frame stack after await', async () => {
  let getStackTrace = (acc = '', frame = top()): string =>
    frame.cause
      ? getStackTrace(`${acc} <-- ${frame.atom.name}`, frame.cause)
      : acc

  const a0 = atom(0, 'a0')
  const a1 = atom(() => a0() + 1, 'a1')
  const a2 = atom(() => a1() + 1, 'a2')

  const logs: Array<string> = []

  await new Promise<void>((resolve) => {
    effect(async () => {
      const v = a2()
      await wrap(sleep())
      if (v < 5) a0(v)
      else resolve()
    }, 'loop')()

    effect(() => {
      logs.push(a0() + getStackTrace())
    }, 'log')()
  })

  assert.equal(logs, [
    '0 <-- log',
    '2 <-- log <-- a0 <-- loop',
    '4 <-- log <-- a0 <-- loop <-- a2 <-- a1 <-- a0 <-- loop',
  ])
})

test.skip('action', () => {
  const act1 = action(noop)
  const act2 = action(noop)
  const fn = mockFn()
  const a1 = atom(0)
  const a2 = atom((ctx) => {
    1 //?
    a1()
    act1().forEach(() => fn(1))
    act2().forEach(() => fn(2))
  })

  effect(a2)()
  assert.is(fn.calls.length, 0)

  act1()
  assert.is(fn.calls.length, 1)

  act1(ctx)
  assert.is(fn.calls.length, 2)

  act2(ctx)
  assert.is(fn.calls.length, 3)
  assert.equal(
    fn.calls.map(({ i }) => i[0]),
    [1, 1, 2],
  )

  a1(ctx, (s) => s + 1)
  assert.is(fn.calls.length, 3)
})

test('linking', () => {
  const a1 = atom(0, `a1`)
  const a2 = atom(() => a1(), `a2`)
  const fn = mockFn()

  const un = effect(() => fn(a2()))()
  const a1Frame = storeVar.get().get(a1)!
  const a2Frame = storeVar.get().get(a2)!

  assert.is(fn.calls.length, 1)
  assert.is(fn.lastInput(), 0)
  assert.is(a2Frame.pubs[0], a1Frame)
  assert.equal(a1Frame.subs, [a2])

  un()

  assert.is(a1Frame, storeVar.get().get(a1)!)
  assert.is(a2Frame, storeVar.get().get(a2)!)

  assert.is(storeVar.get().get(a1)!.subs.length, 0)
})

test('nested deps', () => {
  const a1 = atom(0, 'a1')
  const a2 = atom(() => a1() + a1() - a1(), 'a2')
  const a3 = atom(() => a1(), 'a3')
  const a4 = atom(() => a2() + a3(), 'a4')
  const a5 = atom(() => a2() + a3(), 'a5')
  const a6 = atom(() => a4() + a5(), 'a6')
  const fn = mockFn()
  const touchedAtoms: Array<Atom> = []

  const check = () => {
    root().state.forEach((frame) => {
      touchedAtoms.push(frame.atom)
      assert.is.not(frame.cause, null, `"${frame.atom.name}" cause is null`)
    })
    notify()
  }
  const un = effect(() => fn(a6()))()

  for (const a of [a1, a2, a3, a4, a5, a6]) {
    assert.is(isConnected(a), true, `"${a.name}" should not be stale`)
  }

  assert.is(fn.calls.length, 1)
  assert.equal(storeVar.get().get(a1)!.subs, [a2, a2, a2, a3])
  assert.equal(storeVar.get().get(a2)!.subs, [a4, a5])
  assert.equal(storeVar.get().get(a3)!.subs, [a4, a5])

  a1(1)
  check()
  assert.is(fn.calls.length, 2)
  assert.is(touchedAtoms.length, new Set(touchedAtoms).size)

  un()
  for (const a of [a6, a5, a4, a3, a2, a1]) {
    assert.is(isConnected(a), false, `"${a.name}" should be stale`)
  }
})

test.skip('transaction batch', () => {
  const track = mockFn()
  const pushNumber = action((n: number) => n)
  const numberAtom = atom((ctx) => {
    pushNumber().forEach(({ payload }) => track(payload))
  })

  effect(numberAtom)()
  assert.is(track.calls.length, 0)

  pushNumber(1)
  notify()
  assert.is(track.calls.length, 1)
  assert.is(track.lastInput(), 1)

  ctx.get(() => {
    pushNumber(ctx, 2)
    assert.is(track.calls.length, 1)
    pushNumber(ctx, 3)
    assert.is(track.calls.length, 1)
  })
  assert.is(track.calls.length, 3)
  assert.is(track.lastInput(), 3)

  ctx.get(() => {
    pushNumber(ctx, 4)
    assert.is(track.calls.length, 3)
    ctx.get(numberAtom)
    assert.is(track.calls.length, 4)
    pushNumber(ctx, 5)
    assert.is(track.calls.length, 4)
  })
  assert.is(track.calls.length, 5)
  assert.is(track.lastInput(), 5)
  assert.equal(
    track.calls.map(({ i }) => i[0]),
    [1, 2, 3, 4, 5],
  )
})

test.skip(`late effects batch`, async () => {
  const a = atom(0)
  const ctx = createCtx({
    // @ts-ignores
    callLateEffect: (cb, ...a) => setTimeout(() => cb(...a)),
  })
  const fn = mockFn()
  ctx.subscribe(a, fn)

  assert.is(fn.calls.length, 1)
  assert.is(fn.lastInput(), 0)

  a(ctx, (s) => s + 1)
  a(ctx, (s) => s + 1)
  await Promise.resolve()
  a(ctx, (s) => s + 1)

  assert.is(fn.calls.length, 1)

  await new Promise((r) => setTimeout(r))

  assert.is(fn.calls.length, 2)
  assert.is(fn.lastInput(), 3)
})

test.skip(`display name`, () => {
  const firstNameAtom = atom(`John`, `firstName`)
  const lastNameAtom = atom(`Doe`, `lastName`)
  const isFirstNameShortAtom = atom(
    (ctx) => ctx.spy(firstNameAtom).length < 10,
    `isFirstNameShort`,
  )
  const fullNameAtom = atom(
    (ctx) => `${ctx.spy(firstNameAtom)} ${ctx.spy(lastNameAtom)}`,
    `fullName`,
  )
  const displayNameAtom = atom(
    (ctx) =>
      ctx.spy(isFirstNameShortAtom)
        ? ctx.spy(fullNameAtom)
        : ctx.spy(firstNameAtom),
    `displayName`,
  )
  const effect = mockFn()

  onConnect(fullNameAtom, () => effect(`fullNameAtom init`))
  onDisconnect(fullNameAtom, () => effect(`fullNameAtom cleanup`))
  onConnect(displayNameAtom, () => effect(`displayNameAtom init`))
  onDisconnect(displayNameAtom, () => effect(`displayNameAtom cleanup`))

  const ctx = createCtx()

  const un = ctx.subscribe(displayNameAtom, () => {})

  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    ['displayNameAtom init', 'fullNameAtom init'],
  )
  effect.calls = []

  firstNameAtom(ctx, `Joooooooooooohn`)
  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`fullNameAtom cleanup`],
  )
  effect.calls = []

  firstNameAtom(ctx, `Jooohn`)
  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`fullNameAtom init`],
  )
  effect.calls = []

  un()
  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`displayNameAtom cleanup`, `fullNameAtom cleanup`],
  )
})

test(// this test written is more just for example purposes
'dynamic lists', async () => {
  const list = atom(new Array<AtomMut<number>>(), 'list')
  const sum = atom(() => list().reduce((acc, a) => acc + a(), 0), 'sum')
  const sumListener = mockFn<[number]>()

  effect(() => {
    sumListener(sum())

    // TODO different behavior
    // const first = list()[0]
    const first = read(list)[0]
    if (!first) return

    first(read(first) + 1)
    first(read(first) - 1)
  }, 'sum.effect')()

  assert.is(sumListener.calls.length, 1)
  assert.is(sumListener.lastInput(), 0)

  sumListener.calls.length = 0

  const count = 3
  let i = 0
  while (i++ < count) {
    list([...list(), atom(1, `list#${i}`)])
    // notify()
    await wrap(sleep())

    assert.is(sumListener.lastInput(), i)
  }

  assert.is(sumListener.calls.length, count)
  assert.is(sumListener.lastInput(), count)

  const first = list()[0]!
  first(first() + 1)
  // notify()
  await wrap(sleep())
  assert.is(sumListener.calls.length, count + 1)
  assert.is(sumListener.lastInput(), count + 1)
})

test.skip('no uncaught errors from schedule promise', () => {
  const doTest = action((ctx) => {
    ctx.schedule(() => {})
    throw 'err'
  })
  const ctx = createCtx()

  assert.throws(() => doTest(ctx))
})

test.skip('async cause track', () => {
  const a1 = atom(0, 'a1')
  const act1 = action((ctx) => ctx.schedule(() => act2(ctx)), 'act1')
  const act2 = action((ctx) => a1(ctx, (s) => ++s), 'act2')
  const ctx = createCtx()
  const logger = mockFn()

  ctx.subscribe(logger)

  ctx.subscribe(a1, (v) => {})

  act1(ctx)

  assert.is(
    logger.lastInput().find((patch: AtomCache) => patch.proto.name === 'a1')
      ?.cause.proto.name,
    'act2',
  )
})

test('disconnect tail deps', () => {
  const a = atom(0, 'aAtom')
  const track = mockFn(() => a())
  const b = atom(track, 'bAtom')
  const isActive = atom(true, 'isActiveAtom')
  const bController = atom(() => (isActive() ? b() : null))

  effect(bController)()
  assert.is(track.calls.length, 1)
  assert.ok(isConnected(b))

  isActive(false)
  a(a() + 1)
  notify()
  assert.is(track.calls.length, 1)
  assert.not.ok(isConnected(b))
})

test('deps shift', () => {
  const a = atom(0)
  const b = atom(0)
  const c = atom(0)
  const deps = [a, b, c]

  const d = atom(() => deps.forEach((dep) => dep()))

  effect(d)()
  assert.equal([a, b, c].map(isConnected), [true, true, true])

  deps.shift()
  a(a() + 1)
  assert.equal([a, b, c].map(isConnected), [false, true, true])
  notify()
  assert.equal([a, b, c].map(isConnected), [false, true, true])
})

test('subscribe to cached atom', () => {
  const a1 = atom(0)
  const a2 = atom((ctx) => a1())

  a2()
  effect(() => a2())()

  assert.ok(isConnected(a2))
})

test('update propagation for atom with listener', () => {
  const a1 = atom(1)
  const a2 = atom(() => a1())
  const a3 = atom(() => a2())
  const cb2 = mockFn()
  const cb3 = mockFn()

  // onConnect(a1, (v) => {
  //   1 //?
  // })
  // onDisconnect(a1, (v) => {
  //   ;-1 //?
  // })
  // onConnect(a2, (v) => {
  //   2 //?
  // })
  // onDisconnect(a2, (v) => {
  //   ;-2 //?
  // })
  // onConnect(a3, (v) => {
  //   3 //?
  // })
  // onDisconnect(a3, (v) => {
  //   ;-3 //?
  // })

  assert.not.ok(isConnected(a1))
  assert.not.ok(isConnected(a2))
  assert.not.ok(isConnected(a3))

  let un2 = effect(() => cb2(a2()))()
  let un3 = effect(() => cb3(a3()))()
  assert.ok(isConnected(a1))
  assert.ok(isConnected(a2))
  assert.ok(isConnected(a3))
  assert.is(cb2.calls.length, 1)
  assert.is(cb3.calls.length, 1)

  a1(2)
  notify()
  assert.is(cb2.calls.length, 2)
  assert.is(cb2.lastInput(), 2)
  assert.is(cb3.calls.length, 2)
  assert.is(cb3.lastInput(), 2)

  un3()
  assert.ok(isConnected(a1))
  assert.ok(isConnected(a2))
  assert.not.ok(isConnected(a3))

  a1(3)
  notify()
  assert.is(cb2.calls.length, 3)
  assert.is(cb2.lastInput(), 3)
  assert.is(cb3.calls.length, 2)
  assert.is(cb3.lastInput(), 2)

  un3 = effect(() => cb3(a3()))()
  assert.ok(isConnected(a1))
  assert.ok(isConnected(a2))
  assert.ok(isConnected(a3))

  un2()
  un3()
  assert.not.ok(isConnected(a1))
  assert.not.ok(isConnected(a2))
  assert.not.ok(isConnected(a3))
})

test.skip('update queue', () => {
  const a1 = atom(5)
  const a2 = atom((ctx) => {
    const v = ctx.spy(a1)
    if (v < 3) ctx.schedule(track, 0)
  })
  let iterations = 0
  const track = mockFn(() => {
    if (iterations++ > 5) throw new Error('circle')
    a1(ctx, (s) => ++s)
  })
  const ctx = createCtx()

  ctx.subscribe(a2, () => {})
  assert.is(track.calls.length, 0)

  a1(ctx, 0)
  assert.is(track.calls.length, 3)

  iterations = 5
  assert.throws(() => a1(ctx, 0))
})

test.skip('do not create extra patch', () => {
  const a = atom(0)
  const ctx = createCtx()
  const track = mockFn()
  ctx.get(a)

  ctx.subscribe(track)
  ctx.get(() => ctx.get(a))
  assert.is(track.calls.length, 0)
})

test.skip('should catch', async () => {
  const a = atom(() => {
    throw new Error()
  })
  const ctx = createCtx()
  assert.throws(() => ctx.get(a))

  const p = ctx.get(() => ctx.schedule(() => ctx.get(a)))

  const res1 = await p.then(
    () => 'then',
    () => 'catch',
  )
  assert.is(res1, 'catch')

  const res2 = await ctx
    .get(() => ctx.schedule(() => ctx.get(a)))
    .then(
      () => 'then',
      () => 'catch',
    )
  assert.is(res2, 'catch')
})

test.skip('no extra tick by schedule', async () => {
  let isDoneSync = false
  createCtx()
    .schedule(() => {
      console.log('schedule')
      return 'TEST schedule'
    })
    .then(() => (isDoneSync = true))

  await null

  assert.is(isDoneSync, true)

  let isDoneAsync = false
  createCtx()
    .schedule(async () => {})
    .then(() => (isDoneAsync = true))

  await null
  await null

  assert.is(isDoneAsync, true)

  let isDoneAsyncInTr = false
  const ctx = createCtx()
  ctx.get(() =>
    ctx.schedule(async () => {}).then(() => (isDoneAsyncInTr = true)),
  )

  await null
  await null

  assert.is(isDoneAsyncInTr, true)
})

test.skip('update callback should accept the fresh state', () => {
  const a = atom(0)
  const b = atom(0)
  b.__reatom.computer = (ctx) => ctx.spy(a)

  assert.is(ctx.get(b), 0)

  a(ctx, 1)
  assert.is(ctx.get(b), 1)

  a(ctx, 2)
  let state
  b(ctx, (s) => {
    state = s
    return s
  })
  assert.is(ctx.get(b), 2)
  assert.is(state, 2)
})

test.skip('updateHooks should be called only for computers', () => {
  const track = mockFn()

  const a = atom(1)
  a.onChange(() => track('a'))

  const b = atom(0)
  b.__reatom.initState = () => 2
  b.onChange(() => track('b'))

  const c = atom((ctx, state = 3) => state)
  c.onChange(() => track('c'))

  const ctx = createCtx()

  assert.is(ctx.get(a), 1)
  assert.is(ctx.get(b), 2)
  assert.is(ctx.get(c), 3)
  assert.equal(track.inputs(), ['c'])
})

test.skip('hooks', () => {
  const theAtom = atom(0)
  const atomHook = mockFn()
  theAtom.onChange(atomHook)

  const theAction = action((ctx, param) => `param:${param}`)
  const actionHook = mockFn()
  theAction.onCall(actionHook)

  const ctx = createCtx()

  ctx.get(theAtom)
  ctx.get(theAction)
  assert.is(atomHook.calls.length, 0)
  assert.is(actionHook.calls.length, 0)

  theAtom(ctx, 1)
  assert.is(atomHook.calls.length, 1)
  assert.is(atomHook.lastInput(0).subscribe, ctx.subscribe)
  assert.is(atomHook.lastInput(1), 1)

  theAction(ctx, 1)
  assert.is(actionHook.calls.length, 1)
  assert.is(actionHook.lastInput(0).subscribe, ctx.subscribe)
  assert.is(actionHook.lastInput(1), 'param:1')
  assert.equal(actionHook.lastInput(2), [1])
})

test.skip('update hook for atom without cache', () => {
  const a = atom(0)
  const hook = mockFn()
  a.onChange(hook)
  const ctx = createCtx()

  a(ctx, 1)
  assert.is(hook.calls.length, 1)
})

test.skip('cause available inside a computation', () => {
  let test = false
  const a = atom(0, 'a')
  const b = atom(() => {
    a() //?
    if (test) assert.is(top().cause?.atom, a)
  }, 'b')

  effect(b) // init
  a(123)
  test = true
  notify()
  b()
})

test.skip('ctx collision', () => {
  const a = atom(0)
  const ctx1 = createCtx()
  const ctx2 = createCtx()

  assert.throws(() => ctx1.get(() => ctx2.get(a)))
})

test('conditional deps duplication', () => {
  const list = atom([1, 2, 3])

  const filter = atom<'odd' | 'even'>('odd')

  const filteredList = atom((ctx) => {
    if (filter() === 'odd') {
      return list().filter((n) => n % 2 === 1)
    } else if (filter() === 'even') {
      return list().filter((n) => n % 2 === 0)
    }
    return list()
  })

  const track = mockFn()

  effect(() => track(filteredList()))()
  assert.equal(track.lastInput(), [1, 3])

  filter('even')
  notify()
  assert.equal(track.lastInput(), [2])

  filter('odd')
  notify()
  assert.equal(track.lastInput(), [1, 3])

  filter('even')
  notify()
  assert.equal(track.lastInput(), [2])
})

test('should drop actualization of stale atom', () => {
  const a = atom(0)
  const b = atom(() => a())

  assert.is(b(), 0)
  a(1)
  assert.is(b(), 1)
})

test('diamon effect', () => {
  const a = atom(0)
  const b = atom(() => a())
  const c = atom(() => a())

  const track = mockFn(() => b() + c())

  effect(track)()
  assert.is(track.calls.length, 1)

  a(1)
  notify()
  assert.is(track.calls.length, 2)
})

test('effects order should not change', () => {
  const a = atom(true)
  const b = atom(10)
  const c = atom(() => (a() ? b() : 0))
  const logs = mockFn()
  effect(c)()
  effect(() => logs(`b1: ${b()}`))()
  effect(() => logs(`b2: ${b()}`))()

  assert.equal(logs.inputs(), ['b1: 10', 'b2: 10'])

  logs.calls.length = 0
  a(false)
  notify()
  b(20)
  notify()
  assert.equal(logs.inputs(), ['b1: 20', 'b2: 20'])
})

test.skip('global atoms should propagate their changes to all dependent scopes', async () => {
  class ProxyStoreWeakMap extends WeakMap implements StoreWeakMap {
    constructor(private store: StoreWeakMap) {
      super()
    }
    get(key: any) {
      return super.has(key) ? super.get(key) : this.store.get(key)
    }
    set(key: any, value: any) {
      if (this.store.has(key)) {
        this.store.set(key, value)
      } else {
        super.set(key, value)
      }
      return this
    }
    has(key: any) {
      return super.has(key) || this.store.has(key)
    }
  }

  const scope = <T>(fn: () => T): T => {
    return atom(
      () => {
        top().context = new Map([
          [storeVar, new ProxyStoreWeakMap(storeVar.get())],
        ])
        return fn()
      },
      named`nest`,
    )()
  }

  const tax = atom(0, 'tax')
  const cost = atom(0, 'cost')
  const price = atom(async () => {
    await wrap(sleep())
    return cost() + cost() * tax()
  }, 'price')

  const logs: Array<number> = []
  const done = () => logs.length === 2 && resolve(logs)

  tax(0.2)
  scope(() => {
    effect(async () => {
      cost(1)
      logs.push(await wrap(price()))
      done()
    })()
  })
  scope(() => {
    effect(async () => {
      cost(2)
      logs.push(await wrap(price()))
      done()
    })()
  })

  var { promise, resolve } = withResolvers(100)
  await wrap(promise)
  assert.equal(logs, [1.2, 2.4])

  logs.length = 0
  tax(0.4)
  var { promise, resolve } = withResolvers(100)
  await wrap(promise)
  assert.equal(logs, [1.4, 2.8])
})

// test(`maximum call stack`, () => {
//   const atoms = new Map<AtomProto, Atom>()
//   let i = 0
//   const reducer = (ctx: CtxSpy): any => {
//     let dep = atoms.get(ctx.cause!.proto)
//     if (!dep)
//       atoms.set(ctx.cause!.proto, (dep = ++i > 10_000 ? atom(0) : atom(reducer)))
//     return ctx.spy(dep)
//   }
//   const testAtom = atom(reducer)
//   const ctx = createCtx()

//   assert.throws(
//     () => {
//       try {
//         ctx.get(testAtom)
//       } catch (error) {
//         i //?
//         error.message //?
//         throw error
//       }
//     },
//     /Maximum call stack/,
//     '',
//   )
//
// })

// TODO: should we run tests twice with and without defaults?
// clearDefaults()
test.run()
