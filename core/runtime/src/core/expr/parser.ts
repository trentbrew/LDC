import type { Expr, Token } from './types';

const isWS = (c: string) => /\s/.test(c);
const isIdStart = (c: string) => /[A-Za-z_?$]/.test(c);
const isId = (c: string) => /[A-Za-z0-9_?$]/.test(c);

export function tokenize(input: string): Token[] {
  const tks: Token[] = [];
  let i = 0;
  const peek = () => input[i] ?? '';
  const next = () => input[i++] ?? '';
  while (i < input.length) {
    const c = peek();
    if (isWS(c)) {
      next();
      continue;
    }
    if (c === '/' && input[i + 1] === '/') {
      // line comment
      while (i < input.length && next() !== '\n');
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let s = '';
      let hasDot = false;
      if (c === '.') {
        s += next();
        hasDot = true;
      }
      while (/[0-9]/.test(peek())) s += next();
      if (!hasDot && peek() === '.' && /[0-9]/.test(input[i + 1] ?? '')) {
        s += next();
        hasDot = true;
        while (/[0-9]/.test(peek())) s += next();
      }
      tks.push({ k: 'num', v: Number(s) });
      continue;
    }
    if (c === '"' || c === "'") {
      const q = next();
      let s = '';
      while (i < input.length) {
        const ch = next();
        if (ch === '\\') {
          s += input[i++] ?? '';
          continue;
        }
        if (ch === q) break;
        s += ch;
      }
      tks.push({ k: 'str', v: s });
      continue;
    }
    const two = input.slice(i, i + 2);
    const three = input.slice(i, i + 3);
    if (['??', '<=', '>=', '==', '!=', '=>', '**'].includes(two)) {
      tks.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if (['and', 'or', 'not'].includes(three) && !isId(input[i + 3] ?? '')) {
      tks.push({ k: 'op', v: three });
      i += 3;
      continue;
    }
    if (c === '?' && isId(input[i + 1] ?? '')) {
      // variable like ?x
      let s = next();
      while (isId(peek())) s += next();
      tks.push({ k: 'id', v: s });
      continue;
    }
    if (['(', ')', '[', ']', '.', ',', ':'].includes(c)) {
      tks.push({ k: 'punc', v: c });
      i++;
      continue;
    }
    if (['+', '-', '*', '/', '%', '<', '>', '!'].includes(c)) {
      tks.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if (isIdStart(c)) {
      let s = next();
      while (isId(peek())) s += next();
      tks.push({ k: 'id', v: s });
      continue;
    }
    throw new Error(`Unexpected char: ${c}`);
  }
  tks.push({ k: 'eof' });
  return tks;
}

type Nud = () => Expr;
type Led = (left: Expr) => Expr;

export function parseExpr(input: string): Expr {
  const tokens = tokenize(input);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (k: Token['k'], v?: string) => {
    const t = next();
    if (t.k !== k || (v !== undefined && (t as any).v !== v))
      throw new Error(`Expected ${k}${v ? ':' + v : ''}`);
    return t;
  };

  const bp = (op: string) => {
    switch (op) {
      case 'or':
        return 1;
      case 'and':
        return 2;
      case '??':
        return 3;
      case '==':
      case '!=':
        return 4;
      case '<':
      case '>':
      case '<=':
      case '>=':
        return 5;
      case '+':
      case '-':
        return 6;
      case '*':
      case '/':
      case '%':
        return 7;
      case '**':
        return 8;
      default:
        return 0;
    }
  };

  function parsePrimary(): Expr {
    const t = next();
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') {
      if (t.v === 'true') return { t: 'bool', v: true };
      if (t.v === 'false') return { t: 'bool', v: false };
      if (t.v === 'null') return { t: 'null' };
      // possible arrow function: single param => expr
      if (peek().k === 'op' && (peek() as any).v === '=>') {
        next(); // =>
        const body = parse(0);
        return { t: 'lambda', params: [t.v], body };
      }
      return { t: 'ident', name: t.v };
    }
    if (t.k === 'punc' && (t as any).v === '(') {
      // Could be (a,b)=>expr lambda or grouped expr
      if (peek().k === 'punc' && (peek() as any).v === ')') {
        next();
        expect('op', '=>');
        const body = parse(0);
        return { t: 'lambda', params: [], body };
      }
      // try parse params then =>
      const saveI = i;
      const params: string[] = [];
      let isLambda = false;
      if (peek().k === 'id') {
        params.push((next() as any).v);
        while (peek().k === 'punc' && (peek() as any).v === ',') {
          next();
          params.push((expect('id') as any).v);
        }
      }
      if (peek().k === 'punc' && (peek() as any).v === ')') {
        next();
        if (peek().k === 'op' && (peek() as any).v === '=>') {
          next();
          isLambda = true;
        }
      }
      if (isLambda) {
        const body = parse(0);
        return { t: 'lambda', params, body };
      }
      // not lambda: revert and parse group
      i = saveI;
      const inner = parse(0);
      expect('punc', ')');
      return inner;
    }
    if (
      t.k === 'op' &&
      ((t as any).v === '+' ||
        (t as any).v === '-' ||
        (t as any).v === 'not' ||
        (t as any).v === '!')
    ) {
      const expr = parse(bp('**'));
      return { t: 'unary', op: (t as any).v, expr };
    }
    throw new Error(`Unexpected token: ${t.k}:${(t as any).v}`);
  }

  function parsePostfix(expr: Expr): Expr {
    while (true) {
      const t = peek();
      if (t.k === 'punc' && (t as any).v === '.') {
        next();
        const id = expect('id');
        expr = { t: 'member', obj: expr, prop: (id as any).v };
        continue;
      }
      if (t.k === 'punc' && (t as any).v === '[') {
        next();
        const idx = parse(0);
        expect('punc', ']');
        expr = { t: 'index', obj: expr, idx };
        continue;
      }
      if (t.k === 'punc' && (t as any).v === '(') {
        next();
        const args: Expr[] = [];
        if (!(peek().k === 'punc' && (peek() as any).v === ')')) {
          args.push(parse(0));
          while (peek().k === 'punc' && (peek() as any).v === ',') {
            next();
            args.push(parse(0));
          }
        }
        expect('punc', ')');
        expr = { t: 'call', callee: expr, args };
        continue;
      }
      break;
    }
    return expr;
  }

  function parse(precedence: number): Expr {
    let left = parsePrimary();
    left = parsePostfix(left);
    while (true) {
      const t = peek();
      if (t.k === 'punc' && ([')', ']', ','] as any).includes((t as any).v))
        break;
      if (t.k === 'op') {
        const op = (t as any).v as string;
        const rbp = bp(op);
        if (rbp <= precedence) break;
        next();
        const right = parse(rbp);
        left = { t: 'binary', op, left, right };
        continue;
      }
      break;
    }
    return left;
  }

  const expr = parse(0);
  if (peek().k !== 'eof') throw new Error('Unexpected trailing tokens');
  return expr;
}
