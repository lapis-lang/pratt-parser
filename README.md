# @lapis-lang/pratt-parser

A TypeScript implementation of a Pratt (top-down operator precedence) parser.
Define grammars by subclassing `Grammar<T>` and declaring operators in the
constructor. The grammar definition drives an integrated longest-match lexer —
no separate tokenisation step required. `T` is generic: use `number` for a
direct interpreter or an AST node type for a compiler front-end.

## Installation

```sh
npm install @lapis-lang/pratt-parser
```

## Usage

```ts
import { Grammar } from '@lapis-lang/pratt-parser';

abstract class MathSemantics<T> extends Grammar<T> {
    constructor() {
        super();
        this.infix('+', 10, (l, r) => this.add(l, r));
        this.infix('-', 10, (l, r) => this.sub(l, r));
        this.infix('*', 20, (l, r) => this.mul(l, r));
        this.infix('/', 20, (l, r) => this.div(l, r));
        this.infixR('^', 30, (l, r) => this.pow(l, r));  // right-associative
        this.postfix('!', 30, (v) => this.fact(v));
        this.prefix('-', 100, (v) => this.neg(v));
        this.prefix('+', 100, (v) => this.pos(v));
        this.group('(', ')', Number.MAX_SAFE_INTEGER);
        this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1,
                   (lit) => this.int(lit));
        this.skipWhile((ch) => ' \t\n\r'.includes(ch));
    }
    protected abstract int(lit: string): T;
    protected abstract add(l: T, r: T): T;
    protected abstract sub(l: T, r: T): T;
    protected abstract mul(l: T, r: T): T;
    protected abstract div(l: T, r: T): T;
    protected abstract pow(l: T, r: T): T;
    protected abstract neg(v: T): T;
    protected abstract pos(v: T): T;
    protected abstract fact(v: T): T;
}

class MathInterpreter extends MathSemantics<number> {
    protected int(lit: string)            { return parseInt(lit, 10); }
    protected add(l: number, r: number)   { return l + r; }
    protected sub(l: number, r: number)   { return l - r; }
    protected mul(l: number, r: number)   { return l * r; }
    protected div(l: number, r: number)   { return l / r; }
    protected pow(l: number, r: number)   { return Math.pow(l, r); }
    protected neg(v: number)              { return -v; }
    protected pos(v: number)              { return v; }
    protected fact(v: number): number     { return v <= 1 ? 1 : v * this.fact(v - 1); }
}

const calc = new MathInterpreter();
console.log(calc.parse('1 + 2 * 3'));   // 7
console.log(calc.parse('2^3^2'));       // 512  (right-associative: 2^(3^2))
console.log(calc.parse('(1+2) * 3'));   // 9
console.log(calc.parse('3!'));          // 6
```

## API

### `Grammar<T>` (abstract)

Subclass and populate the symbol table from your constructor.

| Method | Description |
|---|---|
| `parse(input: string): T` | Parse a string and return a value of type `T`. Throws `ParseError` on syntax errors. |
| `infix(id, bp, action)` | Left-associative binary operator. |
| `infixR(id, bp, action)` | Right-associative binary operator. |
| `prefix(id, bp, action)` | Unary prefix operator. |
| `postfix(id, bp, action)` | Unary postfix operator. |
| `group(open, close, bp)` | Grouping construct (e.g. parentheses). |
| `match(id, predicate, priority, action)` | Predicate-based token (digits, identifiers, …). |
| `skipWhile(predicate)` | Characters to skip between tokens (whitespace). |
| `symbol(id)` | Register a bare separator token (no semantics). |
| `ternaryPrefix(first, second, third, bp, action)` | Prefix ternary operator, e.g. `let x = e in body`. |
| `ternaryInfix(first, second, bp, action)` | Infix ternary operator, e.g. `cond ? then : else`. |

### `ParseError`

Extends `Error`. Additional properties: `position` (0-based offset), `line` (1-based), `column` (1-based).

## Advanced: Compilation with Variables and Lexical Scope

`Grammar<T>` is fully generic, so the same abstract grammar can be subtyped for
different `T` values. The pattern below mirrors Sasa's `EquationParser : MathSemantics<Exp>`:

```
MathSemantics<T>   (abstract grammar — defines operators)
  ├── MathInterpreter  (T = number)  — direct interpreter, no AST
  └── EquationParser   (T = Exp)     — compiler front-end, produces an AST
```

`EquationParser` inherits `parse(input): Exp` from `Grammar<T>` and adds its own methods:

| Method | Description |
|---|---|
| `parse(input)` | *(inherited)* — produces an `Exp` AST |
| `evaluate(expr, env?)` | Tree-walk evaluator; lexical scope via immutable env extension |
| `run(input, env?)` | Convenience: `parse` + `evaluate` in one call |

```ts
import { Grammar, ParseError } from '@lapis-lang/pratt-parser';

// ── AST ──────────────────────────────────────────────────────────────────────
type Exp =
    | { kind: 'num';   value: number }
    | { kind: 'var';   name: string }
    | { kind: 'binop'; op: string; left: Exp; right: Exp }
    | { kind: 'unop';  op: string; operand: Exp }
    | { kind: 'let';   name: string; value: Exp; body: Exp };

// ── Abstract grammar: defines math operators, leaves semantics to subclasses ──
abstract class MathSemantics<T> extends Grammar<T> {
    constructor() {
        super();
        this.infix('+', 10, (l, r) => this.add(l, r));
        this.infix('-', 10, (l, r) => this.sub(l, r));
        this.infix('*', 20, (l, r) => this.mul(l, r));
        this.infix('/', 20, (l, r) => this.div(l, r));
        this.infixR('^', 30, (l, r) => this.pow(l, r));
        this.prefix('-', 100, (v) => this.neg(v));
        this.group('(', ')', Number.MAX_SAFE_INTEGER);
        this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1, (lit) => this.int(lit));
        this.skipWhile((ch) => ' \t\n\r'.includes(ch));
    }
    protected abstract int(lit: string): T;
    protected abstract add(l: T, r: T): T;
    protected abstract sub(l: T, r: T): T;
    protected abstract mul(l: T, r: T): T;
    protected abstract div(l: T, r: T): T;
    protected abstract pow(l: T, r: T): T;
    protected abstract neg(v: T): T;
}

// ── Compiler front-end: T = Exp ───────────────────────────────────────────────
class EquationParser extends MathSemantics<Exp> {
    constructor() {
        super();
        // Identifier scanner. Fixed symbols 'let'/'in' win on equal-length
        // ties, so keywords are never mis-lexed. Longer words like 'letter'
        // or 'inner' win via longest-match (more chars > keyword prefix).
        this.match(
            '(ident)',
            (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_',
            0,
            (name): Exp => ({ kind: 'var', name }),
        );
        // let <name> = <value> in <body>
        this.ternaryPrefix('let', '=', 'in', 90,
            (nameExp, value, body): Exp => {
                if (nameExp.kind !== 'var')
                    throw new ParseError('Expected identifier after let', 0, 1, 1);
                return { kind: 'let', name: nameExp.name, value, body };
            });
    }

    protected int(lit: string): Exp    { return { kind: 'num', value: parseInt(lit, 10) }; }
    protected add(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '+', left: l, right: r }; }
    protected sub(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '-', left: l, right: r }; }
    protected mul(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '*', left: l, right: r }; }
    protected div(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '/', left: l, right: r }; }
    protected pow(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '^', left: l, right: r }; }
    protected neg(v: Exp): Exp         { return { kind: 'unop',  op: '-', operand: v }; }

    // Tree-walk evaluator; lexical scope is handled here, not in the grammar.
    evaluate(expr: Exp, env: Map<string, number> = new Map()): number {
        switch (expr.kind) {
            case 'num':  return expr.value;
            case 'var':  {
                const v = env.get(expr.name);
                if (v === undefined) throw new ReferenceError(`Undefined: ${expr.name}`);
                return v;
            }
            case 'binop': {
                const l = this.evaluate(expr.left, env), r = this.evaluate(expr.right, env);
                if (expr.op === '+') return l + r;
                if (expr.op === '-') return l - r;
                if (expr.op === '*') return l * r;
                if (expr.op === '/') return l / r;
                return l ** r; // '^'
            }
            case 'unop':
                return expr.op === '-' ? -this.evaluate(expr.operand, env)
                                       :  this.evaluate(expr.operand, env);
            case 'let': {
                const val = this.evaluate(expr.value, env);
                // Extend the environment immutably — this is lexical scope.
                const inner = new Map(env);
                inner.set(expr.name, val);
                return this.evaluate(expr.body, inner);
            }
        }
    }

    // Convenience: parse + evaluate in one call.
    run(input: string, env: Map<string, number> = new Map()): number {
        return this.evaluate(this.parse(input), env);
    }
}

const parser = new EquationParser();

// Variable from an environment passed to run():
parser.run('pi * pi', new Map([['pi', 3]]));  // 9

// let-binding creates a new scope:
parser.run('let x = 5 in x * x');  // 25

// Nested let — both bindings visible in the body:
parser.run('let x = 2 in let y = 3 in x + y');  // 5

// Shadowing — outer x is unchanged outside the inner let:
parser.run('let x = 5 in (let x = 10 in x) + x');  // 15

// Two-step pipeline (parse once, evaluate many times with different envs):
const ast = parser.parse('a * a + b * b');
parser.evaluate(ast, new Map([['a', 3], ['b', 4]]));  // 25
```

**Keyword disambiguation** is automatic. `let` and `in` are registered as fixed-string symbols; the lexer's longest-match rule ensures `letter` (6 chars) or `inner` (5 chars) still lex as identifiers since they produce a longer match than the keyword prefix.

## References

- Vaughan R. Pratt — [*Top Down Operator Precedence*](https://doi.org/10.1145/512927.512931) (POPL 1973) — the original paper.
- Douglas Crockford — [*Top Down Operator Precedence*](http://crockford.com/javascript/tdop/tdop.html) — JavaScript implementation; chapter 9 of *Beautiful Code* (O'Reilly, 2007).
- Fredrik Lundh — [*Simple Top-Down Parsing in Python*](https://web.archive.org/web/20120303085035/http://effbot.org/zone/simple-top-down-parsing.htm) (2008) — clear exposition of the class-based token approach.
- Fredrik Lundh — [*Using Regular Expressions for Lexical Analysis*](https://web.archive.org/web/20120301002222/http://effbot.org/zone/xml-scanner.htm) (2002) — RE-based scanner techniques that informed the integrated lexer.
- Sandro Magi — [*Extensible, Statically Typed Pratt Parser in C#*](https://higherlogics.blogspot.com/2009/11/extensible-statically-typed-pratt.html) (2009) — the `Grammar<T>` / `MathSemantics<T>` class-based design this library directly mirrors.
- Sandro Magi — [*Sasa v0.9.3 Released*](https://higherlogics.blogspot.com/2010/12/sasa-v093-released.html) (2010) — updated Sasa library showcasing the abstract-grammar pattern.
