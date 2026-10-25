/**
 * Quote matching as the server grounds findings: runs of whitespace collapse to one
 * space and typographic quote marks (« » „ “ ”) read as a plain `"`.
 */
const QUOTE_MARK = /[«»„“”]/g;

export const normaliseQuote = (text: string) =>
	text.replaceAll(/\s+/g, ' ').replaceAll(QUOTE_MARK, '"').trim();

export type TextSegment = { text: string; marked: boolean };

/**
 * `text` split into plain and marked runs, where marked runs are the occurrences of any
 * quote (compared normalised, mapped back to the original characters). Overlapping
 * occurrences merge; quotes that never occur mark nothing.
 */
export function markQuotes(text: string, quotes: readonly string[]): TextSegment[] {
	// Normalised text plus, per normalised character, its index in `text`.
	let normalised = '';
	const origin: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text.charAt(i);
		if (/\s/.test(char)) {
			if (normalised.endsWith(' ')) continue;
			normalised += ' ';
		} else {
			normalised += char.replaceAll(QUOTE_MARK, '"');
		}
		origin.push(i);
	}

	const ranges: { start: number; end: number }[] = [];
	for (const quote of quotes) {
		const needle = normaliseQuote(quote);
		if (needle === '') continue;
		for (let at = normalised.indexOf(needle); at !== -1; at = normalised.indexOf(needle, at + 1)) {
			const start = origin[at];
			const last = origin[at + needle.length - 1];
			if (start !== undefined && last !== undefined) ranges.push({ start, end: last + 1 });
		}
	}
	ranges.sort((a, b) => a.start - b.start);

	const segments: TextSegment[] = [];
	let cursor = 0;
	for (const range of ranges) {
		if (range.end <= cursor) continue;
		const start = Math.max(range.start, cursor);
		if (start > cursor) segments.push({ text: text.slice(cursor, start), marked: false });
		segments.push({ text: text.slice(start, range.end), marked: true });
		cursor = range.end;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
	return segments;
}
