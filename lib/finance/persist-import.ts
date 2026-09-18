import { prisma } from '@/lib/prisma'
import type { ImportResult } from './import-workbook'

/**
 * Write a parsed workbook into the database.
 *
 * Separate from parsing on purpose. The importer never touches storage, so an
 * operator can see exactly what a file yields, and what is wrong with it,
 * before committing to any of it. This is the step they take afterwards.
 *
 * The whole import is one transaction. A half-loaded project - activities
 * present, transactions missing - would look plausible on screen and produce a
 * financial report that is quietly incomplete, which is worse than a failure.
 */

export interface PersistOptions {
  programmeId: string
  /** Existing project to load into, or null to create one. */
  projectId?: string | null
  /**
   * The institution as it should appear on the funder's report.
   *
   * Supplied by the operator, never taken from the uploaded file. The workbook
   * states a name in a header cell, but that cell is filled in by hand, has
   * carried its own label inside the value before now, and belongs to whoever
   * last edited the spreadsheet. What goes at the top of a report submitted in
   * this organisation's name is this organisation's to decide.
   */
  institutionName: string
  startDate: Date
  endDate: Date
  /** Reporting period the imported transactions belong to, e.g. "Q1". */
  periodLabel: string
  periodStart: Date
  periodEnd: Date
}

export interface PersistOutcome {
  projectId: string
  periodId: string
  activitiesCreated: number
  activitiesUpdated: number
  transactionsCreated: number
  /** Transactions whose activity code matched nothing in the plan. */
  unmatchedTransactions: number
}

export async function persistImport(
  result: ImportResult,
  options: PersistOptions
): Promise<PersistOutcome> {
  return prisma.$transaction(async (tx) => {
    const project = options.projectId
      ? await tx.financeProject.update({
          where: { id: options.projectId },
          data: {
            institutionName: options.institutionName,
            agreementNumber: result.project.agreementNumber ?? undefined,
          },
        })
      : await tx.financeProject.create({
          data: {
            programmeId: options.programmeId,
            institutionName: options.institutionName,
            agreementNumber: result.project.agreementNumber,
            startDate: options.startDate,
            endDate: options.endDate,
          },
        })

    // Activities are keyed by code within a project, so a re-import updates the
    // plan in place rather than duplicating it. That matters because the plan
    // is revised across a project's life and transactions already point at it.
    let created = 0
    let updated = 0
    const activityIdByCode = new Map<string, string>()

    for (const a of result.activities) {
      const existing = await tx.projectActivity.findUnique({
        where: { projectId_code: { projectId: project.id, code: a.code } },
        select: { id: true },
      })

      const data = {
        milestone: a.milestone,
        workPackage: a.workPackage,
        objective: a.objective,
        details: a.details,
        deliverable: a.deliverable,
        deliverableFormat: a.deliverableFormat,
        startMonth: a.startMonth,
        endMonth: a.endMonth,
        duration: a.duration,
        costCategory: a.costCategory,
        budgetQ1: a.budgetQ1,
        budgetQ2: a.budgetQ2,
        budgetQ3: a.budgetQ3,
        budgetQ4: a.budgetQ4,
        sortOrder: a.sortOrder,
      }

      if (existing) {
        await tx.projectActivity.update({ where: { id: existing.id }, data })
        activityIdByCode.set(a.code, existing.id)
        updated += 1
      } else {
        const row = await tx.projectActivity.create({
          data: { ...data, projectId: project.id, code: a.code },
          select: { id: true },
        })
        activityIdByCode.set(a.code, row.id)
        created += 1
      }
    }

    const period = await tx.reportingPeriod.upsert({
      where: { projectId_label: { projectId: project.id, label: options.periodLabel } },
      create: {
        projectId: project.id,
        label: options.periodLabel,
        startDate: options.periodStart,
        endDate: options.periodEnd,
        amountTransferred: result.project.amountTransferred ?? undefined,
        bankBalance: result.project.bankBalance ?? undefined,
        invoiceNumber: result.project.invoiceNumber,
      },
      update: {
        amountTransferred: result.project.amountTransferred ?? undefined,
        bankBalance: result.project.bankBalance ?? undefined,
      },
    })

    // Re-importing a period replaces its transactions rather than appending.
    // Appending would double a quarter's expenditure on the second run, and
    // there is no natural key on a bank line to deduplicate against.
    await tx.financeTransaction.deleteMany({ where: { periodId: period.id } })

    // The template carries no activity code on a transaction row, so nothing
    // links them yet. Coding happens in the platform, which is the point of it.
    let unmatched = 0
    for (const t of result.transactions) {
      await tx.financeTransaction.create({
        data: {
          projectId: project.id,
          periodId: period.id,
          activityId: null,
          spentOn: t.spentOn,
          supplier: t.supplier,
          description: t.description,
          amount: t.amount,
          costCategory: t.costCategory,
          reference: t.popLink ?? t.invoiceLink ?? t.proofNote,
        },
      })
      unmatched += 1
    }

    return {
      projectId: project.id,
      periodId: period.id,
      activitiesCreated: created,
      activitiesUpdated: updated,
      transactionsCreated: result.transactions.length,
      unmatchedTransactions: unmatched,
    }
  }, {
    // The real file holds 170 transactions and 29 activities; the default
    // transaction timeout is not generous enough for that many round trips.
    timeout: 120_000,
    maxWait: 20_000,
  })
}
