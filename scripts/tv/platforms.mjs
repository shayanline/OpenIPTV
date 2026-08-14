/**
 * Samsung's engine matrix, read from the one file that holds it.
 *
 * The same table used to be written out in prose in three places and two of them were a
 * generation wrong, saying the 2020 sets run Chromium 76 when they run 69. That is the row
 * height problem again: a fact restated is a fact that drifts, and nothing fails when it
 * does. So platforms.json owns it and everything else asks.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(join(here, "platforms.json"), "utf8"));

/** Every platform this application supports, oldest engine first. */
export const supported = table.platforms.filter(
  (p) => Number.parseFloat(p.tizen) >= Number.parseFloat(table.supportedFrom),
);

/** The oldest engine in the supported range, which is the one everything is built for. */
export const floorPlatform = () => supported.find((p) => p.floor) ?? supported[0];

/**
 * The newest engine worth testing against, which is not the newest that exists.
 *
 * Anything the floor cannot do is not used, so every engine above the floor runs a strict
 * superset of what the app asks for. Two ends therefore cover the middle, and the ceiling
 * is marked rather than taken as the last row so that adding next year's television to the
 * table does not silently add a leg to CI.
 */
export const ceilingPlatform = () =>
  supported.find((p) => p.ceiling) ?? supported[supported.length - 1];

export const platformOf = (tizen) => supported.find((p) => p.tizen === String(tizen));

export const source = table.source;
export const checked = table.checked;
