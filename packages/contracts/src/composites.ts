import { z } from 'zod';

import { ArtifactKind, OwnerScope } from './enums.ts';
import { Artifact, Relation, Uuid } from './models.ts';

const IsoDate = z.iso.datetime({ offset: true });
const Text = z.string().trim().min(1).max(2000);

/** Maximum direct members of one composite definition. */
export const MAX_COMPOSITE_MEMBERS = 500;
/** Maximum nesting depth `openComposite` will expand in one request. */
export const MAX_COMPOSITE_OPEN_DEPTH = 6;

/**
 * A claim the composer explicitly publishes on the composite's interface, citing the
 * exact member revision it rests on (spec §3, §6.1). Its text is visible to anyone who
 * can read the composite — nothing else from the member is.
 */
export const ClaimRef = z.object({
	claimId: z.string().trim().min(1).max(64),
	text: Text,
	sourceArtifactId: Uuid,
	sourceRevisionId: Uuid
});
export type ClaimRef = z.infer<typeof ClaimRef>;

/** Public interface of a composite: a projection, never a replacement of its internals. */
export const CompositeContract = z.object({
	summary: z.string().trim().max(8000).default(''),
	entryConditions: z.array(ClaimRef).max(50).default([]),
	exitConditions: z.array(ClaimRef).max(50).default([]),
	invariants: z.array(ClaimRef).max(50).default([]),
	keyClaims: z.array(ClaimRef).max(100).default([]),
	openQuestions: z.array(Text).max(50).default([])
});
export type CompositeContract = z.infer<typeof CompositeContract>;
export type CompositeContractInput = z.input<typeof CompositeContract>;

export const CompositeBoundary = z.object({
	/** Members where the composite's internal flow starts (left anchors resolve here). */
	entries: z.array(Uuid),
	/** Members where it ends (right-side bridges attach after these). */
	exits: z.array(Uuid)
});
export type CompositeBoundary = z.infer<typeof CompositeBoundary>;

export const CreateCompositeInput = z.object({
	title: z.string().trim().min(1).max(300),
	kind: ArtifactKind.default('ARC'),
	memberArtifactIds: z.array(Uuid).min(1).max(MAX_COMPOSITE_MEMBERS),
	/** Internal semantic edges to snapshot; both endpoints must be members. */
	memberRelationIds: z
		.array(Uuid)
		.max(MAX_COMPOSITE_MEMBERS * 4)
		.default([]),
	/** Omit to infer: entries = internal sources, exits = internal sinks. */
	boundary: CompositeBoundary.partial().optional(),
	contract: CompositeContract.default({
		summary: '',
		entryConditions: [],
		exitConditions: [],
		invariants: [],
		keyClaims: [],
		openQuestions: []
	}),
	ownerScope: OwnerScope.default('PROJECT_PUBLIC'),
	reason: z.string().trim().max(1000).optional()
});
export type CreateCompositeInput = z.input<typeof CreateCompositeInput>;

/** New definition revision; omitted fields carry over from the current definition. */
export const ReviseCompositeInput = z.object({
	expectedDefinitionVersion: z.int().min(1),
	memberArtifactIds: z.array(Uuid).min(1).max(MAX_COMPOSITE_MEMBERS).optional(),
	memberRelationIds: z
		.array(Uuid)
		.max(MAX_COMPOSITE_MEMBERS * 4)
		.optional(),
	boundary: CompositeBoundary.partial().optional(),
	contract: CompositeContract.optional(),
	title: z.string().trim().min(1).max(300).optional(),
	reason: z.string().trim().max(1000).optional()
});
export type ReviseCompositeInput = z.input<typeof ReviseCompositeInput>;

export const CompositeMember = z.object({
	artifactId: Uuid,
	/** Member revision pinned by this definition. */
	pinnedRevisionId: Uuid,
	order: z.int().min(0)
});
export type CompositeMember = z.infer<typeof CompositeMember>;

/**
 * Composite definition as the caller may see it: members and relations the caller
 * cannot read are omitted entirely (no ids, no counts, no placeholders).
 */
export const CompositeDefinition = z.object({
	id: Uuid,
	compositeArtifactId: Uuid,
	/** Composite artifact revision created together with this definition. */
	artifactRevisionId: Uuid,
	version: z.int().min(1),
	contract: CompositeContract,
	boundary: CompositeBoundary,
	members: z.array(CompositeMember),
	memberRelationIds: z.array(Uuid),
	actorId: z.string(),
	reason: z.string().nullable(),
	createdAt: IsoDate
});
export type CompositeDefinition = z.infer<typeof CompositeDefinition>;

/** Compact per-composite record embedded in the graph projection (head definition). */
export const CompositeSummary = z.object({
	artifactId: Uuid,
	definitionId: Uuid,
	version: z.int().min(1),
	memberArtifactIds: z.array(Uuid),
	memberRelationIds: z.array(Uuid),
	boundary: CompositeBoundary,
	/** Visible relations with exactly one endpoint inside the (transitive) member set. */
	externalRelationIds: z.array(Uuid)
});
export type CompositeSummary = z.infer<typeof CompositeSummary>;

export type CompositeViewShape = {
	artifact: z.infer<typeof Artifact>;
	definition: CompositeDefinition;
	memberArtifacts: Array<z.infer<typeof Artifact>>;
	relations: Array<z.infer<typeof Relation>>;
	externalRelations: Array<z.infer<typeof Relation>>;
	/** Nested composites among the members, opened down to the requested depth. */
	children: CompositeViewShape[];
	/** Visible composites whose head definition contains this one (breadcrumbs). */
	parentIds: string[];
	warnings: string[];
};

/** `openComposite` response: one level of the membership DAG, recursively. */
export const CompositeView: z.ZodType<CompositeViewShape> = z.lazy(() =>
	z.object({
		artifact: Artifact,
		definition: CompositeDefinition,
		memberArtifacts: z.array(Artifact),
		relations: z.array(Relation),
		externalRelations: z.array(Relation),
		children: z.array(CompositeView),
		parentIds: z.array(Uuid),
		warnings: z.array(z.string())
	})
);
export type CompositeView = CompositeViewShape;

export const CompositeRevisionList = z.object({ items: z.array(CompositeDefinition) });
export type CompositeRevisionList = z.infer<typeof CompositeRevisionList>;

export const OpenCompositeQuery = z.object({
	depth: z.coerce.number().int().min(0).max(MAX_COMPOSITE_OPEN_DEPTH).default(1)
});

/** Export-bundle record: full definition incl. every member (operator-only export). */
export const CompositeDefinitionRecord = CompositeDefinition;
