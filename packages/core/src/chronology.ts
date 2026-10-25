import type { BeatTime, Transition } from '@tlon/contracts';

import type { StoryBeat } from './story.ts';

export type ChronoEntry = { beat: StoryBeat; time: BeatTime | null };

export type TimeComparison = {
	/** Finest component the verdict rests on. */
	component: 'year' | 'month' | 'dayOfMonth' | 'day' | 'minute';
	/** `a − b` in that component's unit; 0 when equal or within the stated tolerance. */
	delta: number;
};

/**
 * A beat is dated when it states a year or a story day. A clock time alone is not a date
 * (03:14 in October and 12:00 in July cannot be ordered by the clock), and a `relative`
 * statement alone is not one either.
 */
export function isDated(time: BeatTime | null | undefined): time is BeatTime {
	return time !== null && time !== undefined && (time.year !== undefined || time.day !== undefined);
}

/**
 * Lexicographic (year, month, day of month, story day, minute) comparison of two beat
 * times, using only components BOTH state. `approx` widens the year by ±1 and the minute
 * by `toleranceMinutes`; a difference inside the tolerance reads as equal. The month
 * compares only when both state the same year exactly (no `approx` on either: a rough
 * year says nothing about its months), the day of month only when year and month are
 * equal. A beat stating a day against one that
 * does not cannot be compared at minute level (it could silently cross midnight).
 * Returns null when the two share no comparable component. `relative` never takes part.
 */
export function compareBeatTime(a: BeatTime, b: BeatTime): TimeComparison | null {
	let reached: TimeComparison['component'] | null = null;
	if (a.year !== undefined && b.year !== undefined) {
		const tolerance = (a.yearApprox ? 1 : 0) + (b.yearApprox ? 1 : 0);
		const delta = a.year - b.year;
		if (Math.abs(delta) > tolerance) return { component: 'year', delta };
		if (tolerance > 0) return { component: 'year', delta: 0 };
		reached = 'year';
		if (a.month !== undefined && b.month !== undefined) {
			const monthDelta = a.month - b.month;
			if (monthDelta !== 0) return { component: 'month', delta: monthDelta };
			reached = 'month';
			if (a.dayOfMonth !== undefined && b.dayOfMonth !== undefined) {
				const dayDelta = a.dayOfMonth - b.dayOfMonth;
				if (dayDelta !== 0) return { component: 'dayOfMonth', delta: dayDelta };
				reached = 'dayOfMonth';
			}
		}
	}
	if (a.day !== undefined && b.day !== undefined) {
		const delta = a.day - b.day;
		if (delta !== 0) return { component: 'day', delta };
		reached = 'day';
	} else if (a.day !== undefined || b.day !== undefined) {
		return reached ? { component: reached, delta: 0 } : null;
	}
	// A clock time orders two beats only on the same stated day, or when neither beat
	// carries any date at all (single-scene stories that only track the clock).
	const undatedBoth = [a, b].every(
		(t) =>
			t.year === undefined &&
			t.month === undefined &&
			t.day === undefined &&
			t.relative === undefined
	);
	const sameDate = reached === 'day' || reached === 'dayOfMonth';
	if (a.minute !== undefined && b.minute !== undefined && (sameDate || undatedBoth)) {
		const tolerance = (a.approx ? a.toleranceMinutes : 0) + (b.approx ? b.toleranceMinutes : 0);
		const delta = a.minute - b.minute;
		return { component: 'minute', delta: Math.abs(delta) > tolerance ? delta : 0 };
	}
	return reached ? { component: reached, delta: 0 } : null;
}

/** Missing components sort first. */
const compareRank = (a: number | undefined, b: number | undefined) => {
	const x = a ?? Number.NEGATIVE_INFINITY;
	const y = b ?? Number.NEGATIVE_INFINITY;
	return x === y ? 0 : x < y ? -1 : 1;
};

/**
 * Story chronology as a VIEW over the presentation order (review §4.2): dated beats
 * sorted by (year, month, day of month, story day, minute); a missing component sorts
 * first within its group and
 * ties fall back to the presentation index, so the order is total and stable.
 * Undated beats (no annotation, no time, or a `relative` statement only) are listed
 * separately in presentation order. Beats are never mutated.
 */
export function chronologicalOrder(
	beats: readonly StoryBeat[],
	transitions: ReadonlyMap<string, Transition>
): { dated: ChronoEntry[]; undated: ChronoEntry[] } {
	const entries = beats.map((beat) => ({
		beat,
		time: transitions.get(beat.artifact.id)?.time ?? null
	}));
	const dated = entries
		.filter((e) => isDated(e.time))
		.toSorted(
			(x, y) =>
				compareRank(x.time?.year, y.time?.year) ||
				compareRank(x.time?.month, y.time?.month) ||
				compareRank(x.time?.dayOfMonth, y.time?.dayOfMonth) ||
				compareRank(x.time?.day, y.time?.day) ||
				compareRank(x.time?.minute, y.time?.minute) ||
				x.beat.index - y.beat.index
		);
	const undated = entries
		.filter((e) => !isDated(e.time))
		.toSorted((x, y) => x.beat.index - y.beat.index);
	return { dated, undated };
}
