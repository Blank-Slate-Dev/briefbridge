import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

const html = readFileSync('.legislation-cache/C2009A00028.html', 'utf-8');
const $ = cheerio.load(html);

// 1. Count all <p> elements by their class attribute
const counts = new Map<string, number>();
$('p').each((_, el) => {
  const cls = ($(el).attr('class') || '(no class)').trim();
  counts.set(cls, (counts.get(cls) ?? 0) + 1);
});
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log('--- ALL <p> CLASSES BY FREQUENCY ---');
for (const [cls, n] of sorted.slice(0, 40)) {
  console.log(`${String(n).padStart(5)}  ${cls}`);
}

// 2. Find the first 15 ActHead* elements and show their class + text
console.log('\n--- FIRST 15 ActHead* ELEMENTS ---');
let shown = 0;
$('p').each((_, el) => {
  if (shown >= 15) return false;
  const cls = ($(el).attr('class') || '').trim();
  if (!/^ActHead/.test(cls)) return;
  const text = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 100);
  console.log(`${cls.padEnd(10)} | "${text}"`);
  shown++;
});

// 3. Find any element whose text starts with "Chapter " — show what wraps it
console.log('\n--- ELEMENTS CONTAINING "Chapter N" TEXT ---');
let chapterShown = 0;
$('p, h1, h2, h3, h4, h5, div').each((_, el) => {
  if (chapterShown >= 10) return false;
  const text = $(el).text().trim().replace(/\s+/g, ' ');
  if (/^Chapter\s+\d/.test(text) && text.length < 80) {
    const cls = ($(el).attr('class') || '(no class)').trim();
    const tag = (el as any).tagName ?? '?';
    console.log(`<${tag} class="${cls}"> "${text.slice(0, 80)}"`);
    chapterShown++;
  }
});

// 4. Same for "Schedule N"
console.log('\n--- ELEMENTS CONTAINING "Schedule N" TEXT ---');
let scheduleShown = 0;
$('p, h1, h2, h3, h4, h5, div').each((_, el) => {
  if (scheduleShown >= 10) return false;
  const text = $(el).text().trim().replace(/\s+/g, ' ');
  if (/^Schedule\s+\d/.test(text) && text.length < 80) {
    const cls = ($(el).attr('class') || '(no class)').trim();
    const tag = (el as any).tagName ?? '?';
    console.log(`<${tag} class="${cls}"> "${text.slice(0, 80)}"`);
    scheduleShown++;
  }
});
