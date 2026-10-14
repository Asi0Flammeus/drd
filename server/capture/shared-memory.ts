/**
 * Where Chrome keeps its shared memory: decoded images, compositor tiles and
 * the full-page screenshot bitmap all travel between its processes through
 * it, so on an image-heavy page it is hundreds of megabytes.
 *
 * Chrome writes it to /dev/shm unless `--disable-dev-shm-usage` sends it to
 * the temp directory. Puppeteer passes that flag by default, which is right
 * under Docker's 64 MB /dev/shm and wrong under our compose file: there the
 * temp directory is a 256 MB tmpfs that also holds the Chrome profile and its
 * HTTP cache, while the 512 MB /dev/shm meant for Chrome sat empty. A page
 * whose working set outgrew /tmp failed its screenshot with "Unable to
 * capture screenshot" or a protocol timeout. So the choice is measured, not
 * assumed: the shared memory goes to whichever of the two is larger.
 */

import { statfsSync } from "node:fs";
import { tmpdir } from "node:os";

function capacity(path: string): number {
  try {
    const stats = statfsSync(path);
    return stats.blocks * stats.bsize;
  } catch {
    // No /dev/shm (macOS, some sandboxes): the temp directory is the only choice.
    return 0;
  }
}

/**
 * The Puppeteer default args to drop: `--disable-dev-shm-usage` when /dev/shm
 * is the larger home, nothing otherwise. `capacityOf` is the test seam.
 */
export function sharedMemoryIgnoredDefaults(capacityOf: (path: string) => number = capacity): string[] {
  return capacityOf("/dev/shm") > capacityOf(tmpdir()) ? ["--disable-dev-shm-usage"] : [];
}
