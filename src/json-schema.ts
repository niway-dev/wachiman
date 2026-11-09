/**
 * A JSON Schema validator for exactly the keywords `docs/formats/` uses (zero dependencies, ADR
 * 0002). Any other keyword throws, so a schema cannot rely on something this validator ignores.
 */
type Schema = Record<string, unknown>;

const CHECKED = new Set([
  "type",
  "const",
  "enum",
  "minimum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "oneOf",
  "$ref",
]);
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "$defs"]);

function typeOf(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function hasType(value: unknown, type: string) {
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeOf(value) === type;
}

/** Throws when any sub-schema, reached or not by a value, uses a keyword `validate` does not check. */
export function checkKeywords(schema: Schema, path = "$"): void {
  for (const key of Object.keys(schema)) {
    if (!CHECKED.has(key) && !ANNOTATIONS.has(key)) throw new Error(`${path}: the validator does not check "${key}"`);
  }
  const children: [string, Schema][] = [
    ...Object.entries((schema.properties ?? {}) as Record<string, Schema>).map(([k, v]): [string, Schema] => [`${path}.properties.${k}`, v]),
    ...Object.entries((schema.$defs ?? {}) as Record<string, Schema>).map(([k, v]): [string, Schema] => [`${path}.$defs.${k}`, v]),
    ...((schema.oneOf ?? []) as Schema[]).map((v, i): [string, Schema] => [`${path}.oneOf[${i}]`, v]),
    ...(schema.items ? [[`${path}.items`, schema.items as Schema] as [string, Schema]] : []),
  ];
  for (const [p, child] of children) checkKeywords(child, p);
}

/**
 * The problems found, as `path: message`; empty when `value` is valid. A property whose value is
 * `undefined` counts as absent, as it does once the value is written as JSON.
 */
export function validate(schema: Schema, value: unknown, rootSchema: Schema = schema, path = "$"): string[] {
  for (const key of Object.keys(schema)) {
    if (!CHECKED.has(key) && !ANNOTATIONS.has(key)) throw new Error(`${path}: the validator does not check "${key}"`);
  }
  if (typeof schema.$ref === "string") {
    const m = schema.$ref.match(/^#\/\$defs\/([^/]+)$/);
    const target = m ? (rootSchema.$defs as Record<string, Schema> | undefined)?.[m[1]] : undefined;
    if (!target) throw new Error(`${path}: unresolvable $ref ${schema.$ref}`);
    return validate(target, value, rootSchema, path);
  }
  const problems: string[] = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => hasType(value, t))) return [`${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`];
  }
  if ("const" in schema && value !== schema.const) problems.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    problems.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof schema.minimum === "number" && typeof value === "number" && value < schema.minimum) {
    problems.push(`${path}: ${value} is below ${schema.minimum}`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matching = (schema.oneOf as Schema[]).filter((s) => validate(s, value, rootSchema, path).length === 0).length;
    if (matching !== 1) problems.push(`${path}: matches ${matching} of oneOf, expected exactly 1`);
  }
  if (typeOf(value) === "array" && schema.items) {
    (value as unknown[]).forEach((item, i) => {
      problems.push(...validate(schema.items as Schema, item, rootSchema, `${path}[${i}]`));
    });
  }
  if (typeOf(value) === "object") {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required ?? []) as string[]) {
      if (object[name] === undefined) problems.push(`${path}: missing required "${name}"`);
    }
    for (const [name, item] of Object.entries(object)) {
      if (item === undefined) continue;
      if (properties[name]) problems.push(...validate(properties[name], item, rootSchema, `${path}.${name}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: unexpected property "${name}"`);
    }
  }
  return problems;
}
