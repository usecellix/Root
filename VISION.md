# VISION.md

> **Source of truth for the product vision.**
> Keep this document short and stable. Detailed requirements belong in `PRD.md`, architecture in `ARCHITECTURE.md`, and implementation work in `TASKS.md`.

## Product Vision

Build an **AI-native spreadsheet agent for Excel** that can understand, create, edit, analyze, and transform spreadsheets through natural-language instructions.

The user should be able to open an Excel workbook and simply tell the agent what they want:

> "Clean this data, create a summary by region, build a dashboard, and highlight the regions where revenue dropped more than 10%."

The agent should understand the workbook, plan the work, execute the required changes, verify the result, and return a reliable finished workbook — without randomly overwriting existing data, breaking formulas, corrupting formatting, or leaving the workbook in an inconsistent state.

The product should feel less like **ChatGPT inside Excel** and more like **an autonomous analyst who can actually operate Excel**.

---

## Problem Statement

Finance professionals, Chartered Accountants, analysts, accountants, consultants, and business users spend significant amounts of time manually manipulating Excel workbooks.

Common tasks include:

* Cleaning and restructuring data
* Writing and fixing formulas
* Creating reports
* Creating dashboards
* Building financial models
* Creating summaries
* Formatting spreadsheets
* Comparing datasets
* Creating charts and visualizations
* Extracting information from files
* Updating existing reports
* Performing calculations and analysis
* Creating new Excel workbooks
* Repeating complex spreadsheet workflows

Existing AI assistants can generate formulas or answer questions, but the major problem is **reliable execution inside real-world Excel workbooks**.

The product must therefore prioritize:

**Accuracy → Reliability → Safety → Verifiability → Speed**

A successful task is not merely an AI response. A successful task means the **actual spreadsheet is correctly modified and remains usable.**

---

## Product Inspiration

The product experience should be inspired by the workflow of **Shortcut AI**: an autonomous Excel agent that can plan and execute complex spreadsheet tasks, make targeted edits, create models and dashboards, and provide mechanisms such as checkpoints, reviewability, and non-destructive changes.

Reference:

[Shortcut AI](https://shortcut.ai/?utm_source=chatgpt.com)

However, this product should develop its own architecture, UX, capabilities, and differentiation rather than simply copying Shortcut.

---

## Target Users

### Primary Users

* Chartered Accountants
* Finance professionals
* Financial analysts
* Accountants
* Investment/finance teams
* Business analysts
* Operations professionals

### Secondary Users

* Consultants
* Small-business owners
* Managers
* Students
* General Excel power users

### What They Use Today

* Microsoft Excel manually
* Excel formulas and VBA
* ChatGPT/Claude/Copilot for formula assistance
* Manual reporting workflows
* Python/scripts
* Analysts or colleagues performing repetitive spreadsheet work

---

## Core Value Proposition

**The product lets users tell Excel what they want in natural language, and the AI agent safely performs the work inside their files.**

Instead of:

> "How do I create this formula?"

the user should be able to say:

> "Create the formula."

Instead of:

> "How do I make a dashboard?"

the user should be able to say:

> "Create a management dashboard from this data."

Instead of:

> "How do I clean these duplicate records?"

the user should be able to say:

> "Clean this dataset and remove the duplicates."

The agent should perform the work rather than merely explain how the user can perform it.

---

# Core Product Principle

## Anything the user asks that the system can safely execute, the agent should execute.

The system should support both simple and complex requests.

Examples:

* "Add a total column."
* "Fix the broken formulas."
* "Remove duplicate customers."
* "Clean this dataset."
* "Summarize this workbook."
* "Create a dashboard."
* "Create a P&L statement."
* "Compare these two sheets."
* "Create a pivot table."
* "Create charts showing monthly revenue."
* "Format this report professionally."
* "Create a new workbook from this data."
* "Build a financial model."
* "Find unusual transactions."
* "Highlight expenses above budget."
* "Create a summary for management."
* "Update this report using the new data."
* "Find and fix formula errors."
* "Create a forecast."
* "Create a variance analysis."

The agent should determine the appropriate sequence of operations instead of requiring the user to specify every individual Excel action.

---

# Top 3 Use Cases — v1

### 1. Edit Existing Excel Files

User provides an existing workbook and asks the agent to modify it.

Examples:

* Clean data
* Fix formulas
* Add formulas
* Modify formatting
* Add/remove columns
* Create summaries
* Create charts
* Create pivot tables
* Update reports
* Analyze existing data

**Critical requirement:** Existing workbook content must not be accidentally destroyed.

---

### 2. Create Reports, Summaries & Dashboards

The user provides data and asks the agent to create a useful output.

Examples:

> "Create a sales dashboard showing revenue, profit, growth, and regional performance."

> "Create a monthly management summary."

> "Create a dashboard with charts for revenue, expenses, and EBITDA."

The agent should create the required sheets, formulas, tables, charts, formatting, and supporting calculations.

---

### 3. Create New Excel Workbooks

The user should be able to start from nothing.

Examples:

> "Create a monthly expense tracker."

> "Build a three-statement financial model."

> "Create a budget vs actual report."

> "Create an employee payroll analysis."

The agent should create a complete, usable workbook rather than merely returning instructions.

---

# Reliability Is a Core Feature

The most important product requirement is:

## **The agent must not break the user's spreadsheet.**

AI-generated changes must be treated as potentially unsafe until verified.

The system should therefore:

* Understand workbook structure before modifying it
* Identify affected sheets/ranges
* Preserve unrelated data
* Avoid accidental overwrites
* Preserve formulas where appropriate
* Preserve formatting where appropriate
* Validate formulas after modification
* Detect formula errors
* Validate references
* Check that expected outputs exist
* Detect unintended changes
* Create checkpoints before major modifications
* Allow undo/rollback
* Clearly show what changed
* Re-run or repair failed operations when possible
* Never claim success when verification failed

A response such as:

> "Done!"

is **not success** unless the resulting workbook has been verified.

---

# Agent Behavior

The agent should operate through a workflow similar to:

**Understand → Plan → Execute → Verify → Repair → Report**

### 1. Understand

Inspect:

* Workbook structure
* Worksheets
* Used ranges
* Tables
* Formulas
* Formatting
* Named ranges
* Charts
* Existing relationships/dependencies
* Relevant data

### 2. Plan

Convert the user's natural-language request into a structured execution plan.

For complex tasks, the plan should identify:

* Required operations
* Dependencies
* Files/sheets involved
* Cells/ranges affected
* Expected outputs
* Validation requirements

### 3. Execute

Perform the required spreadsheet operations.

### 4. Verify

Check whether the resulting workbook satisfies the requested task.

### 5. Repair

If verification detects a problem, the agent should attempt to fix the problem before reporting completion.

### 6. Report

Tell the user:

* What was changed
* Where it was changed
* What was created
* Any important assumptions
* Any unresolved issues

---

# Safety & Non-Destructive Editing

The agent should follow a **never-destroy-user-work principle**.

Before making significant changes:

* Create a checkpoint/version
* Identify the intended modification scope
* Preserve unrelated workbook content
* Avoid overwriting existing values unless explicitly required
* Prefer targeted edits
* Maintain formulas and dependencies whenever possible

Users should be able to:

* Review changes
* Undo changes
* Restore a previous checkpoint
* Understand which cells/sheets were modified

Shortcut similarly emphasizes precise edits, checkpoints, auditability, and non-destructive changes; these should be treated as important product requirements rather than optional polish.

---

# File Creation

The agent should be capable of creating files from user instructions.

Initial priority:

* `.xlsx`
* `.xlsm` where technically supported
* `.csv`

Future:

* PDF
* PowerPoint
* Other business documents

The user should be able to say:

> "Create a new Excel file containing a monthly sales dashboard."

and receive a usable file.

---

# Excel Intelligence

The system should understand spreadsheets as structured systems rather than treating them as plain tables.

It should understand:

* Cells
* Ranges
* Rows
* Columns
* Worksheets
* Tables
* Formulas
* Formula dependencies
* Named ranges
* Formatting
* Charts
* Pivot tables
* Merged cells
* Hidden rows/columns
* Workbook structure
* Financial-model conventions

The long-term goal is for the agent to understand **why a spreadsheet is structured the way it is**, not simply read cell values.

---

# User Experience

The primary interaction should be a natural-language AI interface connected directly to the user's workbook.

The user should not need to know:

* Excel formulas
* Python
* VBA
* APIs
* Spreadsheet programming
* Agent internals

The experience should be:

**Open workbook → Tell agent what you want → Agent works → Review result → Continue**

The user should be able to continue the conversation:

> "Now add a chart."

> "Actually use EBITDA instead."

> "Move the dashboard to a new sheet."

> "Make it look more professional."

> "Undo the last change."

The agent should retain the relevant workbook/task context throughout the workflow.

---

# Complexity Handling

Simple requests should execute immediately.

Complex requests should trigger deeper planning.

For example:

> "Create a DCF model from this company's financial statements and add sensitivity analysis."

The agent should internally break this into appropriate steps instead of attempting one uncontrolled operation.

The architecture should support specialized stages/agents for:

* Planning
* Spreadsheet understanding
* Execution
* Verification
* Error recovery

A multi-stage architecture is important because spreadsheet correctness cannot depend solely on one LLM response. Shortcut publicly describes a planning/execution/verification architecture for this type of workflow.

---

# Explicit Non-Goals — v1

To prevent scope explosion, v1 does **not** need to solve everything.

Initially prioritize:

* Excel
* Reliable workbook editing
* File creation
* Data cleaning
* Formulas
* Reports
* Summaries
* Dashboards
* Charts
* Spreadsheet analysis
* Safe execution
* Verification
* Undo/checkpoints

Defer unless required by the PRD:

* Google Sheets
* Real-time multi-user collaboration
* Complex enterprise permissions
* Fully autonomous scheduled workflows
* Large-scale external data integrations
* PowerPoint/PDF generation
* Advanced web research
* Mobile applications

These can become future roadmap items.

---

# What "Done" Looks Like for v1

A user can open or upload an Excel workbook, describe a task in natural language, and the agent can:

1. Understand the workbook.
2. Understand the user's request.
3. Create an execution plan for complex requests.
4. Modify or create the required workbook content.
5. Preserve unrelated existing content.
6. Validate the changes.
7. Detect and repair common failures.
8. Provide a clear summary of the work performed.
9. Allow the user to undo/restore changes.
10. Produce a working Excel file.

**The core success criterion is not how impressive the AI response sounds.**

The core success criterion is:

> **The resulting Excel workbook is correct, usable, and safe.**

---

# Success Metrics

### Reliability

* Task completion rate
* Verified task completion rate
* Workbook corruption rate
* Unintended modification rate
* Formula error rate
* Agent failure rate
* Successful recovery rate

### Accuracy

* Formula correctness
* Calculation correctness
* Data transformation correctness
* Dashboard/report correctness

### User Experience

* Time to first successful task
* Percentage of tasks completed without manual correction
* Average number of user corrections per task
* User acceptance rate of AI changes
* Undo/revert frequency

### Product Usage

* Daily/weekly active users
* Tasks per user
* Repeat usage
* Successful tasks per session

---

# Product North Star

## "If a skilled Excel analyst could reasonably do it through Excel, the user should eventually be able to ask our agent to do it through natural language."

The product should move toward a world where users don't think:

> "How do I do this in Excel?"

They think:

> **"I'll just ask the agent to do it."**

---

*Last updated: August 17, 2026 — update this whenever the fundamental product vision materially changes.*


# Complex & Large Natural-Language Requests

The product must support **large, detailed, multi-step prompts**, not only simple spreadsheet commands.

Users should be able to describe an entire spreadsheet workflow, reporting system, financial model, or business process in natural language, and the agent should transform that description into a complete, functional Excel solution.

The user should **not** have to manually break a large request into individual commands.

---

## Example: Hospitality / Payment Management Workbook

A user may provide a request such as:

> "I want a workbook for managing guest bookings and payments. Create separate sheets for every month of the year. I want a Main sheet containing an overview of all the monthly sheets. The Main sheet should also contain a dashboard showing important information such as total bookings, revenue, payment status, occupancy, and monthly performance.
>
> Each monthly sheet should contain:
>
> * Unit No
> * Guest
> * Guest Name
> * Check In
> * Check Out
> * Rate Per Night
> * Total Amount
> * Source
> * Payment Status
> * Bank Account
>
> I need to be able to record payments and track payment-related information. The monthly sheets should calculate the required totals automatically, and the Main sheet should aggregate the information from all months.
>
> Create formulas, summaries, formatting, charts, and a dashboard. Make the workbook easy to use and ensure that changes made to the monthly sheets are correctly reflected in the Main sheet and dashboard."

The agent should understand that this is **one large task consisting of many dependent subtasks**.

It should automatically determine the required implementation.

---

# Large Prompt Processing

For large requests, the agent should internally transform the user's request into:

**Requirements → Structure → Dependencies → Plan → Implementation → Verification**

For example:

### Step 1 — Extract Requirements

Identify:

* Number of worksheets
* Worksheet names
* Required columns
* Data types
* Relationships between sheets
* Required calculations
* Required summaries
* Dashboard requirements
* Formatting requirements
* User workflows
* Inputs vs calculated fields
* Expected outputs

### Step 2 — Design Workbook Structure

Determine an appropriate workbook architecture.

For the example above:

```text
Workbook
│
├── Main / Dashboard
│
├── January
├── February
├── March
├── April
├── May
├── June
├── July
├── August
├── September
├── October
├── November
└── December
```

The agent should determine whether additional supporting sheets are necessary.

For example:

```text
Workbook
│
├── Main / Dashboard
├── January
├── February
├── ...
├── December
├── Lists / Configuration
└── Calculations / Data
```

The agent should be able to make these architectural decisions when they improve reliability and maintainability.

---

# Dependency Understanding

The agent must understand relationships between different parts of the workbook.

For example:

```text
Monthly Sheets
      ↓
Consolidated Data
      ↓
Main Sheet
      ↓
Dashboard
```

If a user adds a booking to the March sheet, the system should understand that:

```text
March booking
      ↓
March totals
      ↓
Annual totals
      ↓
Main sheet
      ↓
Dashboard
```

should update accordingly.

The agent must not create a dashboard that is disconnected from the underlying data.

---

# Multi-Sheet Operations

Large prompts may require modifications across many worksheets.

The agent should be capable of:

* Creating multiple sheets
* Renaming sheets
* Duplicating structures
* Applying consistent formatting
* Creating formulas across sheets
* Linking sheets
* Consolidating data
* Creating summary sheets
* Creating dashboards
* Creating charts
* Creating dropdowns/data validation
* Creating conditional formatting
* Maintaining consistent structures
* Updating multiple dependent sheets

The agent should understand that these operations are part of **one system**, rather than treating each sheet independently.

---

# Business Workflow Understanding

The agent should be able to infer the workflow behind a user's request.

For example, in the hospitality workbook:

```text
Booking created
        ↓
Guest information recorded
        ↓
Check-in / Check-out recorded
        ↓
Rate calculated
        ↓
Total amount calculated
        ↓
Payment recorded
        ↓
Payment status updated
        ↓
Bank account recorded
        ↓
Monthly totals updated
        ↓
Annual summary updated
        ↓
Dashboard updated
```

The agent should build the workbook around the workflow rather than simply creating columns that match the prompt.

---

# Intelligent Clarification

The agent should not blindly guess when an important requirement is ambiguous.

For example, if the user says:

> "Calculate the total amount."

but does not specify whether the calculation should be:

```text
Rate × Number of Nights
```

the agent should determine whether the information available in the workbook makes the intended calculation obvious.

If it cannot determine the correct behavior safely, it should ask a concise clarification question.

However, the agent should **avoid unnecessary questions** when the intended behavior can reasonably be inferred from the request and workbook context.

---

# Large Prompt Planning

Before executing a complex request, the agent should internally create a structured plan.

Example:

```text
Task: Build annual hospitality booking and payment workbook

1. Create workbook structure
2. Create Main/Dashboard sheet
3. Create 12 monthly sheets
4. Define standardized monthly schema
5. Add required columns
6. Add data validation
7. Add formulas
8. Implement payment tracking
9. Create annual aggregation
10. Create dashboard metrics
11. Create charts
12. Apply formatting
13. Validate formulas
14. Validate cross-sheet references
15. Test sample records
16. Verify dashboard calculations
17. Present completed workbook
```

The user does not necessarily need to see this entire internal plan, but the system must be capable of planning work at this level.

For complex tasks, the user may optionally be shown a concise plan before execution.

---

# Incremental Execution for Large Tasks

Large requests should **not** be executed as one uncontrolled AI operation.

The agent should execute complex tasks in logical stages.

Example:

```text
Phase 1
Workbook structure

↓

Phase 2
Monthly sheets

↓

Phase 3
Formulas & calculations

↓

Phase 4
Main sheet / consolidation

↓

Phase 5
Dashboard

↓

Phase 6
Formatting & usability

↓

Phase 7
Verification
```

After each important stage, the system should be able to verify that the workbook remains valid.

This reduces the chance that one failed operation causes the entire workbook to break.

---

# Large Prompt Recovery

If a large task partially fails, the agent should **not start blindly from scratch**.

It should:

1. Identify what has already been successfully completed.
2. Identify what failed.
3. Determine dependencies affected by the failure.
4. Repair the failed portion.
5. Re-run required validation.
6. Continue from the last valid state.

For example:

```text
12 monthly sheets created ✓
Monthly formulas created ✓
Main sheet created ✓
Dashboard creation failed ✗

↓

Repair dashboard

↓

Verify dashboard references

↓

Verify workbook

↓

Complete task ✓
```

---

# User Can Modify Large Projects Incrementally

After creating a large workbook, users should be able to continue giving instructions.

For example:

> "Now add a cancellation status."

Then:

> "Add a cancellation report to the dashboard."

Then:

> "Add a monthly occupancy percentage."

Then:

> "Add a chart comparing revenue by booking source."

Then:

> "Change the dashboard layout."

The agent must understand the **existing workbook and previously implemented structure** and make targeted modifications rather than rebuilding everything unnecessarily.

---

# Existing Workbook + Large Prompt

Large prompts should also work on existing workbooks.

For example:

> "I already have January through December sheets. Keep the existing data. Standardize all the sheets so they use the same columns, create a Main sheet that consolidates everything, and build a dashboard showing revenue, bookings, payment status, and monthly performance."

The agent should:

1. Inspect the existing workbook.
2. Understand its current structure.
3. Preserve existing data.
4. Detect differences between sheets.
5. Normalize the structure where appropriate.
6. Create the required Main sheet.
7. Connect the monthly data.
8. Build the dashboard.
9. Validate the result.

It must **not assume that a workbook is empty just because the user asks for a new structure**.

---

# Complex Prompt Principle

## The user describes the desired outcome. The agent figures out how to build it.

Users should not need to know:

* Which sheets to create
* Which formulas to use
* How to connect sheets
* How to build the dashboard
* Which ranges to reference
* How to structure calculations
* How to format the workbook
* How to validate formulas
* How to maintain dependencies

The agent should handle the implementation details.

The user should primarily communicate:

**What they want the spreadsheet to accomplish.**

---

# Definition of Success for Large Prompts

A complex prompt is successful only when the **entire requested workflow works together**.

For example, for the hospitality workbook:

* All required monthly sheets exist.
* All monthly sheets follow the required structure.
* Users can record bookings.
* Users can record payments.
* Payment status works correctly.
* Calculations are correct.
* Monthly totals are correct.
* Annual totals are correct.
* Main sheet reflects the underlying data.
* Dashboard reflects the underlying data.
* Charts represent the correct data.
* Formatting is usable.
* Existing data has not been unintentionally damaged.
* Formulas contain no unexpected errors.
* Cross-sheet references work.
* The workbook remains usable after additional records are added.

The agent should test the workbook with representative sample data before declaring the task complete whenever practical.

---

# Core Product Requirement

### Small prompts must work.

> "Add a total column."

### Medium prompts must work.

> "Create a monthly sales summary with a chart."

### Large prompts must work.

> "Build an entire annual booking and payment management workbook with 12 monthly sheets, a consolidated Main sheet, formulas, payment tracking, summaries, and a dashboard."

### Complex existing-workbook prompts must work.

> "Take this existing workbook, understand how it works, restructure it without losing data, add the missing functionality, and create a dashboard."

**The product should be designed around all four levels of complexity.**

The goal is not simply to create an AI that can edit cells.

The goal is to create an AI agent that can take a **business requirement expressed in natural language and turn it into a reliable, working Excel system.**
