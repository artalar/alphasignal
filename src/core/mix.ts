import { Action, AtomLike } from './atom'
import { OverloadParameters, Rec } from './utils'

export interface Assigner<
  Target extends AtomLike,
  Result extends Rec<unknown> = Rec<unknown>,
> {
  (target: Target): Result
}
export type AssignerBind<T> = T extends AtomLike
  ? T
  : T extends (...params: infer Params) => infer Payload
  ? Action<Params, Payload>
  : T

export interface Middleware<Target extends AtomLike, Params extends any[]> {
  (target: Target): (
    next: (...params: [] | OverloadParameters<Target>) => ReturnType<Target>,
    ...params: Params
  ) => ReturnType<Target>
}

export type Extension<Target extends AtomLike> =
  | Assigner<Target>
  | Middleware<Target, any[]>

export type ExtendedAtom<
  Target extends AtomLike,
  T extends Assigner<Target> | Middleware<Target, any[]>,
> = T extends Assigner<Target, infer Result>
  ? Target & { [K in keyof Result]: AssignerBind<Result[K]> }
  : T extends Middleware<Target, OverloadParameters<Target>>
  ? Target
  : T extends Middleware<Target, infer Params>
  ? AtomLike<ReturnType<Target>> & {
      (...params: Params): ReturnType<Target>
    } & {
      [K in Exclude<keyof Target, keyof AtomLike>]: Target[K]
    }
  : never

export interface Mix<Target extends AtomLike> {
  /* prettier-ignore */ <T1 extends Extension<Target>>(extension1: T1): ExtendedAtom<Target, T1>
  /* prettier-ignore */ <T1 extends Extension<Target>, T2 extends Extension<ExtendedAtom<Target, T1>>, >(extension1: T1, extension2: T2): ExtendedAtom<ExtendedAtom<Target, T1>, T2>
  /* prettier-ignore */ <T1 extends Extension<Target>, T2 extends Extension<ExtendedAtom<Target, T1>>, T3 extends Extension<ExtendedAtom<ExtendedAtom<Target, T1>, T2>>>(extension1: T1, extension2: T2, extension3: T3): ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>
  /* prettier-ignore */ <T1 extends Extension<Target>, T2 extends Extension<ExtendedAtom<Target, T1>>, T3 extends Extension<ExtendedAtom<ExtendedAtom<Target, T1>, T2>>, T4 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>>>(extension1: T1, extension2: T2, extension3: T3, extension4: T4): ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>
  /* prettier-ignore */ <T1 extends Extension<Target>, T2 extends Extension<ExtendedAtom<Target, T1>>, T3 extends Extension<ExtendedAtom<ExtendedAtom<Target, T1>, T2>>, T4 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>>, T5 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>>>(extension1: T1, extension2: T2, extension3: T3, extension4: T4, extension5: T5): ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>, T5>
  /* prettier-ignore */ <T1 extends Extension<Target>, T2 extends Extension<ExtendedAtom<Target, T1>>, T3 extends Extension<ExtendedAtom<ExtendedAtom<Target, T1>, T2>>, T4 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>>, T5 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>>, T6 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>, T5>>>(extension1: T1, extension2: T2, extension3: T3, extension4: T4, extension5: T5, extension6: T6): ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>, T5>, T6>
  /* prettier-ignore */ <T1 extends Extension<Target>, T2 extends Extension<ExtendedAtom<Target, T1>>, T3 extends Extension<ExtendedAtom<ExtendedAtom<Target, T1>, T2>>, T4 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>>, T5 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>>, T6 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>, T5>>, T7 extends Extension<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>, T5>, T6>>>(extension1: T1, extension2: T2, extension3: T3, extension4: T4, extension5: T5, extension6: T6, extension7: T7): ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<ExtendedAtom<Target, T1>, T2>, T3>, T4>, T5>, T6>, T7>
}
