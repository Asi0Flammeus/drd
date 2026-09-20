/**
 * The guard between a user-supplied string and a browser we run.
 *
 * These are the two places where a mistake is not a bug but an incident: a
 * parser that turns junk into an internal URL, and an address check that lets
 * a reserved range through. Everything here is decidable without DNS, so the
 * suite is offline and deterministic.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { guardUrl, hostIsBlocked, inspectUrl, isPrivateAddress, parseUserUrl } from "../server/capture/url-guard.ts";

test("parses the shapes the splat route actually receives", () => {
  assert.equal(parseUserUrl("https://example.com/page")?.toString(), "https://example.com/page");
  assert.equal(parseUserUrl("https%3A%2F%2Fexample.com%2Fpage")?.toString(), "https://example.com/page");
  // A proxy or a path normaliser collapsing the double slash.
  assert.equal(parseUserUrl("https:/example.com/page")?.toString(), "https://example.com/page");
  // Bare host: https is assumed, never http.
  assert.equal(parseUserUrl("example.com/page")?.toString(), "https://example.com/page");
  assert.equal(parseUserUrl("example.com")?.toString(), "https://example.com/");
  // The fragment is ours, not the captured page's.
  assert.equal(parseUserUrl("https://example.com/page#section")?.toString(), "https://example.com/page");
});

test("refuses strings that are not a public URL", () => {
  assert.equal(parseUserUrl(""), null);
  assert.equal(parseUserUrl("   "), null);
  assert.equal(parseUserUrl("not a url"), null);
  assert.equal(parseUserUrl("/etc/passwd"), null);
  assert.equal(parseUserUrl("javascript:alert(1)"), null);
});

test("IPv4 reserved and private ranges are private", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.7",
    "127.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} must be treated as private`);
  }
  for (const address of ["1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1"]) {
    assert.equal(isPrivateAddress(address), false, `${address} must be treated as public`);
  }
});

test("IPv6 loopback, ULA, link-local and IPv4-mapped forms are private", () => {
  for (const address of ["::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "2001:db8::1"]) {
    assert.equal(isPrivateAddress(address), true, `${address} must be treated as private`);
  }
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});

test("non-public hostnames are refused by name", () => {
  for (const host of ["localhost", "app.localhost", "printer.local", "db.internal", "metadata.google.internal", "foo.home.arpa", "x.onion"]) {
    assert.equal(hostIsBlocked(host), true, `${host} must be blocked`);
  }
  assert.equal(hostIsBlocked("example.com"), false);
});

test("protocol, credentials and port are checked before anything resolves", () => {
  assert.equal(inspectUrl(new URL("https://example.com/")), null);
  assert.equal(inspectUrl(new URL("http://example.com/")), null);
  assert.equal(inspectUrl(new URL("ftp://example.com/"))?.code, "bad_protocol");
  assert.equal(inspectUrl(new URL("https://user:pass@example.com/"))?.code, "credentials_in_url");
  assert.equal(inspectUrl(new URL("http://example.com:8080/"))?.code, "bad_port");
  assert.equal(inspectUrl(new URL("http://127.0.0.1:5178/"))?.code, "bad_port");
});

test("guardUrl refuses a literal private address without touching DNS", async () => {
  const loopback = await guardUrl("http://127.0.0.1/");
  assert.equal(loopback.ok, false);
  assert.equal(loopback.ok === false && loopback.code, "private_address");

  const metadata = await guardUrl("http://169.254.169.254/latest/meta-data/");
  assert.equal(metadata.ok, false);
  assert.equal(metadata.ok === false && metadata.code, "private_address");

  const mapped = await guardUrl("http://[::ffff:10.0.0.1]/");
  assert.equal(mapped.ok, false);

  const junk = await guardUrl("not a url");
  assert.equal(junk.ok === false && junk.code, "bad_url");
});
