/**
 * `analyse(input) → findings`: the analysis module's whole interface.
 *
 * Pure: no database, no browser, no file system. The loader (`load.ts`)
 * decodes the capture's artifacts into this input; the job (`job.ts`)
 * persists what comes out. That seam is what lets an old capture be analysed
 * again, and a fixture be analysed in a test.
 */

import type { CaptureArtifacts } from "../capture/artifacts.ts";
import { analyseComponents } from "./components.ts";
import type { Finding } from "./findings.ts";
import { analyseMood } from "./mood.ts";
import { analysePalette } from "./palette.ts";
import type { Raster } from "./pixels.ts";
import { analyseScales } from "./scales.ts";
import { analyseType } from "./type.ts";

/** Bumped when findings change shape or meaning; stored on every analysis row. */
export const ANALYSIS_VERSION = 2;

export type AnalysisInput = {
  artifacts: CaptureArtifacts;
  /** The stitched page, downscaled to ≤ 200 k pixels. */
  raster: Raster;
  /** dHash of each component crop, by file name. */
  hashes: Record<string, string>;
};

export function analyse(input: AnalysisInput): Finding[] {
  const { artifacts, raster, hashes } = input;
  const palette = analysePalette(artifacts, raster);
  const type = analyseType(artifacts);
  const components = analyseComponents(artifacts, hashes, palette.roleOf);
  const scales = analyseScales(artifacts);
  const { mood, page } = analyseMood(artifacts, raster, palette.pixels, palette.fond);
  return [
    palette.palette,
    ...palette.colors,
    ...(palette.imagery ? [palette.imagery] : []),
    ...(type.scale ? [type.scale] : []),
    ...(type.pair ? [type.pair] : []),
    ...type.families,
    ...components,
    ...scales,
    mood,
    page,
  ];
}

export type { Finding } from "./findings.ts";
