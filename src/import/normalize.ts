const COMBINING_MARKS = /\p{M}+/gu;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;

export function foldText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[’`´]/g, "'")
    .toLocaleLowerCase("fr")
    .trim();
}

export function normalizeLookup(value: string): string {
  return foldText(value).replace(NON_ALPHANUMERIC, "");
}

export function normalizeWords(value: string): string {
  return foldText(value).replace(NON_ALPHANUMERIC, " ").trim().replace(/\s+/g, " ");
}

export function isNullToken(value: string): boolean {
  return value.trim().toLocaleLowerCase("fr") === "null";
}

export function sourceId(kind: "perk" | "killer" | "description", line: number): string {
  return `${kind}-source-${String(line).padStart(4, "0")}`;
}

export function splitTopLevel(value: string, separator = ","): string[] {
  const parts: string[] = [];
  const stack: string[] = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "[" || character === "(") {
      stack.push(character);
    } else if (character === "]" || character === ")") {
      const expected = character === "]" ? "[" : "(";
      if (stack.at(-1) === expected) {
        stack.pop();
      }
    } else if (character === separator && stack.length === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}
