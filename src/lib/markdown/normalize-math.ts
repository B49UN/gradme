export function normalizeMathDelimiters(content: string) {
  return content
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\((.+?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}
