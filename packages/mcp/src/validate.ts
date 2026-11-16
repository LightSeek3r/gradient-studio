// A small validator for the JSON Schema subset the tool schemas use. The SDK
// validates arguments too (and rejects with isError); the handlers validate
// again so that they stay safe when called without the SDK (a Worker, tests).
// Pure, never throws.

export interface JsonSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  default?: unknown;
  title?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Makes JSON text inert if a client shows it as HTML: `<`, `>` and `&` become
 * `\u003c`, `\u003e` and `\u0026`, which every JSON parser reads back as the
 * same characters.
 */
export function htmlSafe(json: string): string {
  return json.replace(/[<>&]/g, (c) => `\\u00${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** Cuts a user-supplied string for use inside a message (quoted, HTML-inert). */
export function excerpt(value: string, max = 60): string {
  const flat = value.replace(/\p{Cc}+/gu, " ");
  return htmlSafe(JSON.stringify(flat.length > max ? `${flat.slice(0, max)}...` : flat));
}

/**
 * The first problem found, as `path: message`, or null when `value` conforms.
 * Unknown properties are rejected where `additionalProperties` is false.
 */
export function validate(schema: JsonSchema, value: unknown, path = "arguments"): string | null {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return `${path}: expected a string`;
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return `${path}: must have at least ${schema.minLength} character(s)`;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `${path}: too long (${value.length} characters, the limit is ${schema.maxLength})`;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return `${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`;
      }
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path}: expected a finite number`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${path}: expected an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path}: must be at least ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path}: must be at most ${schema.maximum}`;
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${path}: expected a boolean`;
    case "array": {
      if (!Array.isArray(value)) return `${path}: expected an array`;
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return `${path}: needs at least ${schema.minItems} item(s)`;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return `${path}: too many items (${value.length}, the limit is ${schema.maxItems})`;
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const problem = validate(schema.items, value[i], `${path}[${i}]`);
          if (problem) return problem;
        }
      }
      return null;
    }
    case "object": {
      if (!isPlainObject(value)) return `${path}: expected an object`;
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) return `${path}: missing required property "${key}"`;
      }
      const props = schema.properties ?? {};
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(props, key)) {
          if (schema.additionalProperties === false) return `${path}: unknown property ${excerpt(key, 40)}`;
          continue;
        }
        if (value[key] === undefined) continue;
        const problem = validate(props[key], value[key], path === "arguments" ? key : `${path}.${key}`);
        if (problem) return problem;
      }
      return null;
    }
    default:
      return null;
  }
}
