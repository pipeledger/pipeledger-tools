/**
 * Commander option parsers for numeric flags.
 *
 * Registered as the option's parser so commander validates at parse time and
 * prints a local message. Without one, `--limit abc` becomes NaN, serializes
 * to `null` in the request body, and the terminal shows a server 400 for a
 * mistake the CLI could name precisely and for free.
 *
 * Same shape as `parseOutputFormat`: throw `InvalidArgumentError` and let
 * commander render it.
 */
import { InvalidArgumentError } from "commander";

export function parseBoundedInteger(
  value: string,
  bounds: { name: string; min: number; max: number }
): number {
  // Number.parseInt("10abc") is 10, which would silently accept a typo.
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError(
      `${bounds.name} must be a whole number between ${bounds.min} and ${bounds.max}. Received "${value}".`
    );
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < bounds.min || parsed > bounds.max) {
    throw new InvalidArgumentError(
      `${bounds.name} must be between ${bounds.min} and ${bounds.max}. Received ${parsed}.`
    );
  }
  return parsed;
}

/** `--limit` on a governed read. The server enforces the same ceiling. */
export function parseLimitOption(value: string): number {
  return parseBoundedInteger(value, { name: "--limit", min: 1, max: 100 });
}
