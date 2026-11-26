export interface CountryFlag {
  readonly code: string;
  readonly name: string;
}

type CountryDefinition = CountryFlag & {
  readonly iso3: string;
  readonly aliases?: readonly string[];
};

const countries: readonly CountryDefinition[] = [
  { code: "us", iso3: "USA", name: "United States", aliases: ["United States of America"] },
  { code: "ca", iso3: "CAN", name: "Canada" },
  { code: "mx", iso3: "MEX", name: "Mexico" },
  { code: "br", iso3: "BRA", name: "Brazil" },
  { code: "ar", iso3: "ARG", name: "Argentina" },
  {
    code: "gb",
    iso3: "GBR",
    name: "United Kingdom",
    aliases: ["UK", "United Kingdom of Great Britain and Northern Ireland"],
  },
  { code: "ie", iso3: "IRL", name: "Ireland" },
  { code: "fr", iso3: "FRA", name: "France" },
  { code: "de", iso3: "DEU", name: "Germany" },
  { code: "es", iso3: "ESP", name: "Spain" },
  { code: "pt", iso3: "PRT", name: "Portugal" },
  { code: "it", iso3: "ITA", name: "Italy" },
  { code: "be", iso3: "BEL", name: "Belgium" },
  { code: "nl", iso3: "NLD", name: "Netherlands", aliases: ["The Netherlands"] },
  { code: "ch", iso3: "CHE", name: "Switzerland" },
  { code: "at", iso3: "AUT", name: "Austria" },
  { code: "se", iso3: "SWE", name: "Sweden" },
  { code: "no", iso3: "NOR", name: "Norway" },
  { code: "dk", iso3: "DNK", name: "Denmark" },
  { code: "fi", iso3: "FIN", name: "Finland" },
  { code: "pl", iso3: "POL", name: "Poland" },
  { code: "cz", iso3: "CZE", name: "Czechia", aliases: ["Czech Republic"] },
  { code: "hu", iso3: "HUN", name: "Hungary" },
  { code: "ro", iso3: "ROU", name: "Romania" },
  { code: "gr", iso3: "GRC", name: "Greece" },
  { code: "tr", iso3: "TUR", name: "Turkey", aliases: ["Turkiye"] },
  { code: "ru", iso3: "RUS", name: "Russia", aliases: ["Russian Federation"] },
  { code: "ua", iso3: "UKR", name: "Ukraine" },
  { code: "au", iso3: "AUS", name: "Australia" },
  { code: "nz", iso3: "NZL", name: "New Zealand" },
  { code: "in", iso3: "IND", name: "India" },
  { code: "pk", iso3: "PAK", name: "Pakistan" },
  { code: "bd", iso3: "BGD", name: "Bangladesh" },
  {
    code: "ir",
    iso3: "IRN",
    name: "Iran",
    aliases: ["Iran, Islamic Republic of", "Iran (Islamic Republic of)"],
  },
  { code: "jp", iso3: "JPN", name: "Japan" },
  {
    code: "kr",
    iso3: "KOR",
    name: "South Korea",
    aliases: ["Republic of Korea", "Korea, Republic of"],
  },
  { code: "cn", iso3: "CHN", name: "China" },
  { code: "tw", iso3: "TWN", name: "Taiwan", aliases: ["Taiwan, Province of China"] },
  { code: "hk", iso3: "HKG", name: "Hong Kong" },
  { code: "id", iso3: "IDN", name: "Indonesia" },
  { code: "th", iso3: "THA", name: "Thailand" },
  { code: "vn", iso3: "VNM", name: "Vietnam", aliases: ["Viet Nam"] },
  { code: "ph", iso3: "PHL", name: "Philippines" },
  { code: "my", iso3: "MYS", name: "Malaysia" },
  { code: "sg", iso3: "SGP", name: "Singapore" },
  { code: "za", iso3: "ZAF", name: "South Africa" },
  { code: "ng", iso3: "NGA", name: "Nigeria" },
  { code: "eg", iso3: "EGY", name: "Egypt" },
];

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s.'\u2019()_-]+/g, "");

const flagsByAlias = new Map<string, CountryFlag>();
for (const country of countries) {
  for (const alias of [country.code, country.iso3, country.name, ...(country.aliases ?? [])]) {
    flagsByAlias.set(normalize(alias), country);
  }
}

export function resolveCountryFlags(value?: string): readonly CountryFlag[] {
  if (!value || value.length > 512) return [];
  const whole = flagsByAlias.get(normalize(value));
  if (whole) return [whole];

  const flags: CountryFlag[] = [];
  const seen = new Set<string>();
  const append = (flag: CountryFlag | undefined) => {
    if (!flag || seen.has(flag.code) || flags.length >= 6) return;
    seen.add(flag.code);
    flags.push(flag);
  };
  for (const chunk of value.split(/[;/|&+]/)) {
    const matched = flagsByAlias.get(normalize(chunk));
    if (matched) append(matched);
    else {
      for (const segment of chunk.split(/,|\s+and\s+/i)) {
        append(flagsByAlias.get(normalize(segment)));
      }
    }
    if (flags.length === 6) break;
  }
  return flags;
}
