/**
 * Discovery, and the seam an external search engine will slot into.
 *
 * There is no design-search API wired in, and pretending otherwise would be
 * the worst possible feature: a list of plausible-looking sites nobody
 * verified. So the shipped provider ranks only things we actually observed —
 * the outbound links of pages this user captured, weighted by the taste
 * profile their own annotations describe. A footer credit on a site the user
 * liked is a real, checkable lead to the studio that built it.
 *
 * `ExternalSearchProvider` is the seam: configure `DRD_SEARCH_*` and register
 * it, and the ranking pipeline takes its candidates on the same terms. Until
 * then it reports `available: false` and the UI says so.
 */

import { randomUUID } from "node:crypto";
import { db } from "../db.ts";

export type Candidate = {
  url: string;
  host: string;
  score: number;
  reasons: string[];
  provider: string;
  fromCapture: string | null;
};

export type TasteProfile = {
  tags: Record<string, number>;
  words: Record<string, number>;
  hosts: string[];
  dismissedHosts: string[];
};

export type DiscoveryProvider = {
  id: string;
  label: string;
  available: boolean;
  unavailableReason?: string;
  suggest(userId: string, profile: TasteProfile, limit: number): Promise<Candidate[]>;
};

/** Hosts that are never a design reference, however often a page links to them. */
const NOISE = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "linkedin.com", "youtube.com", "youtu.be",
  "tiktok.com", "pinterest.com", "pinterest.fr", "wa.me", "whatsapp.com", "t.me", "reddit.com",
  "google.com", "google.fr", "goo.gl", "maps.app.goo.gl", "apple.com", "microsoft.com", "bing.com",
  "wikipedia.org", "wordpress.org", "wp.com", "gravatar.com", "gstatic.com", "googleapis.com",
  "cloudflare.com", "cdnjs.com", "jsdelivr.net", "unpkg.com", "amazonaws.com", "cookiebot.com",
  "iubenda.com", "axeptio.eu", "hubspot.com", "mailchimp.com", "stripe.com", "paypal.com",
  "github.com", "gitlab.com", "npmjs.com", "vercel.com", "netlify.app", "netlify.com", "shopify.com",
  "squarespace.com", "wix.com", "webflow.com", "notion.so", "medium.com", "substack.com",
];

const DESIGN_PATH = /\/(work|works|projects?|portfolio|case-stud(y|ies)|studio|agence|agency|realisations?|réalisations?|selected)\b/i;
const DESIGN_TOKEN = /(studio|atelier|design|graph|creative|craft|lab|type|foundry|agence|collective|works?)/i;

export function registrableHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  // Good enough without a public-suffix list: keep three labels for the common
  // two-part TLDs, two otherwise. Only used for noise matching and grouping.
  const twoPart = ["co.uk", "com.au", "co.jp", "com.br", "co.nz", "org.uk", "gov.uk", "ac.uk"];
  const lastTwo = parts.slice(-2).join(".");
  return twoPart.includes(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function isNoiseHost(host: string): boolean {
  return NOISE.includes(registrableHost(host));
}

/**
 * What this user demonstrably likes, read off their own saved references and
 * signals. Words come from the `why` they wrote — the thing they typed when
 * nobody was scoring them.
 */
export function tasteProfile(userId: string): TasteProfile {
  const rows = db()
    .prepare("SELECT tags, what, why, source_host FROM refs WHERE user_id = ?")
    .all(userId) as { tags: string; what: string; why: string; source_host: string | null }[];

  const tags: Record<string, number> = {};
  const words: Record<string, number> = {};
  for (const row of rows) {
    let parsed: unknown = [];
    try {
      parsed = JSON.parse(row.tags);
    } catch {
      parsed = [];
    }
    if (Array.isArray(parsed)) {
      for (const tag of parsed) {
        if (typeof tag !== "string") continue;
        const key = tag.toLowerCase().trim();
        if (key) tags[key] = (tags[key] ?? 0) + 1;
      }
    }
    for (const word of `${row.what} ${row.why}`.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []) {
      words[word] = (words[word] ?? 0) + 1;
    }
  }

  const hosts = (db().prepare("SELECT DISTINCT host FROM captures WHERE user_id = ?").all(userId) as { host: string }[])
    .map((row) => registrableHost(row.host));
  const dismissedHosts = (
    db().prepare("SELECT host FROM candidates WHERE user_id = ? AND state = 'dismissed'").all(userId) as { host: string }[]
  ).map((row) => registrableHost(row.host));

  return { tags, words, hosts, dismissedHosts };
}

/* -------------------------------------------------------- link graph ----- */

export const linkGraphProvider: DiscoveryProvider = {
  id: "link-graph",
  label: "Graphe de liens des captures",
  available: true,
  async suggest(userId, profile, limit) {
    const rows = db()
      .prepare(
        `SELECT l.href AS href, l.host AS host, l.anchor AS anchor, l.rel AS rel,
                l.in_footer AS inFooter, l.credit_like AS creditLike,
                c.id AS captureId, c.host AS sourceHost, c.title AS sourceTitle
         FROM capture_links l JOIN captures c ON c.id = l.capture_id
         WHERE c.user_id = ? AND c.status = 'ready'`,
      )
      .all(userId) as {
      href: string;
      host: string;
      anchor: string | null;
      rel: string | null;
      inFooter: number;
      creditLike: number;
      captureId: string;
      sourceHost: string;
      sourceTitle: string | null;
    }[];

    const known = new Set(profile.hosts);
    const dismissed = new Set(profile.dismissedHosts);
    const taste = new Set([...Object.keys(profile.tags), ...Object.keys(profile.words)]);

    type Aggregate = Candidate & { sourceHosts: Set<string> };
    const byHost = new Map<string, Aggregate>();

    for (const row of rows) {
      const registrable = registrableHost(row.host);
      if (!registrable || registrable === registrableHost(row.sourceHost)) continue;
      if (known.has(registrable) || dismissed.has(registrable) || isNoiseHost(registrable)) continue;

      const anchor = (row.anchor ?? "").trim();
      const reasons: string[] = [];
      let score = 0.5;

      if (row.creditLike === 1) {
        score += 3;
        reasons.push(
          anchor
            ? `Crédit en pied de page sur ${row.sourceHost} — « ${anchor.slice(0, 60)} »`
            : `Lien de crédit en pied de page sur ${row.sourceHost}`,
        );
      } else if (row.inFooter === 1) {
        score += 0.8;
        reasons.push(`Lien de pied de page depuis ${row.sourceHost}`);
      }

      if (DESIGN_PATH.test(row.href)) {
        score += 1;
        reasons.push("L'URL pointe vers un portfolio ou des réalisations");
      }
      if (DESIGN_TOKEN.test(registrable)) {
        score += 1;
        reasons.push(`Le nom de domaine annonce un studio (${registrable})`);
      }

      const tokens = `${anchor} ${registrable}`.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];
      const matched = tokens.filter((token) => taste.has(token));
      if (matched.length > 0) {
        score += 1.5;
        reasons.push(`Recoupe votre profil de goût : ${[...new Set(matched)].slice(0, 3).join(", ")}`);
      }

      const rel = (row.rel ?? "").toLowerCase();
      if (rel.includes("sponsored") || rel.includes("ugc")) {
        score -= 2;
        reasons.push("Lien sponsorisé — déprioritisé");
      }

      const existing = byHost.get(registrable);
      if (existing) {
        existing.sourceHosts.add(row.sourceHost);
        if (score > existing.score) {
          existing.score = score;
          existing.url = row.href;
          existing.fromCapture = row.captureId;
        }
        for (const reason of reasons) if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      } else {
        byHost.set(registrable, {
          url: row.href,
          host: registrable,
          score,
          reasons,
          provider: "link-graph",
          fromCapture: row.captureId,
          sourceHosts: new Set([row.sourceHost]),
        });
      }
    }

    const out: Candidate[] = [];
    for (const aggregate of byHost.values()) {
      if (aggregate.sourceHosts.size > 1) {
        aggregate.score += 2 * (aggregate.sourceHosts.size - 1);
        aggregate.reasons.push(`Cité par ${aggregate.sourceHosts.size} sites que vous avez capturés`);
      }
      out.push({
        url: aggregate.url,
        host: aggregate.host,
        score: Math.round(aggregate.score * 100) / 100,
        reasons: aggregate.reasons,
        provider: aggregate.provider,
        fromCapture: aggregate.fromCapture,
      });
    }
    // A lead with nothing but "it was a link" is not a lead.
    return out
      .filter((candidate) => candidate.score >= 1.5)
      .sort((a, b) => b.score - a.score || a.host.localeCompare(b.host))
      .slice(0, limit);
  },
};

/* ---------------------------------------------------- external search ----- */

/**
 * The seam. Implement `suggest` against whatever search API is licensed later;
 * everything downstream — persistence, accept/dismiss, ranking display — is
 * already provider-agnostic.
 */
export const externalSearchProvider: DiscoveryProvider = {
  id: "external-search",
  label: "Recherche externe",
  available: false,
  unavailableReason:
    "Aucun fournisseur de recherche configuré. Le graphe de liens fonctionne sans, et aucune suggestion inventée n'est affichée.",
  async suggest() {
    return [];
  },
};

export const providers: DiscoveryProvider[] = [linkGraphProvider, externalSearchProvider];

/** Runs every available provider and persists what is new, keeping user verdicts. */
export async function refreshCandidates(userId: string, limit = 24): Promise<Candidate[]> {
  const profile = tasteProfile(userId);
  const collected: Candidate[] = [];
  for (const provider of providers) {
    if (!provider.available) continue;
    collected.push(...(await provider.suggest(userId, profile, limit)));
  }

  const insert = db().prepare(
    `INSERT INTO candidates (id, user_id, url, host, score, reasons, provider, from_capture, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
     ON CONFLICT(user_id, host) DO UPDATE SET
       score = excluded.score,
       reasons = excluded.reasons,
       url = excluded.url,
       from_capture = excluded.from_capture
     WHERE candidates.state = 'new'`,
  );
  const now = new Date().toISOString();
  for (const candidate of collected) {
    insert.run(
      randomUUID(),
      userId,
      candidate.url,
      candidate.host,
      candidate.score,
      JSON.stringify(candidate.reasons),
      candidate.provider,
      candidate.fromCapture,
      now,
    );
  }
  return collected;
}
