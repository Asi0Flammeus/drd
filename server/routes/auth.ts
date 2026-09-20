import {
  SESSION_COOKIE,
  authenticate,
  closeSession,
  createUser,
  openSession,
  validateCredentials,
} from "../auth.ts";
import { config } from "../config.ts";
import { HttpError, clearCookie, json, parseCookies, readJson, setCookie } from "../http.ts";
import type { Route } from "../http.ts";

type Credentials = { email?: unknown; password?: unknown; inviteCode?: unknown };

export const authRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/auth/register",
    auth: false,
    async handler({ req, res }) {
      if (!config.registrationOpen) throw new HttpError(403, "registration_closed", "Les inscriptions sont fermées.");
      const body = await readJson<Credentials>(req);
      if (config.inviteCode && body.inviteCode !== config.inviteCode) {
        throw new HttpError(403, "bad_invite", "Code d'invitation invalide.");
      }
      const { email, password } = validateCredentials(body.email, body.password);
      const user = createUser(email, password);
      const session = openSession(user.id);
      setCookie(res, SESSION_COOKIE, session.token, session.maxAgeSeconds);
      json(res, 201, { user });
    },
  },
  {
    method: "POST",
    path: "/api/auth/login",
    auth: false,
    async handler({ req, res }) {
      const body = await readJson<Credentials>(req);
      if (typeof body.email !== "string" || typeof body.password !== "string") {
        throw new HttpError(400, "bad_credentials", "Adresse ou mot de passe incorrect.");
      }
      const user = authenticate(body.email.trim().toLowerCase(), body.password);
      const session = openSession(user.id);
      setCookie(res, SESSION_COOKIE, session.token, session.maxAgeSeconds);
      json(res, 200, { user });
    },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    auth: false,
    handler({ req, res }) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) closeSession(token);
      clearCookie(res, SESSION_COOKIE);
      json(res, 200, { ok: true });
    },
  },
  {
    method: "GET",
    path: "/api/me",
    auth: true,
    handler({ res, user }) {
      json(res, 200, { user, registrationOpen: config.registrationOpen });
    },
  },
];
