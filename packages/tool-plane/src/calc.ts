type Token = { kind: 'number'; value: number } | { kind: 'op' | 'paren'; value: string };

const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const number = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }

    if ('+-*/^'.includes(char)) tokens.push({ kind: 'op', value: char });
    else if ('()'.includes(char)) tokens.push({ kind: 'paren', value: char });
    else throw new Error(`Invalid token at ${index}`);
    index += 1;
  }

  return tokens;
}

export function calculate(expression: string): number {
  const output: Token[] = [];
  const ops: string[] = [];

  for (const token of tokenize(expression)) {
    if (token.kind === 'number') {
      output.push(token);
      continue;
    }

    if (token.value === '(') {
      ops.push(token.value);
      continue;
    }

    if (token.value === ')') {
      while (ops.length > 0 && ops.at(-1) !== '(') output.push({ kind: 'op', value: ops.pop()! });
      if (ops.pop() !== '(') throw new Error('Mismatched parentheses');
      continue;
    }

    while (ops.length > 0 && ops.at(-1) !== '(') {
      const top = ops.at(-1)!;
      const isRightAssociative = token.value === '^';
      if (precedence[top]! > precedence[token.value]! || (!isRightAssociative && precedence[top] === precedence[token.value])) {
        output.push({ kind: 'op', value: ops.pop()! });
      } else break;
    }
    ops.push(token.value);
  }

  while (ops.length > 0) {
    const op = ops.pop()!;
    if (op === '(') throw new Error('Mismatched parentheses');
    output.push({ kind: 'op', value: op });
  }

  const stack: number[] = [];
  for (const token of output) {
    if (token.kind === 'number') {
      stack.push(token.value);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error('Invalid expression');
    const value = token.value === '+' ? a + b : token.value === '-' ? a - b : token.value === '*' ? a * b : token.value === '/' ? a / b : a ** b;
    if (!Number.isFinite(value)) throw new Error('Non-finite result');
    stack.push(value);
  }

  if (stack.length !== 1) throw new Error('Invalid expression');
  return stack[0]!;
}
