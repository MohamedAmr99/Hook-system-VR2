import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle, Download, FileSpreadsheet, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useSettlementImport } from "../hooks/useSettlementImport";
import { buildReconciliationCsv } from "../services/reconcile.export";
import type { ParseIssue, ReconciliationCause, ReconciliationResult } from "../types/settlement.types";

interface Props {
  onClose: () => void;
  onSuccess?: () => void;
}

const MAX_ISSUES_SHOWN = 20;

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span
      dir="ltr"
      className={cn(
        "tabular-nums",
        value < 0 && "text-destructive",
        value > 0 && "text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      {formatMoney(value)}
    </span>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold mt-1">
        <Money value={value} />
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  Settled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  PartiallySettled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Disputed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function SettlementImportModal({ onClose, onSuccess }: Props) {
  const { t, i18n } = useTranslation();
  const { preview, confirm } = useSettlementImport();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [isDragActive, setIsDragActive] = React.useState(false);
  const [causeFilter, setCauseFilter] = React.useState<ReconciliationCause | "">("");

  const data = preview.data;
  const outcome = confirm.data;
  const isBusy = preview.isPending || confirm.isPending;

  const issueText = (issue: ParseIssue): string => {
    const [code, detail] = issue.message.split(":");
    const msg = t(`settlements.errors.${code}`, { detail: detail ?? "" });
    return issue.row > 0 ? `${t("settlements.errors.row", { row: issue.row })}: ${msg}` : msg;
  };
  const causeLabel = (c: ReconciliationCause) => t(`settlements.causes.${c}`);
  const statusLabel = (s: string | null) => t(`settlements.status.${s ?? "none"}`);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setCauseFilter("");
    preview.reset();
    confirm.reset();
    preview.mutate(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  const filteredResults: ReconciliationResult[] = React.useMemo(() => {
    if (!data) return [];
    const list = causeFilter
      ? data.report.results.filter((r) => r.causes.some((c) => c.cause === causeFilter))
      : data.report.results;
    return [...list].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  }, [data, causeFilter]);

  const causeRows = React.useMemo(() => {
    if (!data) return [];
    const counts = new Map<ReconciliationCause, number>();
    for (const r of data.report.results) for (const c of r.causes) counts.set(c.cause, (counts.get(c.cause) ?? 0) + 1);
    if (data.report.platformLines.length > 0) counts.set("platform_level", data.report.platformLines.length);
    return (Object.entries(data.report.byCause) as [ReconciliationCause, number][])
      .map(([cause, amount]) => ({ cause, amount, count: counts.get(cause) ?? 0 }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [data]);

  const statusCounts = React.useMemo(() => {
    const c = { Settled: 0, PartiallySettled: 0, Disputed: 0, missing: 0, notInSheet: 0 };
    for (const r of data?.report.results ?? []) {
      if (r.match === "missing_in_system") c.missing++;
      else if (r.match === "not_in_sheet") c.notInSheet++;
      else if (r.financialStatus) c[r.financialStatus]++;
    }
    return c;
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const csv = buildReconciliationCsv(data.report, {
      headers: {
        orderId: t("settlements.table.orderId"),
        match: t("settlements.table.match"),
        expected: t("settlements.table.expected"),
        actual: t("settlements.table.actual"),
        diff: t("settlements.table.diff"),
        causes: t("settlements.table.causes"),
        status: t("settlements.table.status"),
      },
      match: {
        matched: t("settlements.match.matched"),
        missing_in_system: t("settlements.match.missing_in_system"),
        not_in_sheet: t("settlements.match.not_in_sheet"),
      },
      cause: causeLabel,
      status: statusLabel,
      platformLevelRow: t("settlements.causes.platform_level"),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `settlement-reconciliation-${data.parse.period?.key ?? "statement"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const errorMessage = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return msg === "not_authenticated" ? t("settlements.errors.not_authenticated") : msg;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      dir={i18n.dir()}
    >
      <div className="w-full max-w-5xl max-h-[92vh] bg-card border shadow-lg rounded-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-muted/30">
          <div>
            <h2 className="font-semibold">{t("settlements.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("settlements.subtitle")}</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("settlements.actions.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {outcome ? (
            <div className="flex flex-col items-center text-center py-6 gap-3">
              <CheckCircle className="h-14 w-14 text-emerald-500" />
              <h3 className="text-lg font-bold">{t("settlements.result.title")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("settlements.result.savedLines", { count: outcome.savedLines })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("settlements.result.updatedOrders", { count: outcome.updatedOrderIds.length })}
              </p>
              {outcome.missingOrderIds.length > 0 && (
                <p className="text-sm text-destructive">
                  {t("settlements.result.missingOrders", { count: outcome.missingOrderIds.length })}
                </p>
              )}
              <Button className="mt-2" onClick={() => { onSuccess?.(); onClose(); }}>
                {t("settlements.actions.done")}
              </Button>
            </div>
          ) : (
            <>
              {/* Upload */}
              <div
                onDragEnter={(e) => { e.preventDefault(); setIsDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragActive(false); }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center gap-2 cursor-pointer transition-colors hover:bg-muted/30",
                  isDragActive && "border-primary bg-primary/5",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
                {preview.isPending ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : file ? (
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                ) : (
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">
                  {preview.isPending ? t("settlements.parsing") : file ? file.name : t("settlements.upload.hint")}
                </p>
                <p className="text-xs text-muted-foreground">{t("settlements.upload.formats")}</p>
              </div>

              {(preview.error || confirm.error) && (
                <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-md">
                  <AlertCircle size={16} />
                  <span>{errorMessage(preview.error ?? confirm.error)}</span>
                </div>
              )}

              {data && (
                <>
                  {/* Per-row parse issues */}
                  {(data.parse.errors.length > 0 || data.parse.warnings.length > 0) && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1">
                      <p className="font-semibold text-destructive">
                        {t("settlements.errors.summary", {
                          errors: data.parse.errors.length,
                          warnings: data.parse.warnings.length,
                        })}
                      </p>
                      {[...data.parse.errors, ...data.parse.warnings].slice(0, MAX_ISSUES_SHOWN).map((issue, i) => (
                        <p key={i}>{issueText(issue)}</p>
                      ))}
                    </div>
                  )}

                  {data.parse.lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center">{t("settlements.noLines")}</p>
                  ) : (
                    <>
                      {/* Summary cards */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <SummaryCard
                          label={t("settlements.summary.statementTotal")}
                          value={data.statementTotal}
                          hint={t("settlements.summary.lines", { count: data.parse.lines.length })}
                        />
                        <SummaryCard label={t("settlements.summary.expected")} value={data.report.totals.expected} />
                        <SummaryCard
                          label={t("settlements.summary.actual")}
                          value={data.report.totals.actual}
                          hint={
                            data.priorLineCount > 0
                              ? t("settlements.summary.priorLines", { count: data.priorLineCount })
                              : undefined
                          }
                        />
                        <SummaryCard label={t("settlements.summary.diff")} value={data.report.totals.diff} />
                      </div>

                      <div className="flex flex-wrap gap-2 text-xs">
                        {(["Settled", "PartiallySettled", "Disputed"] as const).map((s) => (
                          <span key={s} className={cn("rounded-md px-2 py-1", STATUS_CLASSES[s])}>
                            {statusLabel(s)}: {statusCounts[s]}
                          </span>
                        ))}
                        <span className="rounded-md px-2 py-1 bg-muted">
                          {t("settlements.match.missing_in_system")}: {statusCounts.missing}
                        </span>
                        <span className="rounded-md px-2 py-1 bg-muted">
                          {t("settlements.match.not_in_sheet")}: {statusCounts.notInSheet}
                        </span>
                      </div>

                      {/* Difference by cause */}
                      <div className="rounded-xl border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                              <th className="text-start p-2">{t("settlements.table.cause")}</th>
                              <th className="text-start p-2">{t("settlements.table.count")}</th>
                              <th className="text-start p-2">{t("settlements.table.amount")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              className={cn("border-t cursor-pointer hover:bg-muted/30", causeFilter === "" && "bg-primary/5")}
                              onClick={() => setCauseFilter("")}
                            >
                              <td className="p-2 font-medium">{t("settlements.table.allCauses")}</td>
                              <td className="p-2">{data.report.results.length}</td>
                              <td className="p-2"><Money value={data.report.totals.diff} /></td>
                            </tr>
                            {causeRows.map((row) => (
                              <tr
                                key={row.cause}
                                className={cn(
                                  "border-t cursor-pointer hover:bg-muted/30",
                                  causeFilter === row.cause && "bg-primary/5",
                                )}
                                onClick={() => setCauseFilter(row.cause === "platform_level" ? "" : row.cause)}
                              >
                                <td className="p-2">{causeLabel(row.cause)}</td>
                                <td className="p-2">{row.count}</td>
                                <td className="p-2"><Money value={row.amount} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Per-order results */}
                      <div className="rounded-xl border overflow-auto max-h-80">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                            <tr>
                              <th className="text-start p-2">{t("settlements.table.orderId")}</th>
                              <th className="text-start p-2">{t("settlements.table.expected")}</th>
                              <th className="text-start p-2">{t("settlements.table.actual")}</th>
                              <th className="text-start p-2">{t("settlements.table.diff")}</th>
                              <th className="text-start p-2">{t("settlements.table.causes")}</th>
                              <th className="text-start p-2">{t("settlements.table.status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredResults.map((r) => (
                              <tr key={r.platformOrderId} className="border-t align-top">
                                <td className="p-2 font-mono" dir="ltr">{r.platformOrderId}</td>
                                <td className="p-2"><Money value={r.expected} /></td>
                                <td className="p-2"><Money value={r.actual} /></td>
                                <td className="p-2"><Money value={r.diff} /></td>
                                <td className="p-2">
                                  <div className="flex flex-wrap gap-1">
                                    {r.causes.map((c) => (
                                      <span key={c.cause} className="rounded bg-muted px-1.5 py-0.5">
                                        {causeLabel(c.cause)} (<Money value={c.amount} />)
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="p-2">
                                  {r.financialStatus ? (
                                    <span className={cn("rounded px-1.5 py-0.5", STATUS_CLASSES[r.financialStatus])}>
                                      {statusLabel(r.financialStatus)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">{t(`settlements.match.${r.match}`)}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={onClose} disabled={confirm.isPending}>
                  {t("settlements.actions.cancel")}
                </Button>
                {data && data.parse.lines.length > 0 && (
                  <>
                    <Button variant="outline" onClick={exportCsv} disabled={isBusy}>
                      <Download size={14} />
                      {t("settlements.actions.export")}
                    </Button>
                    <Button onClick={() => confirm.mutate(data)} disabled={isBusy}>
                      {confirm.isPending ? t("settlements.saving") : t("settlements.actions.confirm")}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
