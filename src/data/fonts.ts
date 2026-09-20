/**
 * Dimension 1 — type.
 *
 * Five open-source variable families, chosen against the house style of
 * AI-generated sites (Inter / Poppins / Playfair / Montserrat). Axis ranges are
 * not guessed: they were read from Google Fonts' own family metadata
 * (https://fonts.google.com/metadata/fonts) and the woff2 files in
 * /public/fonts are the `latin` variable subsets served by fonts.gstatic.com.
 */

export type Axis = {
  tag: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** What moving this axis actually does to the letterforms. */
  note: string;
};

export type FontFamily = {
  id: string;
  name: string;
  /** Full CSS stack, always ending in a generic. */
  stack: string;
  designer: string;
  license: string;
  upstream: string;
  /** What this face is for in a client build. */
  role: string;
  /** Why it is not a generic pick. */
  why: string;
  axes: Axis[];
  /**
   * Axis values for the DISPLAY role, overriding the family defaults. Optical
   * size is the reason this exists: Fraunces ships opsz 14 as its default,
   * which is the small-text drawing, and at that value its SOFT and WONK axes
   * barely move a 56px headline. Measured: WONK 0 -> 1 shifts the glyph row
   * 1.4px at opsz 14 and 20px at opsz 144.
   */
  displayAxes: Record<string, number>;
  /** Starting point for the specimen, per face — a bad default reads as a bad face. */
  preset: {
    headingSize: number;
    headingWeight: number;
    headingTracking: number;
    headingLeading: number;
    bodySize: number;
    bodyWeight: number;
    bodyTracking: number;
    bodyLeading: number;
  };
};

const axis = (
  tag: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  note: string,
): Axis => ({ tag, label, min, max, step, default: def, note });

export const FAMILIES: FontFamily[] = [
  {
    id: "bricolage",
    name: "Bricolage Grotesque",
    stack: '"Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif',
    designer: "Mathieu Triay / Atelier Triay",
    license: "SIL OFL 1.1 — Copyright 2022 The Bricolage Grotesque Project Authors",
    upstream: "https://github.com/ateliertriay/bricolage",
    role: "Display + UI sans for a shop that wants personality without shouting.",
    why:
      "A remix of Antique Olive and the Stephenson Blake grotesques with real ink traps: " +
      "it narrows into something anxious and wonky at wdth 75 and relaxes into confidence at 100, " +
      "so one family covers two moods. Nothing in the Inter/Poppins family does that.",
    axes: [
      axis("wght", "Weight", 200, 800, 1, 400, "200 is a hairline grotesque, 800 is a poster."),
      axis("wdth", "Width", 75, 100, 0.5, 100, "Compresses counters; 75 is the 'anxious' end."),
      axis("opsz", "Optical size", 12, 96, 1, 14, "Opens spacing and softens ink traps as it drops."),
    ],
    displayAxes: { opsz: 72 },
    preset: {
      headingSize: 54,
      headingWeight: 640,
      headingTracking: -0.025,
      headingLeading: 1.04,
      bodySize: 17,
      bodyWeight: 400,
      bodyTracking: 0,
      bodyLeading: 1.6,
    },
  },
  {
    id: "fraunces",
    name: "Fraunces",
    stack: '"Fraunces", "Iowan Old Style", Georgia, serif',
    designer: "Undercase Type — Phaedra Charles, Flavia Zimbardi",
    license: "SIL OFL 1.1 — Copyright 2018 The Fraunces Project Authors",
    upstream: "https://github.com/undercasetype/Fraunces",
    role: "Editorial display serif for food, craft, hospitality.",
    why:
      "Two axes no other free serif has: SOFT rounds the terminals from a sharp Cooper-ish " +
      "cut to a doughy one, and WONK swaps in genuinely irregular alternates (the g, the y, the italic f). " +
      "It is the opposite of Playfair's polite symmetry.",
    axes: [
      axis("wght", "Weight", 100, 900, 1, 400, "Very wide range; 100 is a thin editorial hairline."),
      axis("SOFT", "Softness", 0, 100, 1, 0, "0 = sharp terminals, 100 = rounded, doughy ones."),
      axis("WONK", "Wonk", 0, 1, 1, 0, "1 swaps in the irregular alternate glyphs."),
      axis("opsz", "Optical size", 9, 144, 1, 14, "Low values thicken hairlines for small text."),
    ],
    displayAxes: { opsz: 120 },
    preset: {
      headingSize: 56,
      headingWeight: 600,
      headingTracking: -0.02,
      headingLeading: 1.0,
      bodySize: 17,
      bodyWeight: 400,
      bodyTracking: 0,
      bodyLeading: 1.62,
    },
  },
  {
    id: "recursive",
    name: "Recursive",
    stack: '"Recursive", ui-monospace, "SF Mono", monospace',
    designer: "Stephen Nixon / Arrow Type",
    license: "SIL OFL 1.1 — Copyright 2020 The Recursive Project Authors",
    upstream: "https://github.com/arrowtype/recursive",
    role: "One family for UI, code and handwriting-flavoured accents.",
    why:
      "MONO morphs the same design from proportional sans to true monospace, and CASL " +
      "walks it from neutral grotesque to brush-drawn casual. A single file therefore covers " +
      "a price table, a code block and a hand-lettered aside — a range usually requiring three licences.",
    axes: [
      axis("wght", "Weight", 300, 1000, 1, 400, "Goes to 1000; the top end is genuinely heavy."),
      axis("MONO", "Monospace", 0, 1, 0.01, 0, "0 = proportional sans, 1 = fixed-pitch."),
      axis("CASL", "Casual", 0, 1, 0.01, 0, "0 = neutral grotesque, 1 = brush-drawn."),
      axis("slnt", "Slant", -15, 0, 0.5, 0, "True slant, not a synthetic oblique."),
      axis("CRSV", "Cursive", 0, 1, 0.5, 0.5, "Forces or forbids the single-storey cursive a/f/l."),
    ],
    displayAxes: {},
    preset: {
      headingSize: 46,
      headingWeight: 800,
      headingTracking: -0.02,
      headingLeading: 1.08,
      bodySize: 16,
      bodyWeight: 400,
      bodyTracking: 0,
      bodyLeading: 1.6,
    },
  },
  {
    id: "anybody",
    name: "Anybody",
    stack: '"Anybody", "Eurostile", "Helvetica Neue", sans-serif',
    designer: "Tyler Finck / Etcetera Type Co.",
    license: "SIL OFL 1.1 — Copyright 2020 The Anybody Project Authors",
    upstream: "https://github.com/Etcetera-Type-Co/Anybody",
    role: "Signage, sport, nightlife, anything that needs to fill a fixed box.",
    why:
      "A 50–150 width range, three times the travel of a normal width axis. " +
      "You size the letters to the container instead of the container to the letters, " +
      "which is why it belongs in a bench like this one: the slider is the design decision.",
    axes: [
      axis("wdth", "Width", 50, 150, 1, 100, "50 is a condensed ticket stub, 150 is a billboard."),
      axis("wght", "Weight", 100, 900, 1, 400, "Full range, holds up at both ends."),
    ],
    displayAxes: {},
    preset: {
      headingSize: 58,
      headingWeight: 700,
      headingTracking: -0.01,
      headingLeading: 0.98,
      bodySize: 16,
      bodyWeight: 400,
      bodyTracking: 0.005,
      bodyLeading: 1.58,
    },
  },
  {
    id: "newsreader",
    name: "Newsreader",
    stack: '"Newsreader", "Charter", Georgia, serif',
    designer: "Production Type",
    license: "SIL OFL 1.1 — Copyright 2020 The Newsreader Project Authors",
    upstream: "https://github.com/productiontype/Newsreader",
    role: "The quiet one: long body copy that has to be read, not admired.",
    why:
      "Drawn for screen reading with a real optical-size axis from 6 to 72, so the same family " +
      "sets a 14px legal line and a 72px headline without either looking borrowed. " +
      "Every bench needs one face that disappears; this is it.",
    axes: [
      axis("wght", "Weight", 200, 800, 1, 400, "Text weights are the interesting part here."),
      axis("opsz", "Optical size", 6, 72, 1, 16, "Thickens hairlines and widens spacing as it drops."),
    ],
    displayAxes: { opsz: 52 },
    preset: {
      headingSize: 48,
      headingWeight: 500,
      headingTracking: -0.015,
      headingLeading: 1.1,
      bodySize: 18,
      bodyWeight: 400,
      bodyTracking: 0,
      bodyLeading: 1.66,
    },
  },
];

export const familyById = (id: string): FontFamily =>
  FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];

export type Sample = {
  id: string;
  label: string;
  kicker: string;
  heading: string;
  body: string;
  meta: string;
};

/**
 * Real copy, not lorem. These are the three jobs a client face has to do:
 * carry a hero, carry 200 words of argument, and survive at 13px in a nav.
 */
export const SAMPLES: Sample[] = [
  {
    id: "hero",
    label: "Hero",
    kicker: "Belle-Île-en-Mer — ouvert du mardi au dimanche",
    heading: "Le pain sort du four à six heures, pas à sept.",
    body:
      "On pétrit la veille, on cuit au petit matin, et ce qui reste à midi part en chapelure. " +
      "C'est la seule promesse que l'on tient : vous ne mangerez jamais quelque chose " +
      "qui a dormi dans une vitrine.",
    meta: "12 places en terrasse · Réservation conseillée",
  },
  {
    id: "editorial",
    label: "Editorial",
    kicker: "Le métier",
    heading: "Une tôle en acier vaut mieux qu'une garantie de trente ans.",
    body:
      "Un atelier ne se juge pas à sa plaquette. Il se juge à ce qui sort de la porte le vendredi soir : " +
      "une pièce qui tient, un délai annoncé qui a été tenu, un devis dont le chiffre du bas n'a pas bougé. " +
      "Le reste — la certification, le slogan, la photo du camion — sert à rassurer ceux qui n'ont pas " +
      "encore travaillé avec nous. Ceux qui l'ont fait rappellent, et c'est le seul indicateur " +
      "que l'on suit. On préfère refuser un chantier que de le rendre en retard, parce qu'un " +
      "client déçu coûte six clients qu'on n'aura jamais rencontrés.",
    meta: "Publié le 14 mars · 4 min de lecture",
  },
  {
    id: "interface",
    label: "Interface",
    kicker: "Panier · 3 articles",
    heading: "Commande #A-2741",
    body:
      "Retrait à l'atelier entre 9 h et 12 h. Paiement sur place, carte ou espèces. " +
      "Un SMS vous prévient dès que la commande est prête.",
    meta: "Sous-total 148,00 € · TVA incluse",
  },
];
