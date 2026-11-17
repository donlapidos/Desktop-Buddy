// The words Buddy marks for translation, found in its code and pages (used by strings.test.js and to list what a
// new language needs: node test/strings-scan.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every marked English string in the code and the pages, with where it was found. */
export function markedStrings() {
  /** @type {Map<string, string>} */
  const found = new Map();
  const files = [...fs.readdirSync(src).map((f) => path.join(src, f)), ...fs.readdirSync(path.join(src, "ui")).map((f) => path.join(src, "ui", f))];
  for (const file of files) {
    if (file.endsWith(".js")) {
      const code = fs.readFileSync(file, "utf8");
      for (const m of code.matchAll(/\b(?:t|tr|N)\(\s*("(?:[^"\\\n]|\\.)*"|`[^`$\\]*`)/g)) {
        const literal = m[1].startsWith("`") ? m[1].slice(1, -1) : JSON.parse(m[1]);
        found.set(literal, path.basename(file));
      }
    } else if (file.endsWith(".html")) {
      const html = fs.readFileSync(file, "utf8");
      const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      for (const m of html.matchAll(/<(\w+)\b([^>]*\bdata-t\b(?!-)[^>]*)>([^<]*)<\/\1>/g)) found.set(decode(m[3].trim()), path.basename(file));
      for (const m of html.matchAll(/<\w+\b([^>]*\bdata-t-attrs="([^"]+)"[^>]*)>/g)) {
        for (const attr of m[2].split(",").map((a) => a.trim())) {
          const value = m[1].match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1];
          if (value) found.set(decode(value), path.basename(file));
        }
      }
    }
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(JSON.stringify([...markedStrings().keys()], null, 1));
}
