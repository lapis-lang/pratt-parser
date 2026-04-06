/**
 * Internal token representation produced by the integrated lexer.
 */
interface Token {
    readonly id: string;
    readonly value: string;
    readonly pos: number;
}

/**
 * A scanner function attempts to match a token starting at `pos` in `input`.
 * Returns the end position (exclusive) of the match, or `pos` if no match.
 */
type Scanner = (input: string, pos: number) => number;

/**
 * Internal symbol definition stored in the symbol table.
 */
interface SymbolDef<T> {
    readonly id: string;
    lbp: number;
    /**
     * Null denotation: called when this token appears at the start of an
     * expression (prefix position). Receives the parsing context.
     */
    nud?: (ctx: ParseContext<T>) => T;
    /**
     * Left denotation: called when this token appears in infix/suffix position.
     * Receives the parsing context and the already-parsed left operand.
     */
    led?: (ctx: ParseContext<T>, left: T) => T;
    /** Optional custom scanner for predicate-based tokens (e.g. digits, identifiers). */
    scanner?: Scanner;
    /** Tie-breaking priority for the longest-match lexer. */
    priority: number;
}

/**
 * The parsing context passed into every `nud` and `led` handler.
 * Exposes the minimal surface area needed for recursive parsing.
 */
interface ParseContext<T> {
    /**
     * The token that was just consumed (the one whose nud/led is being called).
     */
    readonly token: Token;
    /**
     * Parse an expression with the given right-binding power.
     * The core of the Pratt algorithm — call this recursively from nud/led.
     */
    expression(rbp: number): T;
    /**
     * Consume the current lookahead token, optionally asserting its id first.
     * Throws `ParseError` if `expected` is provided and the current token doesn't match.
     */
    advance(expected?: string): Token;
    /**
     * The current lookahead token (not yet consumed).
     */
    readonly current: Token;
}

// ─── ParseError ──────────────────────────────────────────────────────────────

/**
 * Thrown when the parser encounters a syntax error in the input.
 */
export class ParseError extends Error {
    /** Zero-based character offset in the input string. */
    readonly position: number;
    /** One-based line number. */
    readonly line: number;
    /** One-based column number. */
    readonly column: number;

    constructor(message: string, position: number, line: number, column: number) {
        super(`${message} (line ${line}, col ${column})`);
        this.name = 'ParseError';
        this.position = position;
        this.line = line;
        this.column = column;
    }
}

/** Compute line/column from a flat offset into the source string. */
function positionToLineCol(input: string, pos: number): { line: number; column: number } {
    let line = 1;
    let column = 1;
    for (let i = 0; i < pos && i < input.length; i++) {
        if (input[i] === '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { line, column };
}

// ─── Grammar ─────────────────────────────────────────────────────────────────

const END_ID = '(end)';

/**
 * Abstract base class for Pratt (top-down operator precedence) parsers.
 *
 * Subclass and call the protected helper methods (`infix`, `prefix`, `match`,
 * etc.) from your constructor to build up the grammar's symbol table.
 * Then call `parse(input)` to parse a string into a value of type `T`.
 *
 * The grammar definition drives an integrated longest-match priority-based
 * lexer. No separate tokenisation step is required.
 *
 * @typeParam T - The type produced by parsing (e.g. `number` for an
 *   interpreter, or an AST node union for a compiler front-end).
 *
 * @example
 * ```ts
 * abstract class MathSemantics<T> extends Grammar<T> {
 *   constructor() {
 *     super();
 *     this.infix('+', 10, (l, r) => this.add(l, r));
 *     this.infix('-', 10, (l, r) => this.sub(l, r));
 *     this.infix('*', 20, (l, r) => this.mul(l, r));
 *     this.infix('/', 20, (l, r) => this.div(l, r));
 *     this.infixR('^', 30, (l, r) => this.pow(l, r));
 *     this.postfix('!', 30, (v) => this.fact(v));
 *     this.prefix('-', 100, (v) => this.neg(v));
 *     this.prefix('+', 100, (v) => this.pos(v));
 *     this.group('(', ')', Number.MAX_SAFE_INTEGER);
 *     this.match('(digit)', (ch) => ch >= '0' && ch <= '9', 1,
 *                (lit) => this.int(lit));
 *     this.skipWhile((ch) => ch === ' ' || ch === '\t' || ch === '\n');
 *   }
 *   protected abstract int(lit: string): T;
 *   protected abstract add(l: T, r: T): T;
 *   // …
 * }
 * ```
 */
export abstract class Grammar<T> {
    /** The symbol table: maps token id → symbol definition. */
    readonly #symbols = new Map<string, SymbolDef<T>>();

    /** Predicate-based scanners registered via `match()`. */
    readonly #matchers: Array<{
        id: string;
        predicate: (ch: string) => boolean;
        priority: number;
        action: (literal: string) => T;
    }> = [];

    /** Optional predicate for characters to skip between tokens. */
    #skipPredicate: ((ch: string) => boolean) | null = null;

    constructor() {
        // Register the end-of-input sentinel.
        this.#define(END_ID, 0);
    }

    // ─── Symbol Table ─────────────────────────────────────────────────────

    /** Ensure a symbol exists; update lbp if the new value is higher. */
    #define(id: string, lbp: number, priority = 0): SymbolDef<T> {
        const existing = this.#symbols.get(id);
        if (existing !== undefined) {
            if (lbp > existing.lbp) existing.lbp = lbp;
            if (priority > existing.priority) existing.priority = priority;
            return existing;
        }
        const sym: SymbolDef<T> = { id, lbp, priority };
        this.#symbols.set(id, sym);
        return sym;
    }

    // ─── Integrated Lexer ─────────────────────────────────────────────────

    /** Skip characters matched by the skip predicate. Returns updated position. */
    #skip(input: string, pos: number): number {
        if (this.#skipPredicate === null) return pos;
        while (pos < input.length && this.#skipPredicate(input[pos]!)) pos++;
        return pos;
    }

    /** Scan the next token from `input` starting at `pos`. */
    #nextToken(input: string, pos: number): Token {
        pos = this.#skip(input, pos);

        if (pos >= input.length) {
            return { id: END_ID, value: '', pos };
        }

        let bestId = '';
        let bestValue = '';
        let bestEnd = pos;
        let bestPriority = -1;

        // Try every fixed-string symbol.
        for (const sym of this.#symbols.values()) {
            if (sym.id === END_ID) continue;
            // Fixed-string symbols have no custom scanner; match literally.
            if (sym.scanner === undefined) {
                const end = pos + sym.id.length;
                if (
                    end > bestEnd ||
                    (end === bestEnd && sym.priority > bestPriority)
                ) {
                    if (input.startsWith(sym.id, pos)) {
                        bestEnd = end;
                        bestId = sym.id;
                        bestValue = sym.id;
                        bestPriority = sym.priority;
                    }
                }
            } else {
                // Custom scanner (currently unused for fixed symbols — reserved for future use).
                const end = sym.scanner(input, pos);
                if (
                    end > bestEnd ||
                    (end === bestEnd && sym.priority > bestPriority)
                ) {
                    bestEnd = end;
                    bestId = sym.id;
                    bestValue = input.slice(pos, end);
                    bestPriority = sym.priority;
                }
            }
        }

        // Try predicate-based matchers (registered via `match()`).
        for (const m of this.#matchers) {
            let end = pos;
            while (end < input.length && m.predicate(input[end]!)) end++;
            if (end > pos) {
                if (
                    end > bestEnd ||
                    (end === bestEnd && m.priority > bestPriority)
                ) {
                    bestEnd = end;
                    bestId = m.id;
                    bestValue = input.slice(pos, end);
                    bestPriority = m.priority;
                }
            }
        }

        if (bestEnd === pos) {
            const { line, column } = positionToLineCol(input, pos);
            throw new ParseError(
                `Unexpected character ${JSON.stringify(input[pos])}`,
                pos,
                line,
                column,
            );
        }

        return { id: bestId, value: bestValue, pos };
    }

    // ─── Pratt Core ───────────────────────────────────────────────────────

    /**
     * Parse `input` and return the result of type `T`.
     * Throws `ParseError` on any syntax error.
     */
    parse(input: string): T {
        // Lexer state — captured in closure so parse() is re-entrant.
        let pos = 0;
        let current: Token = this.#nextToken(input, pos);

        const advance = (expected?: string): Token => {
            if (expected !== undefined && current.id !== expected) {
                const { line, column } = positionToLineCol(input, current.pos);
                throw new ParseError(
                    `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(current.id)}`,
                    current.pos,
                    line,
                    column,
                );
            }
            const consumed = current;
            pos = consumed.pos + consumed.value.length;
            current = this.#nextToken(input, pos);
            return consumed;
        };

        const expression = (rbp: number): T => {
            const t = current;
            advance();
            const sym = this.#symbols.get(t.id);

            // Check for predicate-match nud.
            const nudFn = sym?.nud ?? this.#findMatcherNud(t);

            if (nudFn === undefined) {
                const { line, column } = positionToLineCol(input, t.pos);
                throw new ParseError(
                    `Unexpected token ${JSON.stringify(t.id)}`,
                    t.pos,
                    line,
                    column,
                );
            }

            const ctx: ParseContext<T> = {
                token: t,
                expression,
                advance,
                get current() { return current; },
            };

            let left = nudFn(ctx);

            while (rbp < (this.#symbols.get(current.id)?.lbp ?? 0)) {
                const op = current;
                advance();
                const opSym = this.#symbols.get(op.id);
                if (opSym?.led === undefined) {
                    const { line, column } = positionToLineCol(input, op.pos);
                    throw new ParseError(
                        `Unexpected token ${JSON.stringify(op.id)} in infix position`,
                        op.pos,
                        line,
                        column,
                    );
                }
                const opCtx: ParseContext<T> = {
                    token: op,
                    expression,
                    advance,
                    get current() { return current; },
                };
                left = opSym.led(opCtx, left);
            }

            return left;
        };

        const result = expression(0);

        if (current.id !== END_ID) {
            const { line, column } = positionToLineCol(input, current.pos);
            throw new ParseError(
                `Unexpected token ${JSON.stringify(current.id)} after expression`,
                current.pos,
                line,
                column,
            );
        }

        return result;
    }

    /**
     * For predicate-matched tokens (e.g. digits), the nud is stored on the
     * matcher rather than in the symbol table. Look it up here.
     */
    #findMatcherNud(
        token: Token,
    ): ((ctx: ParseContext<T>) => T) | undefined {
        for (const m of this.#matchers) {
            if (m.id === token.id) {
                const action = m.action;
                return (ctx: ParseContext<T>) => action(ctx.token.value);
            }
        }
        return undefined;
    }

    // ─── Grammar Definition Helpers ───────────────────────────────────────

    /**
     * Register a bare symbol so the lexer can recognise it as a token
     * (e.g. separator tokens used inside compound operators).
     */
    protected symbol(id: string): void {
        this.#define(id, 0);
    }

    /**
     * Register a predicate-based token scanner.
     *
     * At each lexer position, characters are consumed while `predicate(ch)` is
     * true. The resulting literal string is passed to `action` when the token
     * is parsed in null-denotation (prefix) position.
     *
     * Fixed-string symbols that match the same characters beat a matcher only
     * when they produce a longer match or have higher priority.
     *
     * @param id        - Unique token id (use a parenthesised name, e.g. `"(digit)"`).
     * @param predicate - Returns `true` for each character belonging to this token.
     * @param priority  - Tie-breaking priority (higher wins over equal-length matches).
     * @param action    - Transforms the matched string into a value of type `T`.
     */
    protected match(
        id: string,
        predicate: (ch: string) => boolean,
        priority: number,
        action: (literal: string) => T,
    ): void {
        // Register in symbol table so the parser recognises the id, but nud
        // is handled via #findMatcherNud rather than stored on the symbol.
        this.#define(id, 0, priority);
        this.#matchers.push({ id, predicate, priority, action });
    }

    /**
     * Set the predicate used to skip characters between tokens (e.g. whitespace).
     */
    protected skipWhile(predicate: (ch: string) => boolean): void {
        this.#skipPredicate = predicate;
    }

    /**
     * Register a left-associative infix operator.
     *
     * `action(left, right)` is passed the left and right operands.
     */
    protected infix(
        id: string,
        bp: number,
        action: (left: T, right: T) => T,
    ): void {
        const sym = this.#define(id, bp);
        sym.led = (ctx, left) => {
            const right = ctx.expression(bp);
            return action(left, right);
        };
    }

    /**
     * Register a right-associative infix operator.
     *
     * `action(left, right)` is passed the left and right operands.
     * Right-associativity is achieved by recursing with `bp - 1`.
     */
    protected infixR(
        id: string,
        bp: number,
        action: (left: T, right: T) => T,
    ): void {
        const sym = this.#define(id, bp);
        sym.led = (ctx, left) => {
            const right = ctx.expression(bp - 1);
            return action(left, right);
        };
    }

    /**
     * Register a unary prefix operator.
     *
     * `action(operand)` receives the parsed right-hand operand.
     */
    protected prefix(
        id: string,
        bp: number,
        action: (operand: T) => T,
    ): void {
        const sym = this.#define(id, 0);
        sym.nud = (ctx) => {
            const operand = ctx.expression(bp);
            return action(operand);
        };
    }

    /**
     * Register a unary postfix operator.
     *
     * `action(operand)` receives the already-parsed left operand.
     */
    protected postfix(
        id: string,
        bp: number,
        action: (operand: T) => T,
    ): void {
        const sym = this.#define(id, bp);
        sym.led = (_ctx, left) => action(left);
    }

    /**
     * Register a grouping construct (e.g. parentheses).
     *
     * When `open` appears in prefix position its `nud` parses a full
     * expression then consumes `close`. The grouping tokens themselves do
     * not appear in the parse result.
     *
     * @param open  - Opening delimiter, e.g. `"("`.
     * @param close - Closing delimiter, e.g. `")"`.
     * @param bp    - Binding power of the open token (use `Number.MAX_SAFE_INTEGER`
     *               or a large number so grouped expressions bind tightly).
     */
    protected group(open: string, close: string, bp: number): void {
        this.#define(close, 0);
        const sym = this.#define(open, bp);
        sym.nud = (ctx) => {
            const val = ctx.expression(0);
            ctx.advance(close);
            return val;
        };
    }

    /**
     * Register a prefix ternary operator of the form `first a second b third c`.
     *
     * For example, `let x = expr in body` with
     * `ternaryPrefix('let', '=', 'in', 90, action)`.
     */
    protected ternaryPrefix(
        first: string,
        second: string,
        third: string,
        bp: number,
        action: (a: T, b: T, c: T) => T,
    ): void {
        this.#define(second, 0);
        this.#define(third, 0);
        const sym = this.#define(first, 0);
        sym.nud = (ctx) => {
            const a = ctx.expression(bp);
            ctx.advance(second);
            const b = ctx.expression(0);
            ctx.advance(third);
            const c = ctx.expression(0);
            return action(a, b, c);
        };
    }

    /**
     * Register an infix ternary operator of the form `a first b second c`.
     *
     * For example, C's `cond ? then : else` with
     * `ternaryInfix('?', ':', 20, action)`.
     */
    protected ternaryInfix(
        first: string,
        second: string,
        bp: number,
        action: (cond: T, then: T, els: T) => T,
    ): void {
        this.#define(second, 0);
        const sym = this.#define(first, bp);
        sym.led = (ctx, left) => {
            const thenVal = ctx.expression(0);
            ctx.advance(second);
            const elseVal = ctx.expression(0);
            return action(left, thenVal, elseVal);
        };
    }
}
