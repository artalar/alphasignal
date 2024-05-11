// @ts-ignore
Promise.withResolvers ??= () => {
  let resolve;
  let reject;
  let promise = new Promise((...a) => ([resolve, reject] = a));
  return { resolve, reject, promise };
};

export function mockFn<I extends any[], O = unknown>(
  fn: (...input: I) => O = (...i: any) => void 0 as any
) {
  const _fn = Object.assign(
    function (...i: I) {
      try {
        // @ts-ignore
        var o = fn.apply(this, i);
      } catch (error) {
        // @ts-ignore
        _fn.calls.push({ i, o: error });

        throw error;
      }

      _fn.calls.push({ i, o });

      return o;
    },
    {
      calls: new Array<{ i: I; o: O }>(),
      inputs(): Array<I[number]> {
        return _fn.calls.map(({ i }) => i[0]);
      },
      lastInput<Index extends Extract<keyof I, number> | null = null>(
        ...args: [index: Index] | []
      ): I[Index extends null ? 0 : Index] {
        const { length } = _fn.calls;
        if (length === 0) throw new TypeError(`Array is empty`);
        return _fn.calls[length - 1]!.i[args[0] ?? 0];
      },
    }
  );

  return _fn;
}

export const getDuration = async (cb: () => void) => {
  const start = Date.now();
  await cb();
  return Date.now() - start;
};
