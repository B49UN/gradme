import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAuthors(authors: string[]) {
  if (authors.length === 0) {
    return "저자 미상";
  }

  if (authors.length === 1) {
    return authors[0];
  }

  if (authors.length === 2) {
    return `${authors[0]} · ${authors[1]}`;
  }

  return `${authors[0]} 외 ${authors.length - 1}명`;
}

export function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

export function formatDateTime(isoLike: string | null | undefined) {
  if (!isoLike) {
    return "-";
  }

  const date = new Date(isoLike);

  if (Number.isNaN(date.getTime())) {
    return isoLike;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function stableStringify(value: unknown) {
  return JSON.stringify(value, (_key, currentValue) => {
    if (
      currentValue &&
      typeof currentValue === "object" &&
      !Array.isArray(currentValue)
    ) {
      return Object.keys(currentValue as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((accumulator, key) => {
          accumulator[key] = (currentValue as Record<string, unknown>)[key];
          return accumulator;
        }, {});
    }

    return currentValue;
  });
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}
