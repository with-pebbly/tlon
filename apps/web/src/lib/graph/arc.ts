/**
 * Root relations of the pyramid run along (or between) cells of the base line; drawing
 * them as a shallow curve dipping below the line keeps them apart from triangle sides.
 * `minDip` pushes a labelled curve (aggregated edges) clear of the cards it joins.
 */
export function naturalDip(sx: number, sy: number, tx: number, ty: number, minDip: number) {
	return Math.max(minDip, Math.min(140, 12 + Math.hypot(tx - sx, ty - sy) * 0.18));
}

/** Quadratic arc below both ends; the label sits on its lowest point (half the dip). */
export function arcGeometry(sx: number, sy: number, tx: number, ty: number, dip: number) {
	const midX = (sx + tx) / 2;
	const bottom = Math.max(sy, ty);
	const controlY = bottom + dip;
	return {
		path: `M${sx},${sy} Q${midX},${controlY} ${tx},${ty}`,
		labelX: midX,
		labelY: (bottom + controlY) / 2
	};
}

type LabelledArc = {
	id: string;
	source: { x: number; y: number };
	target: { x: number; y: number };
	label: string;
	minDip: number;
};

/** Rough label box of the 11px edge label font (canvas units at zoom 1). */
const LABEL_HEIGHT = 18;
const labelWidth = (text: string) => 12 + text.length * 6.2;

/**
 * Greedy de-overlap of arc labels: arcs are visited left to right by label position and
 * each one dips deeper (moving its label down by a label height plus margin) until its
 * label box clears every label already placed. Returns the dip per arc id.
 */
export function stackArcLabels(arcs: readonly LabelledArc[]): Map<string, number> {
	const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
	const dips = new Map<string, number>();
	const step = 2 * (LABEL_HEIGHT + 4);
	const sorted = arcs.toSorted(
		(a, b) => a.source.x + a.target.x - (b.source.x + b.target.x) || a.id.localeCompare(b.id)
	);
	for (const arc of sorted) {
		const { source: s, target: t } = arc;
		const half = labelWidth(arc.label) / 2;
		let dip = naturalDip(s.x, s.y, t.x, t.y, arc.minDip);
		for (let attempt = 0; attempt < 40; attempt++) {
			const { labelX, labelY } = arcGeometry(s.x, s.y, t.x, t.y, dip);
			const box = {
				x0: labelX - half,
				x1: labelX + half,
				y0: labelY - LABEL_HEIGHT / 2,
				y1: labelY + LABEL_HEIGHT / 2
			};
			const clash = placed.some(
				(p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1
			);
			if (!clash || attempt === 39) {
				placed.push(box);
				break;
			}
			dip += step;
		}
		dips.set(arc.id, dip);
	}
	return dips;
}
