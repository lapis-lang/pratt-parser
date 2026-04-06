import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Grammar, ParseError } from './Grammar.ts';

// ─── MathSemantics / MathInterpreter ─────────────────────────────────────────
// Mirrors Sasa's abstract-class-based design:
//   abstract class MathSemantics<T> : Grammar<T>
//   sealed class MathInterpreter : MathSemantics<int>

abstract class MathSemantics<T> extends Grammar<T> {
    constructor() {
        super();
        this.infix('+', 10, (l, r) => this.add(l, r));
        this.infix('-', 10, (l, r) => this.sub(l, r));
        this.infix('*', 20, (l, r) => this.mul(l, r));
        this.infix('/', 20, (l, r) => this.div(l, r));
        this.infixR('^', 30, (l, r) => this.pow(l, r));
        this.postfix('!', 30, (v) => this.fact(v));
        this.prefix('-', 100, (v) => this.neg(v));
        this.prefix('+', 100, (v) => this.pos(v));
        this.group('(', ')', Number.MAX_SAFE_INTEGER);
        this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1, (lit) => this.int(lit));
        this.skipWhile((ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r');
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
    protected int(lit: string): number { return parseInt(lit, 10); }
    protected add(l: number, r: number): number { return l + r; }
    protected sub(l: number, r: number): number { return l - r; }
    protected mul(l: number, r: number): number { return l * r; }
    protected div(l: number, r: number): number { return l / r; }
    protected pow(l: number, r: number): number { return Math.pow(l, r); }
    protected neg(v: number): number { return -v; }
    protected pos(v: number): number { return v; }
    protected fact(v: number): number {
        return v <= 1 ? 1 : v * this.fact(v - 1);
    }
}

// ─── AST types for the tree builder test ─────────────────────────────────────

type AstNode =
    | { kind: 'num'; value: number }
    | { kind: 'binop'; op: string; left: AstNode; right: AstNode }
    | { kind: 'unop'; op: string; operand: AstNode };

class AstBuilder extends Grammar<AstNode> {
    constructor() {
        super();
        const binop = (op: string) => (l: AstNode, r: AstNode): AstNode =>
            ({ kind: 'binop', op, left: l, right: r });
        const unop = (op: string) => (v: AstNode): AstNode =>
            ({ kind: 'unop', op, operand: v });

        this.infix('+', 10, binop('+'));
        this.infix('-', 10, binop('-'));
        this.infix('*', 20, binop('*'));
        this.infix('/', 20, binop('/'));
        this.infixR('^', 30, binop('^'));
        this.prefix('-', 100, unop('-'));
        this.group('(', ')', Number.MAX_SAFE_INTEGER);
        this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1,
            (lit) => ({ kind: 'num', value: parseInt(lit, 10) }));
        this.skipWhile((ch) => ch === ' ' || ch === '\t');
    }
}

// ─── Calculator tests ─────────────────────────────────────────────────────────

describe('MathInterpreter', () => {
    const calc = new MathInterpreter();

    it('parses a single integer', () => {
        assert.equal(calc.parse('3'), 3);
    });

    it('addition', () => {
        assert.equal(calc.parse('1+2'), 3);
    });

    it('respects precedence: 1+2*3 = 7', () => {
        assert.equal(calc.parse('1+2*3'), 7);
    });

    it('respects precedence: 1*2+3 = 5', () => {
        assert.equal(calc.parse('1*2+3'), 5);
    });

    it('subtraction', () => {
        assert.equal(calc.parse('10-3'), 7);
    });

    it('division', () => {
        assert.equal(calc.parse('8/4'), 2);
    });

    it('unary negation', () => {
        assert.equal(calc.parse('-5'), -5);
    });

    it('unary plus', () => {
        assert.equal(calc.parse('+5'), 5);
    });

    it('postfix factorial: 3! = 6', () => {
        assert.equal(calc.parse('3!'), 6);
    });

    it('postfix factorial: 5! = 120', () => {
        assert.equal(calc.parse('5!'), 120);
    });

    it('grouping: (1+2)*3 = 9', () => {
        assert.equal(calc.parse('(1+2)*3'), 9);
    });

    it('nested grouping: ((1+2))*3 = 9', () => {
        assert.equal(calc.parse('((1+2))*3'), 9);
    });

    it('right-associative exponentiation: 2^3^2 = 2^(3^2) = 512', () => {
        // 3^2 = 9, 2^9 = 512  (right-assoc)
        // (2^3)^2 = 64        (left-assoc, wrong)
        assert.equal(calc.parse('2^3^2'), 512);
    });

    it('ignores whitespace', () => {
        assert.equal(calc.parse(' 1 + 2 * 3 '), 7);
    });

    it('can be called multiple times on the same instance', () => {
        assert.equal(calc.parse('2+2'), 4);
        assert.equal(calc.parse('3*3'), 9);
    });
});

// ─── AST builder tests ────────────────────────────────────────────────────────

describe('AstBuilder', () => {
    const builder = new AstBuilder();

    it('builds a literal node', () => {
        assert.deepEqual(builder.parse('5'), { kind: 'num', value: 5 });
    });

    it('builds a tree for 1+2*3 respecting precedence', () => {
        const tree = builder.parse('1+2*3');
        // Expected: (+ 1 (* 2 3))
        assert.deepEqual(tree, {
            kind: 'binop',
            op: '+',
            left: { kind: 'num', value: 1 },
            right: {
                kind: 'binop',
                op: '*',
                left: { kind: 'num', value: 2 },
                right: { kind: 'num', value: 3 },
            },
        });
    });

    it('builds a right-associative tree for 2^3^2', () => {
        const tree = builder.parse('2^3^2');
        // Expected: (^ 2 (^ 3 2))
        assert.deepEqual(tree, {
            kind: 'binop',
            op: '^',
            left: { kind: 'num', value: 2 },
            right: {
                kind: 'binop',
                op: '^',
                left: { kind: 'num', value: 3 },
                right: { kind: 'num', value: 2 },
            },
        });
    });

    it('builds a unary node for -5', () => {
        assert.deepEqual(builder.parse('-5'), {
            kind: 'unop',
            op: '-',
            operand: { kind: 'num', value: 5 },
        });
    });
});

// ─── Error handling tests ─────────────────────────────────────────────────────

describe('ParseError', () => {
    const calc = new MathInterpreter();

    it('throws ParseError for unknown character', () => {
        assert.throws(() => calc.parse('1@2'), ParseError);
    });

    it('throws ParseError for mismatched grouping', () => {
        assert.throws(() => calc.parse('(1+2'), ParseError);
    });

    it('throws ParseError for trailing junk', () => {
        assert.throws(() => calc.parse('1+2)'), ParseError);
    });

    it('throws ParseError for empty input', () => {
        assert.throws(() => calc.parse(''), ParseError);
    });

    it('ParseError carries position info', () => {
        try {
            calc.parse('1@2');
            assert.fail('expected ParseError');
        } catch (e: unknown) {
            assert.ok(e instanceof ParseError);
            assert.equal(typeof e.position, 'number');
            assert.equal(typeof e.line, 'number');
            assert.equal(typeof e.column, 'number');
            assert.equal(e.position, 1); // '@' is at index 1
        }
    });
});

// ─── Ternary infix test ───────────────────────────────────────────────────────

describe('ternaryInfix', () => {
    class TernaryCalc extends Grammar<number> {
        constructor() {
            super();
            this.ternaryInfix('?', ':', 20,
                (cond, then, els) => cond !== 0 ? then : els);
            this.infix('+', 10, (l, r) => l + r);
            this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1,
                (lit) => parseInt(lit, 10));
            this.skipWhile((ch) => ch === ' ');
        }
    }

    const p = new TernaryCalc();

    it('evaluates true branch: 1 ? 2 : 3 => 2', () => {
        assert.equal(p.parse('1 ? 2 : 3'), 2);
    });

    it('evaluates false branch: 0 ? 2 : 3 => 3', () => {
        assert.equal(p.parse('0 ? 2 : 3'), 3);
    });
});

// ─── Ternary prefix test ──────────────────────────────────────────────────────

describe('ternaryPrefix', () => {
    // Simulates: "let <name> = <value> in <body>"
    // For simplicity, both name and values are single digits.
    // The action just adds bound value to body (+= style, not real scoping).
    class LetCalc extends Grammar<number> {
        constructor() {
            super();
            this.ternaryPrefix('let', '=', 'in', 90,
                (_name, value, body) => value + body);
            this.infix('+', 10, (l, r) => l + r);
            this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1,
                (lit) => parseInt(lit, 10));
            this.skipWhile((ch) => ch === ' ');
        }
    }

    const p = new LetCalc();

    it('parses a ternary-prefix expression', () => {
        // let 1 = 5 in 3  =>  5 + 3 = 8
        assert.equal(p.parse('let 1 = 5 in 3'), 8);
    });
});

// ─── Compilation example: EquationParser with variables and lexical scope ────
//
// Mirrors the `EquationParser : MathSemantics<Exp>` pattern from Sasa v0.9.3.
//
// Grammar<T> is generic, so MathSemantics<T> is simultaneously:
//   - MathInterpreter   (T = number) — direct evaluation, no AST
//   - EquationParser    (T = Exp)    — compilation: produces an AST
//
// EquationParser extends MathSemantics<Exp> and therefore Grammar<Exp>.
// It inherits `parse(input): Exp` from Grammar, and adds two methods of its own:
//   - evaluate(expr, env)  — tree-walk evaluator with lexical scope
//   - run(input, env)      — convenience: parse + evaluate in one call
//
// Lexical scope lives entirely inside `evaluate`, not the grammar, keeping
// the two concerns cleanly separate.

// AST node types ─────────────────────────────────────────────────────────────

type Exp =
    | { kind: 'num';   value: number }
    | { kind: 'var';   name: string }
    | { kind: 'binop'; op: string; left: Exp; right: Exp }
    | { kind: 'unop';  op: string; operand: Exp }
    | { kind: 'let';   name: string; value: Exp; body: Exp };

// EquationParser ─────────────────────────────────────────────────────────────

/**
 * Compilation grammar: extends MathSemantics<Exp> to add variable references
 * and let-bindings, producing Exp AST nodes instead of evaluating directly.
 *
 * Because Grammar<T> is generic, the same abstract grammar (MathSemantics<T>)
 * can be subtyped for any T:
 *   - MathInterpreter extends MathSemantics<number>  → direct interpreter
 *   - EquationParser  extends MathSemantics<Exp>     → compiler front-end
 *
 * The `evaluate` and `run` methods are added to this subclass, giving it
 * the full compiler pipeline: parse() → Exp → evaluate() → number.
 */
class EquationParser extends MathSemantics<Exp> {
    constructor() {
        super();
        // Variable references: any run of letters or underscores.
        // 'let' and 'in' are registered below as fixed symbols; they win on
        // equal-length ties, so keywords are never mis-lexed as identifiers.
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
                    throw new Error('Expected an identifier after let');
                return { kind: 'let', name: nameExp.name, value, body };
            });
    }

    // ── AST production (implements MathSemantics<Exp>) ────────────────────

    protected int(lit: string): Exp    { return { kind: 'num', value: parseInt(lit, 10) }; }
    protected add(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '+', left: l, right: r }; }
    protected sub(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '-', left: l, right: r }; }
    protected mul(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '*', left: l, right: r }; }
    protected div(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '/', left: l, right: r }; }
    protected pow(l: Exp, r: Exp): Exp { return { kind: 'binop', op: '^', left: l, right: r }; }
    protected neg(v: Exp): Exp         { return { kind: 'unop',  op: '-', operand: v }; }
    protected pos(v: Exp): Exp         { return v; }
    protected fact(v: Exp): Exp        { return { kind: 'unop',  op: '!', operand: v }; }

    // ── Evaluation (tree-walk with lexical scope) ─────────────────────────

    /**
     * Walk an `Exp` AST against a variable environment.
     * Lexical scope is achieved by extending `env` immutably on each
     * `let` node — the outer scope is never mutated.
     */
    evaluate(expr: Exp, env: Map<string, number> = new Map()): number {
        switch (expr.kind) {
            case 'num':
                return expr.value;

            case 'var': {
                const v = env.get(expr.name);
                if (v === undefined)
                    throw new ReferenceError(`Undefined variable: ${expr.name}`);
                return v;
            }

            case 'binop': {
                const l = this.evaluate(expr.left, env);
                const r = this.evaluate(expr.right, env);
                switch (expr.op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return l / r;
                    case '^': return l ** r;
                    default:  throw new Error(`Unknown binary operator: ${expr.op}`);
                }
            }

            case 'unop': {
                const v = this.evaluate(expr.operand, env);
                if (expr.op === '-') return -v;
                if (expr.op === '+') return v;
                // factorial
                let acc = 1;
                for (let i = 2; i <= v; i++) acc *= i;
                return acc;
            }

            case 'let': {
                const val = this.evaluate(expr.value, env);
                // Extend the environment immutably for the body scope.
                const inner = new Map(env);
                inner.set(expr.name, val);
                return this.evaluate(expr.body, inner);
            }
        }
    }

    /**
     * Convenience: parse `input` and immediately evaluate the resulting AST.
     * Equivalent to `this.evaluate(this.parse(input), env)`.
     */
    run(input: string, env: Map<string, number> = new Map()): number {
        return this.evaluate(this.parse(input), env);
    }
}

// Tests ──────────────────────────────────────────────────────────────────────

describe('EquationParser — compilation with variables and lexical scope', () => {
    const parser = new EquationParser();

    // ── AST structure (parse only) ─────────────────────────────────────────

    it('parses a variable reference to a Var node', () => {
        assert.deepEqual(parser.parse('x'), { kind: 'var', name: 'x' });
    });

    it('parses a multi-character variable name', () => {
        assert.deepEqual(parser.parse('foo'), { kind: 'var', name: 'foo' });
    });

    it('parses a let expression to a Let node', () => {
        assert.deepEqual(parser.parse('let x = 5 in x'), {
            kind: 'let',
            name: 'x',
            value: { kind: 'num', value: 5 },
            body:  { kind: 'var', name: 'x' },
        });
    });

    it('let body can be an expression using the bound name', () => {
        assert.deepEqual(parser.parse('let x = 3 in x * x'), {
            kind: 'let',
            name: 'x',
            value: { kind: 'num', value: 3 },
            body: {
                kind: 'binop', op: '*',
                left:  { kind: 'var', name: 'x' },
                right: { kind: 'var', name: 'x' },
            },
        });
    });

    // ── evaluate() — tree-walk with explicit AST ───────────────────────────

    it('evaluates a variable from the environment', () => {
        const ast = parser.parse('x + 1');
        assert.equal(parser.evaluate(ast, new Map([['x', 5]])), 6);
    });

    it('evaluate() with no env throws for unbound variable', () => {
        assert.throws(
            () => parser.evaluate(parser.parse('x')),
            ReferenceError,
        );
    });

    // ── run() — combined parse + evaluate ─────────────────────────────────

    it('run() evaluates a simple expression', () => {
        assert.equal(parser.run('1 + 2 * 3'), 7);
    });

    it('run() evaluates a variable from the environment', () => {
        assert.equal(parser.run('pi * pi', new Map([['pi', 3]])), 9);
    });

    it('run() let binding: body is evaluated with the new binding', () => {
        assert.equal(parser.run('let x = 5 in x'), 5);
    });

    it('run() let binding is visible throughout the body expression', () => {
        assert.equal(parser.run('let x = 3 in x * x'), 9);
    });

    it('run() nested let bindings accumulate in scope', () => {
        // let x = 2 in let y = 3 in x + y  =>  5
        assert.equal(parser.run('let x = 2 in let y = 3 in x + y'), 5);
    });

    it('run() inner let can reference the outer binding in its value', () => {
        // let x = 5 in let y = x + 1 in y  =>  6
        assert.equal(parser.run('let x = 5 in let y = x + 1 in y'), 6);
    });

    it('run() inner let shadows the outer binding', () => {
        // outer x = 5; inner x = 5+1 = 6; body = inner x = 6
        assert.equal(parser.run('let x = 5 in let x = x + 1 in x'), 6);
    });

    it('run() outer binding is unchanged after shadowing (static scope)', () => {
        // let x = 5 in (let x = 10 in x) + x  =>  10 + 5 = 15
        assert.equal(parser.run('let x = 5 in (let x = 10 in x) + x'), 15);
    });

    // ── Keyword disambiguation ─────────────────────────────────────────────

    it('keywords are not lexed as identifiers (let/in)', () => {
        assert.equal(parser.run('let x = 7 in x'), 7);
    });

    it('identifiers that start with a keyword prefix are lexed correctly', () => {
        // 'inner' (5 chars) beats fixed 'in' (2 chars) via longest-match.
        assert.equal(parser.run('let inner = 7 in inner'), 7);
    });

    it('identifiers that start with "let" prefix are lexed correctly', () => {
        // 'letter' (6 chars) beats fixed 'let' (3 chars) via longest-match.
        assert.equal(parser.run('let letter = 4 in letter'), 4);
    });

    // ── Mixing compilation features ────────────────────────────────────────

    it('arithmetic operators work with variable operands', () => {
        assert.equal(parser.run('a * a + b * b', new Map([['a', 3], ['b', 4]])), 25);
    });

    it('let with arithmetic in value and body', () => {
        assert.equal(parser.run('let r = 3 in r ^ 2'), 9);
    });

    it('right-associative exponentiation works with variables', () => {
        // n ^ n ^ n  =>  n^(n^n) = 2^(2^2) = 2^4 = 16
        assert.equal(parser.run('n ^ n ^ n', new Map([['n', 2]])), 16);
    });
});

