import { describe, expect, test } from "bun:test";
import { classifyProviderError } from "./errors";

const CREDIT =
  'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

describe("classifyProviderError", () => {
  test("the realistic no-credit message is billing", () => {
    expect(classifyProviderError(CREDIT)).toBe("billing");
  });

  test.each([
    "You have reached your usage limit",
    "Your workspace hit its spend limit for this month",
    "Please check your billing details",
    "Purchase credits to continue",
  ])("billing: %s", (text) => {
    expect(classifyProviderError(text)).toBe("billing");
  });

  test.each([
    'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    "Invalid API key · Please run /login",
    'API Error: 403 {"error":{"type":"permission_error","message":"nope"}}',
    "request failed with status 401",
    "HTTP 403 Forbidden",
  ])("auth: %s", (text) => {
    expect(classifyProviderError(text)).toBe("auth");
  });

  test.each([
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
    "Rate limit reached for requests",
    '{"error":{"type":"overloaded_error","message":"Overloaded"}}',
    "API Error: 529 overloaded",
  ])("rate_limit: %s", (text) => {
    expect(classifyProviderError(text)).toBe("rate_limit");
  });

  test("is case-insensitive", () => {
    expect(classifyProviderError("CREDIT BALANCE IS TOO LOW")).toBe("billing");
  });

  test("anything else, including a bare number inside other text, is other", () => {
    expect(classifyProviderError("Unexpected end of JSON input")).toBe("other");
    expect(classifyProviderError("")).toBe("other");
    expect(classifyProviderError("processed 4012 files in 4290 ms, line 4031 of 401")).toBe("other");
    expect(classifyProviderError("API Error: 500 internal server error")).toBe("other");
  });
});
