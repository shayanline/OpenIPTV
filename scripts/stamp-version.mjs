#!/usr/bin/env node
/**
 * Write package.json's version into the built widget's config.xml.
 *
 * The two used to be maintained by hand and had drifted a release apart, so the TV reported
 * one number while the app's own About screen reported another, and an install can decline to
 * replace a copy already on the set when the version does not advance. package.json is the
 * one source of truth, which is why the About screen reads it too.
 *
 * Only dist/ is touched. The copy in public/ keeps a placeholder, so nothing has to be
 * committed on every release.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [file, version] = process.argv.slice(2);
if (!file || !version) {
  console.error("usage: stamp-version.mjs <config.xml> <version>");
  process.exit(2);
}

// Tizen accepts two or three dotted integers and nothing else, so a prerelease suffix such as
// 0.3.0-beta.1 has to be refused here rather than at install time on the set.
if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error(`version "${version}" is not two or three dotted integers, which is all a widget may carry`);
  process.exit(1);
}

const xml = readFileSync(file, "utf8");
// The widget element's own version, not the XML declaration's and not required_version. The
// attribute may sit several lines below the tag, so this matches across them.
const stamped = xml.replace(/(<widget\b[\s\S]*?\sversion=")[^"]*(")/, `$1${version}$2`);
if (stamped === xml) {
  console.error(`${file} has no widget version attribute to stamp`);
  process.exit(1);
}
writeFileSync(file, stamped);
