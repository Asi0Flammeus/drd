/**
 * The analysis job: load a capture's artifacts, run `analyse`, persist the
 * findings. Runs after every capture, and on demand ("Réanalyser", I-26) for
 * a capture made by version 1 of the pipeline, which yields a partial
 * analysis until the page is captured again.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { ANALYSIS_VERSION, analyse } from "./index.ts";
import type { Finding, MoodData } from "./findings.ts";
import { loadInput } from "./load.ts";
import { cutWebp } from "./pixels.ts";

type CaptureRow = {
  id: string;
  final_url: string | null;
  requested_url: string;
  finished_at: string | null;
  width: number | null;
  height: number | null;
  meta: string;
  status: string;
};

const running = new Set<string>();

export function isAnalysing(captureId: string): boolean {
  return running.has(captureId);
}

/** Mood crops are cut here, not in `analyse`, which never writes a file. */
async function materialise(dir: string, findings: Finding[]): Promise<void> {
  const mood = findings.find((f) => f.kind === "mood") as Finding<MoodData> | undefined;
  if (!mood) return;
  for (const [index, image] of mood.data.images.entries()) {
    const file = `m-${index}.webp`;
    if (await cutWebp(join(dir, "page.jpg"), image.box, join(dir, file)).catch(() => false)) {
      image.crop = file;
      mood.media.push(file);
    }
  }
}

export async function analyseCapture(captureId: string): Promise<string> {
  if (running.has(captureId)) throw new Error("Analyse déjà en cours.");
  running.add(captureId);
  const connection = db();
  const capture = connection.prepare("SELECT id, final_url, requested_url, finished_at, width, height, meta, status FROM captures WHERE id = ?").get(captureId) as CaptureRow | undefined;
  if (!capture || capture.status !== "ready") {
    running.delete(captureId);
    throw new Error("Capture introuvable ou pas prête.");
  }
  const analysisId = randomUUID();
  const now = new Date().toISOString();
  // One analysis per version: re-running replaces it. Kept items do not
  // care, they are frozen copies and match their finding by signature.
  connection.prepare("DELETE FROM analyses WHERE capture_id = ? AND version = ?").run(captureId, ANALYSIS_VERSION);
  connection.prepare("INSERT INTO analyses (id, capture_id, version, status, partial, created_at) VALUES (?, ?, ?, 'running', 0, ?)").run(analysisId, captureId, ANALYSIS_VERSION, now);
  connection.prepare("UPDATE captures SET stage = 'analyse' WHERE id = ?").run(captureId);
  try {
    const dir = join(config.mediaDir, captureId);
    const elements = connection
      .prepare("SELECT tag, label, guess, x, y, width, height, text, styles, crop FROM capture_elements WHERE capture_id = ? ORDER BY ordinal")
      .all(captureId) as { tag: string; label: string; guess: string; x: number; y: number; width: number; height: number; text: string | null; styles: string; crop: string | null }[];
    const input = await loadInput({ dir, url: capture.final_url ?? capture.requested_url, finishedAt: capture.finished_at, width: capture.width, height: capture.height, meta: capture.meta, elements });
    const findings = analyse(input);
    await materialise(dir, findings);
    connection.exec("BEGIN");
    try {
      const insert = connection.prepare(
        `INSERT INTO findings (id, analysis_id, kind, subkind, ordinal, title, confidence, evidence, data, media, locations, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      findings.forEach((finding, ordinal) => {
        insert.run(
          randomUUID(),
          analysisId,
          finding.kind,
          finding.subkind,
          ordinal,
          finding.title,
          finding.confidence,
          JSON.stringify(finding.evidence),
          JSON.stringify(finding.data),
          JSON.stringify(finding.media),
          JSON.stringify(finding.locations),
          finding.signature,
        );
      });
      connection
        .prepare("UPDATE analyses SET status = 'done', partial = ?, finished_at = ? WHERE id = ?")
        .run(input.artifacts.partial ? 1 : 0, new Date().toISOString(), analysisId);
      connection.prepare("UPDATE captures SET stage = 'done' WHERE id = ?").run(captureId);
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
    return analysisId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    connection.prepare("UPDATE analyses SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(message.slice(0, 400), new Date().toISOString(), analysisId);
    connection.prepare("UPDATE captures SET stage = 'done' WHERE id = ?").run(captureId);
    throw error;
  } finally {
    running.delete(captureId);
  }
}
