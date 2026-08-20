import type { RangeFilterOperator, RangeFilterSpec } from './rangeFilter';

export type { RangeFilterOperator, RangeFilterSpec };

export type CellValue = string | number | boolean | null;

export interface FormatSpec {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontColor?: string;
  fillColor?: string;
  /** When true, remove background fill from the range (leaves font/borders intact). */
  clearFill?: boolean;
  numberFormat?: string;
  horizontalAlignment?: 'left' | 'center' | 'right';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  wrapText?: boolean;
  borders?: {
    style: 'thin' | 'medium' | 'thick' | 'dotted' | 'dashed' | 'none';
    color?: string;
    edges: ('top' | 'bottom' | 'left' | 'right' | 'all' | 'outer' | 'inner')[];
  };
}

export interface BatchSetOperation {
  address: string;
  value?: CellValue;
  formula?: string;
  format?: FormatSpec;
}

export interface SetCellAction {
  type: 'SET_CELL';
  sheetName: string;
  address: string;
  value: CellValue;
  format?: FormatSpec;
  /** When true, allow writing over non-empty cells (user-confirmed replace only). */
  explicitOverwriteConfirmed?: boolean;
}

export interface SetFormulaAction {
  type: 'SET_FORMULA';
  sheetName: string;
  address: string;
  formula: string;
  format?: FormatSpec;
  /** When true, allow writing over non-empty cells (user-confirmed replace only). */
  explicitOverwriteConfirmed?: boolean;
}

export interface FormatRangeAction {
  type: 'FORMAT_RANGE';
  sheetName: string;
  range: string;
  format: FormatSpec;
}

export interface FillDownAction {
  type: 'FILL_DOWN';
  sheetName: string;
  sourceRange: string;
  targetRange: string;
  explicitOverwriteConfirmed?: boolean;
}

export interface BatchSetAction {
  type: 'BATCH_SET';
  sheetName: string;
  operations: BatchSetOperation[];
  explicitOverwriteConfirmed?: boolean;
}

export interface AddRowAction {
  type: 'ADD_ROW';
  sheetName: string;
  afterRow: number;
  values: CellValue[];
  copyFormatFromRow?: number;
}

export interface AppendRowAction {
  type: 'APPEND_ROW';
  sheetName: string;
  values: CellValue[];
  explicitOverwriteConfirmed?: boolean;
}

export interface InsertRowAction {
  type: 'INSERT_ROW';
  sheetName: string;
  row: number;
  count?: number;
  position?: 'above' | 'below';
}

export interface DeleteRowAction {
  type: 'DELETE_ROW';
  sheetName: string;
  /** 1-based Excel row numbers */
  rows: number[];
}

/**
 * INSERT_COLUMN — two shapes:
 * 1) Legacy blank insert: beforeColumn + count (shifts existing columns right)
 * 2) Semantic add-column: columnName + position afterLastColumn | { afterColumn }
 *    Placement is resolved from the live Office.js used range at execution time.
 */
export type InsertColumnPosition = 'afterLastColumn' | { afterColumn: string };

export interface InsertColumnAction {
  type: 'INSERT_COLUMN';
  sheetName: string;
  /** Legacy: column letter to insert before */
  beforeColumn?: string;
  count?: number;
  copyFormatFromColumn?: string;
  /** Semantic: header text for the new column */
  columnName?: string;
  /** Semantic: where to place the column (never a guessed numeric index) */
  position?: InsertColumnPosition;
  /** Flattened form of position.afterColumn (accepted by normalizer) */
  afterColumn?: string;
  /**
   * Formula for data rows. Prefer `{row}` placeholder (Excel 1-based),
   * e.g. `=J{row}-I{row}`. A row-2 formula is filled down with relative refs.
   */
  formula?: string;
  explicitOverwriteConfirmed?: boolean;
}

export interface DeleteColumnAction {
  type: 'DELETE_COLUMN';
  sheetName: string;
  columns: string[];
}

export interface AutoFillAction {
  type: 'AUTO_FILL';
  sheetName: string;
  startAddress: string;
  direction: 'down' | 'right';
  endRow?: number;
  endCol?: number;
  explicitOverwriteConfirmed?: boolean;
}

export interface WriteTableAction {
  type: 'WRITE_TABLE';
  sheetName: string;
  headers: CellValue[];
  rows: CellValue[][];
  explicitOverwriteConfirmed?: boolean;
}

export interface HighlightCellAction {
  type: 'HIGHLIGHT_CELL';
  sheetName: string;
  address: string;
  color?: string;
}

export interface MergeCellsAction {
  type: 'MERGE_CELLS';
  sheetName: string;
  range: string;
}

export interface ClearRangeAction {
  type: 'CLEAR_RANGE';
  sheetName: string;
  range: string;
  mode?: 'contents' | 'formats' | 'all';
}

export interface AddSheetAction {
  type: 'ADD_SHEET';
  name: string;
  position?: number;
  copyFrom?: string;
}

export interface DeleteSheetAction {
  type: 'DELETE_SHEET';
  sheetName: string;
}

export interface RenameSheetAction {
  type: 'RENAME_SHEET';
  oldName: string;
  newName: string;
}

export interface CopySheetAction {
  type: 'COPY_SHEET';
  sourceName: string;
  newName: string;
  position?: number;
}

export interface CreateTableAction {
  type: 'CREATE_TABLE';
  sheetName: string;
  range: string;
  tableName: string;
  hasHeaders: boolean;
  style?: string;
}

/** Undoes CREATE_TABLE: unwraps the Excel Table object back to a plain range, leaving cell values/formats untouched (TASKS.md #16). */
export interface DeleteTableAction {
  type: 'DELETE_TABLE';
  sheetName: string;
  tableName: string;
}

export interface CreateChartAction {
  type: 'CREATE_CHART';
  sheetName: string;
  sourceSheetName: string;
  sourceRange: string;
  chartType: string;
  title?: string;
  startCell?: string;
  endCell?: string;
  /** Alternate anchor (spec 13); preferred over startCell when both present in handler */
  destCell?: string;
  colorScheme?: 'default' | 'blue' | 'grey' | 'blueGrey' | 'green' | 'red' | 'orange' | 'purple' | 'yellow';
  /** Optional stable id; Office.js name is captured on apply if omitted */
  chartId?: string;
}

export interface UpdateChartAction {
  type: 'UPDATE_CHART';
  sheetName: string;
  chartId: string;
  chartType?: string;
  colorScheme?: 'default' | 'blue' | 'grey' | 'blueGrey' | 'green' | 'red' | 'orange' | 'purple' | 'yellow';
}

/**
 * Revert-only inverse of a `CREATE_CHART` create (TASKS.md #15) — never
 * advertised to the Executor (see `action-catalog.ts`'s `advertise: false`).
 * `chartId` is the real Office.js-assigned chart name, only knowable after
 * the original create actually ran (`handleCreateChart`'s apply-time
 * read-back of `chart.name`, reported to the backend on accept and patched
 * into `ChangeSet.structuralOps` before the inverse is built) — the same
 * apply-endpoint contract mechanism TASKS.md #40 built first for
 * `DeleteConditionalFormatAction`. Dispatched via Office.js
 * `Worksheet.charts.getItem(chartId).delete()`.
 */
export interface DeleteChartAction {
  type: 'DELETE_CHART';
  sheetName: string;
  chartId: string;
}

export interface AggregateTableAggregation {
  column: string;
  /** 'first' passes through a label column 1:1 with the group key (e.g. Supplier Name alongside a GSTIN group-by) — not a numeric reduction. */
  fn: 'sum' | 'count' | 'average' | 'max' | 'min' | 'first';
  outputLabel: string;
}

export interface AggregateTableAction {
  type: 'AGGREGATE_TABLE';
  sourceSheet: string;
  sourceRange: string;
  groupByColumn: string;
  /** Derive grouping key from groupByColumn (e.g. month from a date). */
  groupByTransform?: 'none' | 'month' | 'year' | 'monthYear' | 'weekday' | 'quarter';
  aggregations: AggregateTableAggregation[];
  sortBy?: { column: string; direction: 'asc' | 'desc' };
  topN?: number;
  destSheet: string;
  destStartCell: string;
  hasHeaders?: boolean;
  explicitOverwriteConfirmed?: boolean;
}

export interface DefineNamedRangeAction {
  type: 'DEFINE_NAMED_RANGE';
  name: string;
  formula: string;
  comment?: string;
}

export interface AutoFitColumnsAction {
  type: 'AUTOFIT_COLUMNS';
  sheetName: string;
  columns?: string[];
}

export interface SortRangeAction {
  type: 'SORT_RANGE';
  sheetName: string;
  range: string;
  key?: number;
  ascending?: boolean;
  hasHeaders?: boolean;
  columnName?: string;
}

export interface ClarifyAction {
  type: 'CLARIFY';
  question: string;
  options?: string[];
}

export interface CheckpointAction {
  type: 'CHECKPOINT';
  message: string;
}

export interface CopyFilteredRangeAction {
  type: 'COPY_FILTERED_RANGE';
  sourceSheet: string;
  sourceRange: string;
  hasHeaders: boolean;
  destSheet: string;
  destStartCell: string;
  filter?: RangeFilterSpec;
  mode: 'copy' | 'move';
  explicitOverwriteConfirmed?: boolean;
}

/** Highlight/format rows matching a column filter — Office.js reads values and paints fills. */
export interface FormatMatchingRowsAction {
  type: 'FORMAT_MATCHING_ROWS';
  sheetName: string;
  range: string;
  hasHeaders: boolean;
  filter: RangeFilterSpec;
  format: FormatSpec;
}

/**
 * Set a value in targetColumn for every row matching filter (or all data rows if filter omitted).
 * Office.js scans the full range — never enumerate SET_CELL from a sample.
 */
export interface SetMatchingRowsAction {
  type: 'SET_MATCHING_ROWS';
  sheetName: string;
  range: string;
  hasHeaders: boolean;
  filter?: RangeFilterSpec;
  targetColumn: string;
  value: string | number | boolean;
  explicitOverwriteConfirmed?: boolean;
}

export interface MoveRangeAction {
  type: 'MOVE_RANGE';
  sourceSheet: string;
  sourceRange: string;
  destSheet: string;
  destStartCell: string;
  explicitOverwriteConfirmed?: boolean;
}

export interface HideRowAction {
  type: 'HIDE_ROW';
  sheetName?: string;
  row: number;
  rowCount?: number;
}

export interface UnhideRowAction {
  type: 'UNHIDE_ROW';
  sheetName?: string;
  row: number;
  rowCount?: number;
}

export interface HideColumnAction {
  type: 'HIDE_COLUMN';
  sheetName?: string;
  col: number;
  colCount?: number;
}

export interface UnhideColumnAction {
  type: 'UNHIDE_COLUMN';
  sheetName?: string;
  col: number;
  colCount?: number;
}

export interface SetRowHeightAction {
  type: 'SET_ROW_HEIGHT';
  sheetName?: string;
  row: number;
  height: number;
}

export interface SetColumnWidthAction {
  type: 'SET_COLUMN_WIDTH';
  sheetName?: string;
  col: number;
  width: number;
}

export interface FreezePanesAction {
  type: 'FREEZE_PANES';
  sheetName?: string;
  freezeRows?: number;
  freezeColumns?: number;
}

export interface UnfreezePanesAction {
  type: 'UNFREEZE_PANES';
  sheetName?: string;
}

export interface AutoFilterAction {
  type: 'AUTO_FILTER';
  sheetName?: string;
  /** Full header + data range the filter dropdowns apply to, e.g. "A1:N51". */
  range: string;
}

export interface SetZoomAction {
  type: 'SET_ZOOM';
  sheetName?: string;
  zoomPercent: number;
}

export interface ProtectSheetAction {
  type: 'PROTECT_SHEET';
  sheetName?: string;
}

export interface UnprotectSheetAction {
  type: 'UNPROTECT_SHEET';
  sheetName?: string;
}

export interface UnmergeCellsAction {
  type: 'UNMERGE_CELLS';
  sheetName?: string;
  range: string;
}

export interface HideSheetAction {
  type: 'HIDE_SHEET';
  sheetName?: string;
}

export interface ShowSheetAction {
  type: 'SHOW_SHEET';
  sheetName?: string;
}

export interface SetSheetColorAction {
  type: 'SET_SHEET_COLOR';
  sheetName?: string;
  color: string;
}

export interface AddCommentAction {
  type: 'ADD_COMMENT';
  sheetName?: string;
  address: string;
  comment: string;
}

export interface DeleteCommentAction {
  type: 'DELETE_COMMENT';
  sheetName?: string;
  address: string;
}

/** Excel's own cell-value conditional-format comparison operators (Office.js `ConditionalCellValueOperator`). */
export type ConditionalFormatOperator =
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'equalTo'
  | 'notEqualTo'
  | 'between'
  | 'notBetween';

/**
 * `kind` is a discriminant so later rule shapes (formula-driven, top/bottom-N,
 * color-scale — TASKS.md M3 #35-37) extend `ConditionalFormatRule` as a union
 * without touching this variant. Comparison-only for now, per #32's scope.
 */
export interface ConditionalFormatCellValueRule {
  kind: 'cellValue';
  operator: ConditionalFormatOperator;
  value: number | string;
  /** Required when operator is 'between' / 'notBetween'. */
  value2?: number | string;
  format: FormatSpec;
}

/**
 * A boolean Excel formula, evaluated relative to the top-left cell of `range`
 * for every cell in it — e.g. `"=$C2<$B2*0.9"` to highlight a row where
 * column C has dropped more than 10% below column B. This is the variant
 * VISION.md's own headline example needs ("highlight the regions where
 * revenue dropped more than 10%") — a single-column numeric threshold
 * (`ConditionalFormatCellValueRule`) cannot express a cross-column
 * comparison. Dispatched via Office.js `Range.conditionalFormats.add('Custom')`.
 */
export interface ConditionalFormatFormulaRule {
  kind: 'formula';
  formula: string;
  format: FormatSpec;
}

/**
 * Highlights the top or bottom N items (or N%) of `range` by value — e.g.
 * "highlight the top 5 suppliers by total". Excel's own rank-based rule,
 * distinct from cellValue (fixed threshold) and formula (cross-column) —
 * it re-ranks live as values change, including a new row entering the top/
 * bottom set (TASKS.md #36). Dispatched via Office.js
 * `Range.conditionalFormats.add('TopBottom')`.
 */
export interface ConditionalFormatTopBottomRule {
  kind: 'topBottom';
  side: 'top' | 'bottom';
  /** Item count by default; a 0-100 percentage when `isPercent` is true. */
  rank: number;
  isPercent?: boolean;
  format: FormatSpec;
}

/**
 * A 2- or 3-color gradient scale across `range`'s values — e.g. "color-scale
 * the Total Amount column". Unlike the other rule kinds, there is no single
 * `format` (no bold/fill toggle) — each stop in `colors` supplies its own
 * color directly, matching Office.js `ConditionalColorScaleCriteria`. The
 * lowest/highest actual values in the range anchor the scale's ends and
 * shift automatically as data changes — no percentile/fixed-value stops are
 * exposed here (TASKS.md #37). Dispatched via Office.js
 * `Range.conditionalFormats.add('ColorScale')`.
 */
export interface ConditionalFormatColorScaleRule {
  kind: 'colorScale';
  /** [min, max] for a 2-color scale, or [min, mid, max] for a 3-color scale. */
  colors: [string, string] | [string, string, string];
}

export type ConditionalFormatRule =
  | ConditionalFormatCellValueRule
  | ConditionalFormatFormulaRule
  | ConditionalFormatTopBottomRule
  | ConditionalFormatColorScaleRule;

/**
 * A live, re-evaluating Excel conditional-formatting rule (PRD M7) — distinct
 * from HIGHLIGHT_CELL/FORMAT_MATCHING_ROWS, which compute a one-shot static
 * fill that goes stale the moment underlying data changes. Dispatched via
 * Office.js `Range.conditionalFormats.add('CellValue' | 'Custom')` — TASKS.md #34/#35.
 */
export interface ConditionalFormatAction {
  type: 'CONDITIONAL_FORMAT';
  sheetName: string;
  range: string;
  rule: ConditionalFormatRule;
  /**
   * When set, targets an existing rule read back into context (`id` from
   * `WorkbookContext.conditionalFormats`, TASKS.md #38) — the rule's
   * parameters are updated in place (`ConditionalFormat.set()`, resolved via
   * `Range.conditionalFormats.getItem(id)`) instead of adding a new one.
   * `rule.kind` must match the existing rule's own kind; a modify request
   * that changes kind is unsupported and should fall back to a plain create.
   */
  existingRuleId?: string;
}

/**
 * Revert-only inverse of a `CONDITIONAL_FORMAT` create (TASKS.md #40) —
 * never advertised to the Executor (see `action-catalog.ts`'s `advertise:
 * false`). `ruleId` is the real Excel-assigned id, only knowable after the
 * original create actually ran (captured via `handleConditionalFormat`'s
 * apply-time id read-back, reported to the backend on accept, and patched
 * into `ChangeSet.structuralOps` before the inverse is built — see
 * `ARCHITECTURE.md`'s note on this being the same apply-endpoint contract
 * gap `CREATE_CHART` (#15) hit first). Dispatched via Office.js
 * `Range.conditionalFormats.getItem(ruleId).delete()`.
 */
export interface DeleteConditionalFormatAction {
  type: 'DELETE_CONDITIONAL_FORMAT';
  sheetName: string;
  ruleId: string;
}

export type RichAction =
  | SetCellAction
  | SetFormulaAction
  | FormatRangeAction
  | FillDownAction
  | BatchSetAction
  | AddRowAction
  | AppendRowAction
  | InsertRowAction
  | DeleteRowAction
  | InsertColumnAction
  | DeleteColumnAction
  | AutoFillAction
  | WriteTableAction
  | HighlightCellAction
  | MergeCellsAction
  | ClearRangeAction
  | AddSheetAction
  | DeleteSheetAction
  | RenameSheetAction
  | CopySheetAction
  | CreateTableAction
  | DeleteTableAction
  | CreateChartAction
  | UpdateChartAction
  | DeleteChartAction
  | AggregateTableAction
  | DefineNamedRangeAction
  | AutoFitColumnsAction
  | SortRangeAction
  | ClarifyAction
  | CheckpointAction
  | CopyFilteredRangeAction
  | FormatMatchingRowsAction
  | SetMatchingRowsAction
  | MoveRangeAction
  | HideRowAction
  | UnhideRowAction
  | HideColumnAction
  | UnhideColumnAction
  | SetRowHeightAction
  | SetColumnWidthAction
  | FreezePanesAction
  | UnfreezePanesAction
  | AutoFilterAction
  | SetZoomAction
  | ProtectSheetAction
  | UnprotectSheetAction
  | UnmergeCellsAction
  | HideSheetAction
  | ShowSheetAction
  | SetSheetColorAction
  | AddCommentAction
  | DeleteCommentAction
  | ConditionalFormatAction
  | DeleteConditionalFormatAction;
