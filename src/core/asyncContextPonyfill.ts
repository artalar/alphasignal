import {
  action,
  Action,
  Fn,
  named,
  root,
  RootState,
  STACK,
  storeVar,
  top,
  VariableFrame,
} from './internal.js'

// https://github.com/tc39/proposal-async-context#proposed-solution
export namespace AsyncContext {
  interface AsyncVariableOptions<T = any> {
    name?: string
    defaultValue: T
  }

  export class Variable<T = any> {
    name: string

    private defaultValue: T

    /**
     * we need an additional action to create extra frame with the value for each run
     * @ponyfill
     */
    private runner: Action<[T, Fn]>

    constructor({
      name = named`variable`,
      defaultValue,
    }: AsyncVariableOptions<T>) {
      this.name = name
      this.defaultValue = defaultValue as T
      this.runner = action((value: T, cb: Fn) => {
        ;(top().context ??= new Map()).set(this, value)
        return cb()
      }, this.name)
    }

    run<I extends any[], O>(value: T, fn: (...args: I) => O, ...args: I): O {
      return this.runner(value, () => fn(...args))
    }

    get(frame = top()): T {
      while (!frame.context?.has(this) && frame.cause !== null) {
        frame = frame.cause
      }

      let { context } = frame as VariableFrame

      if (context.has(this)) return context.get(this) as T

      // TODO the defaults should be only returned or setted too? Should we have an init callback (the standard have no one)?
      context.set(this, this.defaultValue)
      return this.defaultValue
    }
  }
  export class Snapshot {
    /** @ponyfill */
    static createRoot() {
      let frame: VariableFrame<RootState> = {
        error: null,
        state: [],
        atom: root,
        cause: null,
        context: new Map(),
        pubs: [],
        subs: [],
      }

      frame.context.set(storeVar, new WeakMap().set(root, frame))

      return new this(frame)
    }

    static wrap<T extends Promise<any> | Fn>(target: T, frame = top()): T {
      let snapshot = new AsyncContext.Snapshot(frame)

      if (typeof target === 'function') {
        return snapshot.run.bind(snapshot, target) as T
      }

      return new Promise(async (resolve, reject) => {
        try {
          let value = await target
          var seal = () => resolve(value)
        } catch (error) {
          seal = () => reject(error)
        }
        Promise.resolve().then(() => STACK.push(snapshot.frame))
        seal()
        Promise.resolve().then(() => STACK.pop())
      }) as T
    }

    constructor(public frame = top()) {}

    run<I extends any[], O>(fn: (...args: I) => O, ...args: I): O {
      STACK.push(this.frame)
      try {
        return fn(...args)
      } finally {
        STACK.pop()
      }
    }
  }
}
