import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveCountryFlags } from "../src/services/countryFlags";

const APPROVED_ASSET_CODES = [
  "ar",
  "at",
  "au",
  "bd",
  "be",
  "br",
  "ca",
  "ch",
  "cn",
  "cz",
  "de",
  "dk",
  "eg",
  "es",
  "fi",
  "fr",
  "gb",
  "gr",
  "hk",
  "hu",
  "id",
  "ie",
  "in",
  "ir",
  "it",
  "jp",
  "kr",
  "mx",
  "my",
  "ng",
  "nl",
  "no",
  "nz",
  "ph",
  "pk",
  "pl",
  "pt",
  "ro",
  "ru",
  "se",
  "sg",
  "th",
  "tr",
  "tw",
  "ua",
  "us",
  "vn",
  "za",
] as const;

const codes = (value?: string) => resolveCountryFlags(value).map((flag) => flag.code);

test.each(["US", "U.S.", "USA", "U.S.A.", "United States", "United States of America"])(
  "%s resolves to the canonical accessible United States flag",
  (value) => {
    expect(resolveCountryFlags(value)).toMatchObject([{ code: "us", name: "United States" }]);
    expect(resolveCountryFlags(value)[0]).toBe(resolveCountryFlags("us")[0]);
  },
);

test.each([
  ["it", "it", "Italy"],
  ["ITA", "it", "Italy"],
  ["Italy", "it", "Italy"],
  ["dEu", "de", "Germany"],
  ["sOuTh KoReA", "kr", "South Korea"],
  ["nz", "nz", "New Zealand"],
  ["ZAF", "za", "South Africa"],
])("ISO codes and canonical names resolve exactly for %s", (value, code, name) => {
  expect(resolveCountryFlags(value)).toMatchObject([{ code, name }]);
});

test.each([
  [" \tUnItEd \n States  ", "us"],
  ["United-States", "us"],
  ["United_States", "us"],
  ["(U.S.A.)", "us"],
  ["U'S'A", "us"],
  ["U\u2019S\u2019A", "us"],
  ["\uff35\uff33", "us"],
  ["T\u00fcrkiye", "tr"],
  ["Tu\u0308rkiye", "tr"],
])("normalization preserves exact country identity for %s", (value, code) => {
  expect(codes(value)).toEqual([code]);
});

test.each([
  ["UK", "gb"],
  ["United Kingdom of Great Britain and Northern Ireland", "gb"],
  ["The Netherlands", "nl"],
  ["Czech Republic", "cz"],
  ["Turkiye", "tr"],
  ["Russian Federation", "ru"],
  ["Iran, Islamic Republic of", "ir"],
  ["Iran (Islamic Republic of)", "ir"],
  ["Republic of Korea", "kr"],
  ["Korea, Republic of", "kr"],
  ["Taiwan, Province of China", "tw"],
  ["Viet Nam", "vn"],
])("reviewed alias %s retains its canonical flag", (value, code) => {
  expect(codes(value)).toEqual([code]);
});

test("whole comma and conjunction names take precedence within primary chunks", () => {
  expect(
    codes("Korea, Republic of; United Kingdom of Great Britain and Northern Ireland | Italy"),
  ).toEqual(["kr", "gb", "it"]);
  expect(codes("Iran, Islamic Republic of / Taiwan, Province of China + Canada")).toEqual([
    "ir",
    "tw",
    "ca",
  ]);
});

test("explicit lists retain known entries while omitting unknown and ambiguous segments", () => {
  expect(codes("Canada / Atlantis; US | Italy & Japan + France")).toEqual([
    "ca",
    "us",
    "it",
    "jp",
    "fr",
  ]);
  expect(codes("Italy, Korea AND Canada and Unknown")).toEqual(["it", "ca"]);
  expect(codes("US; England; UK; America; Korea; South Korea; Congo")).toEqual([
    "us",
    "gb",
    "kr",
  ]);
});

test("deduplication retains provider order and limits the result to six distinct flags", () => {
  expect(codes("Italy; US; ITA; Canada; United States of America; ca")).toEqual([
    "it",
    "us",
    "ca",
  ]);
  expect(codes("Japan; Italy; JPN; US; Canada; Brazil; Germany; UK; France")).toEqual([
    "jp",
    "it",
    "us",
    "ca",
    "br",
    "de",
  ]);
});

test.each([
  undefined,
  "",
  " \t\n ",
  "Atlantis",
  "England",
  "Scotland",
  "America",
  "Congo",
  "Korea",
  "EU",
  "Chile",
  "CL",
  "North Korea",
  "United States?",
  "United States Minor Outlying Islands",
  "U\u0405",
  "US\u0410",
  "\u6771US",
])("unknown, ambiguous or unsupported value %s produces no flag", (value) => {
  expect(codes(value)).toEqual([]);
});

test("the complete field is rejected above 512 characters without truncation", () => {
  const atLimit = "US" + " ".repeat(510);
  expect(codes(atLimit)).toEqual(["us"]);
  expect(codes(atLimit + " ")).toEqual([]);
  expect(codes("US;" + "?".repeat(510))).toEqual([]);
});

test("the approved ISO2 subset matches exactly the shipped SVG boundary", () => {
  const directory = join(process.cwd(), "public", "flags");
  const filenames = readdirSync(directory)
    .filter((name) => /\.svg$/i.test(name))
    .sort();
  expect(filenames).toEqual(APPROVED_ASSET_CODES.map((code) => `${code}.svg`).sort());
  for (const code of APPROVED_ASSET_CODES) {
    expect(codes(code)).toEqual([code]);
    expect(existsSync(join(directory, `${code}.svg`))).toBe(true);
  }
});
