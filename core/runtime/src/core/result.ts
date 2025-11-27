// Minimal Result runtime with helpers

export type Ok<T> = { t: "ok"; v: T };
export type Err = { t: "err"; code: string; msg?: string; data?: unknown };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(v: T): Ok<T> => ({ t: "ok", v });
export const err = (code: string, msg?: string, data?: unknown): Err => ({ t: "err", code, msg, data });

export const isOk = <T>(r: Result<T>): r is Ok<T> => r.t === "ok";
export const isErr = <T>(r: Result<T>): r is Err => r.t === "err";

export const map = <A, B>(r: Result<A>, f: (a: A) => B): Result<B> =>
  isOk(r) ? ok(f(r.v)) : r;

export const andThen = <A, B>(r: Result<A>, f: (a: A) => Result<B>): Result<B> =>
  isOk(r) ? f(r.v) : r;

export const unwrap = <T>(r: Result<T>, dflt?: T): T => (isOk(r) ? r.v : (dflt as T));

export const match = <T, R>(r: Result<T>, arms: { ok: (v: T) => R; err: (e: Err) => R }): R =>
  isOk(r) ? arms.ok(r.v) : arms.err(r);

