# ATTACHMENT_EXTRACTION_PLAN.md — Cellix

> Living plan for the paperclip: attaching a file in the task pane and extracting its data into the workbook.
> We build this **one slice at a time**. Each slice gets its own section below.
>
> Companion documents: `VISION.md` (why), `PRD.md` (what), `ARCHITECTURE.md` (how, see AD-10), `TASKS.md` (work items, #363 onward), `CODEBASE_ANALYSIS.md` §3.22 (what exists and the traps in it).
>
> *Created: October 8, 2026. Slice 1 built the same day. It has passed its automated tests and has not yet been run inside Excel (§6.12).*

---

## 1. Slice status

| # | Slice | Input | Output | LLM needed | Status |
|---|---|---|---|---|---|
| 1 | Bank statements | `.xlsx`, `.xls`, `.csv`, text-based `.pdf` | One new sheet in a fixed layout | No | **Built October 8, 2026.** Automated tests pass. Live Excel test pending (`TASKS.md` #364). |

Add a row here whenever a new slice is proposed. Candidates that are not yet planned are listed in §7.

---

## 2. Where the code stands today (October 8, 2026)

**Client** (`client/src`)

| Path | What it does |
|---|---|
| `services/attachments/decodeAttachment.ts` | Entry point: file in, raw table out. Refuses unsupported types, files over 20 MB and empty files before reading them. |
| `services/attachments/pdfDecoder.ts`, `pdfRows.ts` | Reads a PDF's text with positions (pdf.js, loaded on first use) and rebuilds its rows. Maps password and scanned-PDF failures to clear messages. |
| `services/attachments/gridDecoder.ts` | Reads `.xlsx`, `.xls` and `.csv` (SheetJS, loaded on first use) without interpreting values. |
| `services/attachments/attachmentError.ts` | Error codes, the supported-type list and the picker's `accept` string, in one place. |
| `types/rawTable.ts` | The decoded-file contract. Mirrors the server's `raw-table.types.ts`. |
| `services/bankStatementImportService.ts` | Calls the endpoint, words the result, and picks a free sheet name at Accept time. |
| `components/ConversationPanel/AttachmentChip.tsx` | One attached file: reads and imports it on attach, with an inline password field, status and error text. |
| `hooks/useConversation.ts` | `dispatchBankStatementImport` (the import as a chat turn) and the Accept-time sheet name re-check. |
| `utils/chatSessionStorage.ts` | Keeps imported rows out of the chat history saved to browser storage. |

**Server** (`Server/src`)

| Path | What it does |
|---|---|
| `domain-tools/ingestion/raw-table.types.ts` | The decoded-file contract. |
| `domain-tools/ingestion/statement-values.ts` | Date and amount reading. Money is held in paise so arithmetic is exact. |
| `domain-tools/ingestion/bank-statement-parser.ts` | Header detection, column mapping, row classification. Replaces the old stub. |
| `domain-tools/ingestion/bank-statement-verifier.ts` | Running-balance, totals and closing-balance checks. |
| `bank-statement/` | `POST /ingest/bank-statement`: controller (behind `AuthGuard`), service, DTO, and the rows-to-actions mapper. |
| `common/http/route-body-limits.ts` | Raises the request size limit for this one route to 16 MiB. |
| `common/decorators/skip-log-capture.decorator.ts`, `common/logging/log-body.util.ts` | Keep statement contents out of `logs/requests.log`. |

**Still a stub:** `domain-tools/reconciliation/bank-recon.tool.ts`. Its `BankTxnRow` input has the same shape as the parser's output, so the parser can feed it once it is written.

**Packages added:** `pdfjs-dist` and `xlsx` in `client/package.json` (§6.9). Nothing was added to the server.

---

## 3. Ground rules

These come from decisions already recorded elsewhere. Every slice must respect them.

1. **Office.js stays the only write path** (`ARCHITECTURE.md` AD-1). An attachment is a read-only input. Extracted data reaches the workbook as actions that go through preview, Accept and `guardAgainstOverwrite`, like any other write.
2. **Deterministic code extracts and computes; an LLM never transcribes a number** (`specs/06`, and the `no-llm.guard.spec.ts` test that fails if anything under `domain-tools/` references an LLM client).
3. **Extraction always lands in a new sheet.** It never writes into existing cells.
4. **No claim of success without verification** (`VISION.md`). Every import reports one of: verified, verified with listed exceptions, or unverified with the reason.
5. **A row that cannot be parsed is flagged, never dropped.** The invoice parser already follows this rule and documents why.
6. **Every written row cites its source** (file, and page and line or row number).
7. **Unsupported input is refused with a specific message.** The picker and the parsers must agree on what is supported.
8. **Statement contents stay out of logs, chat history sent to the model, and saved browser storage.** Added while building slice 1; see §6.11.

---

## 4. Pipeline

Every slice uses the same five stages. Only stages 2 and 3 change per document type.

| Stage | What it does | Where it runs |
|---|---|---|
| 1. Decode | File bytes become a raw table: rows of cells for Excel and CSV, rows of positioned text fragments for PDF. No business logic. | Client |
| 2. Detect | Find the header row and classify the document type from its headers. | Server |
| 3. Normalize | Map columns, parse dates and amounts, merge continuation lines, drop page furniture. | Server |
| 4. Verify | Deterministic checks specific to the document type. | Server |
| 5. Write | Build actions for a new sheet, preview, Accept. | Server builds, client writes |

**Why decode on the client.** The raw file never leaves the user's machine, a PDF password never leaves it either, and no multipart upload endpoint is needed. The server receives the same kind of data it already receives today, which is cell contents as JSON.

**Why normalize on the server.** The existing ingestion parsers, the jest fixtures and the no-LLM guard all live in `Server/src/domain-tools/ingestion/`. Test fixtures are JSON raw tables, so no real bank PDF has to be committed to the repo.

---

## 5. Does this need an LLM?

Slice 1 does not. It runs with zero model calls, so an import costs no credits (credits are charged from LLM cost, `TASKS.md` #341).

| Job | LLM? | How it is done |
|---|---|---|
| Read `.xlsx`, `.xls`, `.csv` | No | Spreadsheet library in the client |
| Read text out of a text-based PDF | No | pdf.js text layer, with the x/y position of each fragment |
| Find the header row and map columns | No | Header alias matching |
| Parse dates, amounts, Dr/Cr | No | Rules, checked by the running balance |
| Confirm the import is correct | No | Arithmetic (§6.4) |
| Unknown layout that alias matching cannot map | Optional, later | Ask the user to pick the columns. A later option is one small model call that returns a column mapping only, never values. |
| Scanned or image-only PDF | Yes (OCR or a vision model) | Out of scope for slice 1 |
| Unstructured documents such as invoices and contracts | Likely yes | Future slices |

If an LLM is ever added for column mapping, it sits outside `domain-tools/` and its output is a mapping that deterministic code then applies and verifies.

---

## 6. Slice 1 — Bank statements into a fixed sheet layout

**Status: built October 8, 2026. Live Excel test pending.**

### 6.1 Scope

In scope:

- `.xlsx`, `.xls`, `.csv` and text-based `.pdf`
- One account per file
- Password-protected PDFs, with the password entered in the task pane and used only there
- One new sheet per import, in the layout in §6.2

Out of scope:

- Scanned or image-only PDFs. These are detected (little or no text on the page) and refused with a clear message.
- `.doc`, `.docx`, `.txt`. The picker no longer offers them, and a file of another type is refused with a message.
- Multiple accounts in one file, and merging several statements into one sheet
- Categorising transactions, and bank reconciliation. Both become ordinary agent work on the imported sheet, or later slices.

### 6.2 Fixed sheet layout

Header on row 1, data from row 2, nothing else on the sheet, so the result is a clean table that the agent and `bank_recon` can consume.

| Col | Header | Type | Notes |
|---|---|---|---|
| A | Date | Excel date | Transaction date. Written as a date serial, then formatted `dd-mmm-yyyy`. |
| B | Value Date | Excel date | Blank when the statement has none |
| C | Description | Text | Narration, with continuation lines merged |
| D | Ref No | Text | Cheque number when the statement has one, otherwise the bank's transaction ID. Stored as text so leading zeros survive. |
| E | Debit | Number | Blank when the row is a credit |
| F | Credit | Number | Blank when the row is a debit |
| G | Balance | Number | Negative when overdrawn. Blank when the statement has no balance column. |
| H | Source | Text | Where the row came from, such as `p3 l12` or `row 45` |
| I | Flag | Text | Blank when the row is clean, otherwise a short reason |

- Sheet name: `Bank Statement`. If that name is taken the import uses `Bank Statement 2`, `Bank Statement 3` and so on. An existing sheet is never overwritten.
- Account details (masked account number, period, opening and closing balance) appear in the result card, not on the sheet.
- Each sheet row maps onto `NormalizedBankStatementRow`: `amount` plus `type` becomes Debit or Credit.

### 6.3 Parsing rules

- **Header row.** The first row with a date column, a money column and at least three recognised columns. Labels are matched exactly after normalization, not loosely: a loose match takes an account-details line such as "Date of Issue … Available Balance" for the header.
- **Amount layouts supported:**
  1. separate Debit and Credit columns (also named Withdrawal and Deposit)
  2. one Amount column plus a Dr/Cr column
  3. one signed Amount column
  4. amounts carrying a `Dr` or `Cr` suffix in the cell
- **Amounts.** Currency symbols and thousands separators are stripped, including Indian grouping (`1,25,000.00`). Parentheses and a leading or trailing minus mean negative.
- **Dates.** Named months and ISO dates are unambiguous. For all-numeric dates a value over 12 settles the order; otherwise the reading that keeps the column in order wins, and a tie falls back to day-first.
- **Continuation lines.** A row with description text and nothing else is merged into the row above. In a PDF it must also sit close under that row, which is what tells a wrapped description from a footer.
- **Non-transaction rows.** Opening balance, closing balance, totals and repeated page headers and footers are excluded from the transactions and used for the checks in §6.4. Parsing stops at a grand total line.
- **PDF columns.** Amounts are assigned by right edge because they are right-aligned. Text is assigned by overlap with its heading. Each fragment only goes to a column of its own type (date, money or text).
- **A "Type" column** is treated as Dr/Cr only when at least 80% of its values are Dr/Cr.
- **Row order.** Some statements list newest first. The source order is preserved.

### 6.4 Verification

All arithmetic, exact to the paisa.

1. **Running balance.** For each row, previous balance plus credit minus debit equals this row's balance. Checked in whichever direction the statement runs.
2. **Totals.** Summed debits and credits equal the statement's own total line, when it has one.
3. **Closing balance.** The last row's balance equals the stated closing balance, when it has one.
4. **Completeness.** Every line after the header is a transaction, a merged continuation line, a recognised non-transaction line, or is reported as left out.

Result states shown to the user:

| State | Meaning |
|---|---|
| Verified | Every row ties and nothing was left out |
| Verified with exceptions | Listed rows fail a check. They are imported with a reason in the Flag column. |
| Unverified | The statement has no balance column, so there is nothing to check against. The card says so. |

When a row's amount ties only with the opposite sign, the printed balance wins and the row's side is corrected. The count is reported as `directionFixes`.

### 6.5 User flow

1. The user clicks the paperclip and picks a file. A small capsule appears at the top of the message box, above the text: an icon and the file name. The icon is a spinner while the file is read.
2. The file is decoded in the task pane straight away and then **waits in the box**, like an attachment in any chat. The icon shows its type: a red document for a PDF, a green sheet for Excel or CSV.
3. A protected PDF shows a lock on the capsule and a short password field beside it, already focused. The user types the password and presses Enter, which only unlocks the file.
4. The cursor is in the message box, whose placeholder reads "Ask about this statement, or press Enter to import it". The user either presses Enter, or types a question first and then presses Enter (or clicks Send).
5. The thread shows one message: what the user typed, with the file as a chip on it ("Import this bank statement" when nothing was typed). The router and the model are not involved in the import.
6. The card under it shows the row count, period, masked account number, balances, totals, the verification result and the first rows to check.
7. The user accepts. Office.js creates the sheet, writes the rows and makes it the active sheet.
8. If a question came with the file, its answer now appears directly under the card, in the same exchange, with no second user message. It goes through the ordinary chat path with a fresh read of the workbook, so it uses credits like any chat message. The import itself still uses none.
9. From here the sheet is ordinary workbook data, and the existing agent can work on it.

What happens to the question in the other cases:

| Case | The question |
|---|---|
| The import is rejected | Dropped. The card says "Reject discards both". |
| The file is refused (not a statement) | Put back in the message box, so it is not lost. |
| Accept fails | Not asked. The card returns to pending. |
| Two files are attached | Goes with the first. The second imports afterwards on its own. |
| The file is still locked when Enter is pressed | Sent as a normal chat message. The locked file stays attached. |

Files import one at a time. On the new-chat screen the message box keeps its height when a file is attached. A file that cannot be read keeps its capsule, with the reason and a Retry.

**Why the answer waits for Accept.** The question is answered from the workbook, by the same pipeline that answers any question about a sheet, so the statement has to be in the workbook first, and nothing is written without Accept (§3 rule 1). Answering from the file alone, with nothing written, is a separate slice (§7).

*History, all October 8:*
- *First build: an Import button on the chip.*
- *After the first live test the owner asked for it to go, so attaching imported at once (password files after Enter in the password field).*
- *That felt abrupt and left no way to type a question with the file. The owner asked for the password to only unlock, for the main Enter to send, and for a question typed with the file to be answered. Every file now waits for Send.*

### 6.6 Build order

| # | Step | Status |
|---|---|---|
| 1 | Spike: decoding inside the Excel task pane | **Partly done.** Both libraries bundle as lazy chunks in the production build and run in Node. Not yet run inside Excel. |
| 2 | Raw table contract | Done |
| 3 | Parser | Done |
| 4 | Verifier | Done |
| 5 | Fixtures | Done for the Federal Bank PDF layout. Other banks need samples. |
| 6 | Endpoint and mapper | Done, without a ChangeSet (§6.11) |
| 7 | Client decode | Done |
| 8 | Client UI | Done |
| 9 | Live test in Excel | **Not done.** Checklist in §6.12. |

### 6.7 Done means

| Criterion | Result |
|---|---|
| Each supported bank fixture imports with state Verified | Met for the one fixture (Federal Bank PDF layout) |
| A deliberately corrupted row imports as Verified with exceptions and names that row | Met (parser spec) |
| A scanned PDF and an unsupported file type are each refused with a specific message | Met in unit tests |
| An import into a workbook that already has a `Bank Statement` sheet leaves that sheet untouched | Met in unit tests (name chosen when built, and re-checked on Accept). Needs the live test. |
| Reject leaves the workbook unchanged | True by design: nothing is written before Accept (`TASKS.md` #148). Needs the live test. |
| Revert removes the imported sheet | **Not built.** The import is not registered as a change set (§6.11, `TASKS.md` #365). To undo, delete the sheet. |
| No model call is made at any point in the import | Met. No LLM module is imported on this path, and the no-LLM guard test covers the parser. |

### 6.8 Risks, and what happened to each

| Risk | Outcome |
|---|---|
| **Request size.** A long statement can exceed Fastify's 1 MiB default. | Real: six months measured 0.4 MB. The route now allows 16 MiB (`route-body-limits.ts`), and a test confirms every other route keeps the default. |
| **Large writes.** A statement can run to thousands of rows. | The rows go in one table write. Imports are capped at 30,000 transactions with a message asking the user to split the period. 834 rows is about 90 KB of actions. Not yet timed in Excel. |
| **Dates on write.** Excel re-parses values on entry (`TASKS.md` #85). | Avoided: dates are written as date serial numbers and formatted afterwards, so there is nothing for Excel to re-parse. |
| **Text that looks like a number or a formula.** | Text columns are set to Text format before the write, and a value starting with `=`, `+`, `-` or `@` gets a leading apostrophe. Needs the live test. |
| **Spreadsheet library source.** | `xlsx` 0.20.3 is installed from SheetJS's own distribution. `npm audit` reports nothing against it or `pdfjs-dist`. |
| **Files that lie about their type.** | An HTML table saved as `.xls` is covered by a decoder test. |

### 6.9 Packages

Two new packages, both in `client/package.json`. The server needs none.

| Package | Version | Used for | Licence |
|---|---|---|---|
| `xlsx` (SheetJS Community Edition) | 0.20.3, from `cdn.sheetjs.com` | Reading `.xlsx`, `.xls` and `.csv` into rows of cells | Apache-2.0 |
| `pdfjs-dist` (Mozilla pdf.js) | 6.4.299 | Reading text and its position from a text-based PDF, and opening password-protected PDFs | Apache-2.0 |

- Both are loaded with a dynamic `import()` on first use, so they are separate chunks (about 0.5 MB each, plus a 1.3 MB PDF worker) and are not in the task pane's startup bundle.
- The pdf.js **legacy** build is used, because older Office webviews lack JavaScript features the default build needs.
- The server parser and verifier are plain TypeScript.
- Not needed for slice 1: an upload package (`@fastify/multipart`, `multer`), an OCR package, a separate CSV package, or any LLM SDK.

### 6.10 Sample 1 — Federal Bank savings account PDF (checked October 8, 2026)

The owner's own six-month statement, kept in `Cellix/samples/`, which is outside the `Root`, `Server` and `client` repos. It must never be committed. No personal detail from it is recorded here.

**Result with the shipped code.** The real PDF was run through the add-in's own decoder (in Node, not in Excel) and then the server parser, verifier and mapper:

- 28 pages, 834 transactions, no line left unaccounted for
- every row passes the running-balance check, with no direction corrections
- summed withdrawals and deposits equal the statement's own `GRAND TOTAL` line
- the password prompt works: no password and a wrong password are each reported correctly
- the same 834 transactions re-exported as `.xlsx`, `.xls` and `.csv` read back identically

**The committed fixture** (`fixtures/synthetic-federal-bank-statement.rawtable.json`) keeps this statement's positions, three-line header, page footers, totals line and trailer, with every name, number and amount replaced by synthetic values. It was checked for leaks against the real file.

**What this layout requires of the parser**

| Finding | Consequence |
|---|---|
| A plain text dump scrambles page 1: the dates and Tran IDs come out as separate blocks, detached from their rows. | Rows must be rebuilt from x/y positions. Plain text extraction is not usable. |
| The column header appears on page 1 only. Pages 2 to 28 start straight with data. | Column boundaries found on page 1 carry over to later pages. |
| The header is three lines: "Tran" above "Type", "DR" above "/CR". | Lines just above and below the main header line are merged into it. |
| An account-details line reads "Effective Available Balance … Date of Issue". | Header labels are matched exactly, or this line is taken for the header. |
| Columns shift sideways by up to about 4 points between pages. | Match columns with a tolerance, not exact x values. |
| Amounts are right-aligned. A six-digit deposit starts to the left of the `Deposits` header. | Assign amount columns by right edge. A left-edge threshold misfiles large amounts. |
| The `DR/CR` column is the sign of the balance. It reads `Cr` on every row. | It is not the transaction direction. Direction comes from the Withdrawals and Deposits columns. |
| "Tran Type" holds `TFR`, `FT`, `CASH`. | A "Type" column is not assumed to be Dr/Cr. |
| Almost every transaction is two lines, and the description wraps mid-word. | A part ending or starting on punctuation is rejoined with no space, otherwise with one. |
| The page footer sits about 30 points under the last row; a wrapped description sits about 8. | The gap separates the two. |
| Value date differs from the transaction date on 12 rows. | The Value Date column earns its place. |
| Tran IDs come in more than one shape, and the Cheque Details column is empty throughout. | Ref No is whatever the bank printed. Cheque rows are untested. |
| The statement has an `Opening Balance` row and a `GRAND TOTAL` row. | Both checks in §6.4 can run in full. |
| Dates are `DD-MON-YYYY` and amounts have no thousands separators. | No date ambiguity in this layout. |

**Smoke test, October 8.** 42 files were run through the decoder and the live import route (`TASKS.md`, "Bank Statement Smoke Test"). 39 passed, including this real PDF, three PDF layouts built for the test, XLSX, XLS, CSV, HTML and tab-separated `.xls`, the four amount layouts, overdrawn and newest-first statements, a wrong balance, a missing row, 12,000 rows in 0.6 s, and every refusal. The 3 that failed are one limitation: a description that a bank wraps in the middle of a word is rejoined with a space (`TASKS.md` #379). This Federal layout is unaffected, because it only breaks at spaces, hyphens and slashes.

**Not covered by this sample:** other banks, a real Excel or CSV export from any bank, cheque transactions, an overdrawn (`Dr`) balance, and a statement with no opening balance row. The parser handles these in unit tests on made-up tables, which is not the same as a real file.

### 6.11 Decisions made while building

| Decision | Why |
|---|---|
| **The import is not registered as a change set**, so it has no Revert and no audit record. | The change-set path stores every cell and re-reads each one after Accept. For a statement that is tens of thousands of cells in one database document, and a read-back that has never been tried against date serials and Text-formatted cells. It follows GST reconciliation, which creates its sheet the same way. Follow-up: `TASKS.md` #365. |
| **Statement contents are kept out of the request log.** | `logs/requests.log` records request and response bodies. For this route the response is not captured (`@SkipLogCapture`) and the request's `rawTable` is logged as a row count only. |
| **Chat history sent to the model gets one line about the import**, not the balances and totals. | History is included in later prompts. The figures are shown to the user in the answer, which is not sent anywhere. |
| **Imported rows are not saved to browser storage.** | Chat sessions are saved to `localStorage` with every card's actions. An import card holds the whole statement, which would leave a second copy there indefinitely and can exceed the storage quota, stopping all chats from saving. The saved copy drops the rows. A card still pending when the pane closes comes back closed, with a note to attach the file again. |
| **The sheet name is checked twice**, when the card is built and again on Accept. | The workbook can change between the two. On Accept a taken name moves the import to the next free one. |
| **An unknown layout is refused**, with a message, instead of asking the user to map columns. | Open decision 6 recommended a mapping step. It was not built in this slice. Follow-up: `TASKS.md` #367. |
| **The sheet is added at the end of the workbook**, not after the active sheet. | The server accepts an `activeSheetName`, but the client does not send one yet. |

### 6.12 Live Excel test checklist

Nothing below has been run. Each item is something the automated tests cannot see.

1. Attach the Federal Bank PDF. The chip appears above the text and reads "Reading…", then a password field appears under it with the cursor in it.
2. A wrong password shows an error and clears the field. The right password and Enter start the import. A file with no password imports with no further input.
3. The answer reports 834 transactions, the period, the masked account number, and "all 834 balances tie, and the totals match the statement".
4. Before accepting, confirm the workbook has no new sheet.
5. Accept. A sheet named `Bank Statement` appears with 834 rows under a frozen header.
6. Dates in columns A and B show as dates (`11-Apr-2026`), sort as dates, and are right for the first and last row.
7. Column D keeps any leading zeros and shows no green "number stored as text" surprises that change the value.
8. Amount columns are numbers: `=SUM(E:E)` and `=SUM(F:F)` equal the totals in the answer.
9. No cell shows a stray leading apostrophe, and no description was turned into a formula or `#NAME?`.
10. Import the same file again. It lands in `Bank Statement 2` and the first sheet is unchanged.
11. Start an import, add a sheet named `Bank Statement 3` by hand before accepting, then accept. It lands in the next free name.
12. Reject an import. The workbook is unchanged.
13. Attach a `.docx`. It is refused with a message. Attach a scanned PDF. Import refuses it with a message.
14. Import a `.csv` and an `.xlsx` statement.
15. Close and reopen the task pane with an import still pending. The card is closed with a note, and the chat history still loads.
16. Check `Server/logs/requests.log`: the import's line has a row count and no transactions.
17. Repeat steps 1 to 5 in Excel on the web and on a Mac, where the webview is different.
18. Note how long Accept takes for 834 rows.
19. On the deployed server, import a statement over 1 MB once decoded (roughly 15 months of this account). The app allows 16 MiB on this route, but a reverse proxy or hosting platform in front of it may have its own lower limit and answer 413 first.

### 6.13 After the import: what works and what does not (smoke test, October 8)

Forty prompts were sent through the real chat pipeline against a 120-row imported sheet with known answers. The import hands over a correct sheet; what happens next is the ordinary assistant, and it is uneven.

| Kind of request | Result |
|---|---|
| Changes that Excel computes (Month, Net and Category columns, monthly summary, per-payee summary, total row, highlight, duplicates, sort, copy matching rows, delete matching rows, rename, hide columns, number format) | Work. Formulas and ranges were checked; the monthly summary was executed and matches to the paisa. |
| Questions whose answer needs every row (totals, top N, sums by payee or type, biggest deposit, period, lowest balance) | **Fixed the same day (`TASKS.md` #389).** The model now only translates the question into a query; code computes it over every row and writes the answer. The same 21 questions went from about half right to 21 of 21 on three runs. |
| Anything involving a date in the answer | Fixed for computed answers (#389). A question the engine declines, such as the opening balance, is still answered by the model in prose and can show a serial (#390). |
| Filter buttons, Excel table, balance chart, balance re-check column | Wrong or incomplete (#384, #385, #387). |

A computed answer always ends with "Worked out from all N rows of <sheet>" and says in words what was added or ranked. An answer without that line came from the model reading the sheet and should be treated with more care.

---

## 7. Candidate slices (not planned, not ordered)

- Scanned bank statements (OCR or vision)
- More bank layouts, each from a real sample
- Several statements merged into one sheet, and multi-account files
- Bank reconciliation against the books, using the `bank_recon` stub
- Form 26AS, GSTR-2B and Tally exports. Stubs or parsers for these already sit in `domain-tools/ingestion/`.
- Invoices and other unstructured PDFs
- Answering a question from an attached file alone, with nothing written to the workbook. Today a question typed with a statement is answered after the import is accepted (§6.5); this would answer without creating a sheet. It needs the parsed rows to reach the model without a workbook behind them, which the chat pipeline does not support yet.

---

## 8. Open decisions

| # | Decision | Status |
|---|---|---|
| 1 | Decode on the client and normalize on the server, or upload the raw file | Built as client decode, server normalize |
| 2 | Is the layout in §6.2 right, including the Flag column | Built as drawn. Change it in `bank-statement-to-actions.mapper.ts` if not. |
| 3 | Import as its own button on the chip, or run it when the chat message is sent | Built as its own button |
| 4 | Which banks are supported first | Federal Bank PDF. Each further bank or format needs its own sample. |
| 5 | Does extraction need CA sign-off before release | **Open.** The old stub's comment asked for a CA-reviewed fixture set. Extraction is transcription checked by arithmetic, not compliance logic, so the recommendation is that fixture review is enough. This is the owner's call. |
| 6 | Unknown layout: ask the user to map columns, or add a model call for the mapping | **Open.** Neither is built; an unknown layout is refused (`TASKS.md` #367). |
| 7 | Ref No when the statement has both a cheque column and a bank transaction ID, and whether to keep the bank's transaction type | Built as: cheque number when present, otherwise the transaction ID. The transaction type is dropped. |

---

## 9. Other documents

Updated October 8, 2026 with slice 1:

- `PRD.md` §5.1: attachment import does not reopen D1.
- `ARCHITECTURE.md` AD-10: attachments are a read-only input, not a second write path.
- `TASKS.md` #363 to #369.
- `CODEBASE_ANALYSIS.md` §3.22.
- `CLAUDE.md`: the import path and its invariants.

---

## 10. Change log

| Date | Change |
|---|---|
| 2026-10-08 | Document created. Slice 1 (bank statements) proposed. |
| 2026-10-08 | Added §6.9 (packages). |
| 2026-10-08 | Added §6.10: first real sample (Federal Bank PDF) checked, all rows tie. Open decisions 4 and 7 updated. |
| 2026-10-08 | Slice 1 built. §2 rewritten as the current file map. §6.6 to §6.8 record what was done. Added §6.11 (decisions made while building) and §6.12 (live test checklist). |
| 2026-10-08 | First live Excel run by the owner: PDF read in the task pane, password accepted, 17 actions applied in about one second, no errors logged. Items 1 to 5 of §6.12 are therefore seen working from the logs; how the cells look was not reported. |
| 2026-10-08 | Import button removed at the owner's request: a file now imports as soon as it is attached (§6.5). Chip restyled and moved above the text. |
| 2026-10-08 | Flow changed twice more at the owner's request: the password only unlocks, every file waits for Send, and a question typed with the file is asked after Accept (§6.5). |
| 2026-10-08 | Smoke test: 42 import files and 40 chat prompts. Results in §6.10 and new §6.13; findings filed as `TASKS.md` #379 to #387. |
| 2026-10-08 | Single-message exchange for a question sent with a file (`TASKS.md` #388). Questions about a sheet's rows are now computed in code (`TASKS.md` #389); §6.13 updated. |
