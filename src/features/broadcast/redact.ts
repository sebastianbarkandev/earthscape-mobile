/**
 * The SRT ingest URL carries the stream passphrase (`srt://host:port?…passphrase=…`).
 * Native error text can echo a URL (SRTHaishinKit's `unsupportedUri` carries it), and
 * `lastEvent`/`error` are display strings — so every message crossing into Redux is
 * scrubbed first (SEC-010). Query strings of srt:// URLs are dropped entirely and any
 * stray `passphrase=` value is masked.
 */
export function redactSecrets(message: string | null | undefined): string {
  if (!message) return '';
  return message
    .replace(/(srt:\/\/[^\s?"'<>]*)\?[^\s"'<>]*/gi, '$1?<redacted>')
    .replace(/(passphrase\s*[=:]\s*)[^&\s"'<>]+/gi, '$1<redacted>');
}
