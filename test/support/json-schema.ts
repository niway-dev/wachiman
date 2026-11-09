// The validator lives in src/ because the engine admits verifier output with it; tests use the same one.
export { checkKeywords, validate } from "../../src/json-schema";
