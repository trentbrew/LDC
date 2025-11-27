export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'ident'; name: string }
  | { t: 'binary'; op: string; left: Expr; right: Expr }
  | { t: 'unary'; op: string; expr: Expr }
  | { t: 'ternary'; cond: Expr; then: Expr; else: Expr }
  | { t: 'member'; obj: Expr; prop: string }
  | { t: 'index'; obj: Expr; idx: Expr }
  | { t: 'call'; callee: Expr; args: Expr[] }
  | { t: 'lambda'; params: string[]; body: Expr };

export type Token =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'punc'; v: string }
  | { k: 'op'; v: string }
  | { k: 'eof' };
